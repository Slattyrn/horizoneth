import { useRef, useEffect, useCallback, memo } from 'react';
import { scaleLinear, scaleTime } from 'd3-scale';
import { timeFormat } from 'd3-time-format';

// ═══════════════════════════════════════════════════════════════════════════════
// CANDLESTICK CHART - Pure Canvas2D + D3 Scales (Zero React Re-renders)
//
// Architecture:
//   - All rendering via Canvas2D (no DOM manipulation per tick)
//   - D3 scales for data-to-pixel mapping only
//   - useRef for all mutable state (candles, viewport, mouse)
//   - requestAnimationFrame render loop (~30fps throttled)
//   - React only re-renders for control changes (timeframe, indicators)
//
// Performance:
//   - Patches existing candle data (no full array replacement)
//   - Only redraws dirty regions when possible
//   - Fixed container dimensions (no layout shifts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface CandleData {
  time: number;    // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  vwap?: number;   // Cumulative VWAP (reset daily)
}

export interface ZoneLine {
  price: number;
  color: string;
  label: string;
  lineWidth?: number;
  dashed?: boolean;
}

export interface OverlayObject {
  type: 'line' | 'rect' | 'label' | 'zone' | 'arrow' | 'dot';
  time?: number;        // bar timestamp (unix seconds) — maps to candle x position
  price?: number;       // price level — maps to y position
  endTime?: number;     // for lines spanning multiple bars
  endPrice?: number;    // end y for lines
  color?: string;
  label?: string;
  opacity?: number;
  direction?: 'up' | 'down';  // for arrows
  style?: 'solid' | 'dashed'; // for lines
}

interface CandlestickChartProps {
  candles: CandleData[];
  currentPrice: number | null;
  zones?: ZoneLine[];
  showVolume?: boolean;
  indicators?: {
    ema7?: number[];
    ema13?: number[];
    ema21?: number[];
    ema35?: number[];
    rthVwap?: number[];
  };
  overlays?: OverlayObject[];
  candleCountdown?: string; // e.g. "4:37" — rendered below the current-price badge
  onCrosshairMove?: (candle: CandleData | null) => void;
  onContextMenu?: (price: number, event: MouseEvent) => void;
}

// Theme
const THEME = {
  bg: '#0A0C0F',
  gridLine: 'rgba(255, 255, 255, 0.03)',
  axisText: '#6B7280',
  axisLine: 'rgba(255, 255, 255, 0.08)',
  bull: '#22c55e',
  bear: '#ef4444',
  bullVolume: 'rgba(34, 197, 94, 0.35)',
  bearVolume: 'rgba(239, 68, 68, 0.35)',
  crosshair: 'rgba(255, 255, 255, 0.3)',
  priceLine: '#00D9FF',
  tooltipBg: 'rgba(18, 21, 26, 0.95)',
  tooltipBorder: 'rgba(0, 217, 255, 0.3)',
  tooltipText: '#E8E8E8',
} as const;

const PADDING = { top: 10, right: 70, bottom: 22, left: 2 };
const VOLUME_HEIGHT_RATIO = 0.15; // Volume panel takes 15% of chart height
const MIN_CANDLE_WIDTH = 3;
const MAX_CANDLE_WIDTH = 30;
const VISIBLE_CANDLES_DEFAULT = 120;

const formatTime = timeFormat('%H:%M');
const formatDate = timeFormat('%b %d');
const formatPrice = (p: number) => p.toFixed(2);

function CandlestickChart({
  candles,
  currentPrice,
  zones = [],
  showVolume = false,
  indicators,
  overlays = [],
  candleCountdown,
  onCrosshairMove,
  onContextMenu,
}: CandlestickChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Mutable state refs (no re-renders)
  const stateRef = useRef({
    width: 0,
    height: 0,
    dpr: window.devicePixelRatio || 1,
    // Viewport: how many candles visible + scroll offset
    visibleCount: VISIBLE_CANDLES_DEFAULT,
    scrollOffset: 0, // 0 = rightmost (latest) candle visible
    // Vertical pan: positive = chart shifted up (more room below price)
    yOffset: 0,
    // Mouse
    mouseX: -1,
    mouseY: -1,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffset: 0,
    dragStartYOffset: 0,
    // Animation
    dirty: true,
    animFrameId: 0,
  });

  // Price-scale snapshot from last draw (for y→price conversion outside render loop)
  const priceScaleRef = useRef<{ minPrice: number; maxPrice: number; chartTop: number; chartBottom: number } | null>(null);

  // Keep latest onContextMenu callback in a ref to avoid re-binding listeners
  const onContextMenuRef = useRef(onContextMenu);
  useEffect(() => { onContextMenuRef.current = onContextMenu; }, [onContextMenu]);

  // Refs for data (avoid closure stale captures)
  const candlesRef = useRef<CandleData[]>(candles);
  const currentPriceRef = useRef<number | null>(currentPrice);
  const zonesRef = useRef<ZoneLine[]>(zones);
  const showVolumeRef = useRef(showVolume);
  const indicatorsRef = useRef(indicators);
  const overlaysRef = useRef<OverlayObject[]>(overlays);
  const countdownRef = useRef<string | undefined>(candleCountdown);

  // Keep refs in sync
  useEffect(() => { candlesRef.current = candles; stateRef.current.dirty = true; }, [candles]);
  useEffect(() => { currentPriceRef.current = currentPrice; stateRef.current.dirty = true; }, [currentPrice]);
  useEffect(() => { zonesRef.current = zones; stateRef.current.dirty = true; }, [zones]);
  useEffect(() => { showVolumeRef.current = showVolume; stateRef.current.dirty = true; }, [showVolume]);
  useEffect(() => { indicatorsRef.current = indicators; stateRef.current.dirty = true; }, [indicators]);
  useEffect(() => { overlaysRef.current = overlays; stateRef.current.dirty = true; }, [overlays]);
  useEffect(() => { countdownRef.current = candleCountdown; stateRef.current.dirty = true; }, [candleCountdown]);

  // ─── DRAWING FUNCTIONS ───────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const data = candlesRef.current;
    const price = currentPriceRef.current;
    const zoneLines = zonesRef.current;
    const volVisible = showVolumeRef.current;
    const inds = indicatorsRef.current;

    const { width, height, dpr } = s;
    if (width === 0 || height === 0) return;

    // Chart area dimensions
    const chartLeft = PADDING.left;
    const chartRight = width - PADDING.right;
    const chartTop = PADDING.top;
    const volumeHeight = volVisible ? height * VOLUME_HEIGHT_RATIO : 0;
    const chartBottom = height - PADDING.bottom - volumeHeight;
    const chartWidth = chartRight - chartLeft;
    const chartHeight = chartBottom - chartTop;

    if (chartWidth <= 0 || chartHeight <= 0) return;

    // Visible data slice
    //  scrollOffset > 0 → scrolled into the past (older candles on screen)
    //  scrollOffset < 0 → scrolled into the "future" (empty space on right, latest candle moves left)
    const totalCandles = data.length;
    const visibleCount = s.visibleCount; // total slots in viewport
    const rightPad = Math.max(0, -s.scrollOffset); // empty slots on right (future space)
    const pastOffset = Math.max(0, s.scrollOffset); // how far back into history
    const endIndex = Math.max(0, totalCandles - pastOffset);
    const realCandleSlots = Math.max(0, visibleCount - rightPad);
    const startIndex = Math.max(0, endIndex - realCandleSlots);
    const visible = data.slice(startIndex, endIndex);

    if (visible.length === 0) {
      // Clear and draw empty state
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = THEME.bg;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#4B5563';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for market data...', width / 2, height / 2);
      ctx.restore();
      return;
    }

    // Compute scales
    let minPrice = Infinity, maxPrice = -Infinity;
    let maxVolume = 0;
    for (const c of visible) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.volume && c.volume > maxVolume) maxVolume = c.volume;
    }

    // Include zones in price range
    for (const z of zoneLines) {
      if (z.price < minPrice) minPrice = z.price;
      if (z.price > maxPrice) maxPrice = z.price;
    }

    // Include current price
    if (price !== null) {
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;
    }

    // Add 8% padding to price range (gives breathing room above/below price)
    const priceRange = maxPrice - minPrice;
    const pricePad = priceRange * 0.08 || 1;
    minPrice -= pricePad;
    maxPrice += pricePad;

    // Apply vertical pan offset (shift view window up/down)
    // yOffset is expressed as fraction of price range; positive = view shifted down
    // (so price appears to move up on screen, revealing space below)
    const yPanAmount = (maxPrice - minPrice) * s.yOffset;
    minPrice += yPanAmount;
    maxPrice += yPanAmount;

    const yScale = scaleLinear().domain([minPrice, maxPrice]).range([chartBottom, chartTop]);
    // xScale domain covers the full viewport (visibleCount slots), not just real candles.
    // This leaves empty space on the right when rightPad > 0 (future / scroll-past-price).
    const xScaleSlots = Math.max(visibleCount, visible.length) - 1;
    const xScale = scaleLinear().domain([0, xScaleSlots || 1]).range([chartLeft + 4, chartRight - 4]);

    // Snapshot price scale for external y→price conversion (context menu, etc.)
    priceScaleRef.current = { minPrice, maxPrice, chartTop, chartBottom };

    // Candle width — based on total viewport slots, not just real candles
    // (so candles don't expand when scrolled into future space)
    const candleSpacing = chartWidth / Math.max(1, visibleCount);
    const candleWidth = Math.max(MIN_CANDLE_WIDTH, Math.min(MAX_CANDLE_WIDTH, candleSpacing * 0.7));
    const wickWidth = Math.max(1, candleWidth < 6 ? 1 : 2);

    // ─── BEGIN DRAW ─────────────────────────────────────────────────────
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);

    // Grid lines (horizontal)
    const priceStep = niceStep(priceRange, 6);
    const gridStart = Math.ceil(minPrice / priceStep) * priceStep;
    ctx.strokeStyle = THEME.gridLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (let p = gridStart; p <= maxPrice; p += priceStep) {
      const y = Math.round(yScale(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
    }

    // Grid lines (vertical) - time labels
    const timeStep = niceTimeStep(visible.length, chartWidth);
    ctx.fillStyle = THEME.axisText;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < visible.length; i += timeStep) {
      const x = Math.round(xScale(i));
      // Vertical grid line
      ctx.strokeStyle = THEME.gridLine;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, chartTop);
      ctx.lineTo(x + 0.5, chartBottom);
      ctx.stroke();
      // Time label
      const d = new Date(visible[i].time * 1000);
      const label = formatTime(d);
      ctx.fillStyle = THEME.axisText;
      ctx.fillText(label, x, height - PADDING.bottom + 16 - (volVisible ? volumeHeight : 0));
    }

    // Zone lines
    for (const zone of zoneLines) {
      const zy = Math.round(yScale(zone.price)) + 0.5;
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = zone.lineWidth || 1;
      ctx.setLineDash(zone.dashed !== false ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(chartLeft, zy);
      ctx.lineTo(chartRight, zy);
      ctx.stroke();

      // Zone label on right axis
      ctx.fillStyle = zone.color;
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${zone.label} ${formatPrice(zone.price)}`, chartRight + 4, zy + 3);
    }
    ctx.setLineDash([]);

    // ─── CANDLESTICKS ───────────────────────────────────────────────────
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const x = Math.round(xScale(i));
      const isBull = c.close >= c.open;
      const color = isBull ? THEME.bull : THEME.bear;

      const bodyTop = Math.round(yScale(Math.max(c.open, c.close)));
      const bodyBottom = Math.round(yScale(Math.min(c.open, c.close)));
      const bodyHeight = Math.max(1, bodyBottom - bodyTop);
      const wickTop = Math.round(yScale(c.high));
      const wickBottom = Math.round(yScale(c.low));

      // Wick
      ctx.fillStyle = color;
      ctx.fillRect(x - Math.floor(wickWidth / 2), wickTop, wickWidth, wickBottom - wickTop);

      // Body
      ctx.fillStyle = color;
      ctx.fillRect(x - Math.floor(candleWidth / 2), bodyTop, candleWidth, bodyHeight);
    }

    // ─── VOLUME BARS ────────────────────────────────────────────────────
    if (volVisible && maxVolume > 0) {
      const volTop = chartBottom + 4;
      const volBottom = height - PADDING.bottom;
      const volHeight = volBottom - volTop;
      const volScale = scaleLinear().domain([0, maxVolume]).range([0, volHeight]);

      // Volume background separator
      ctx.strokeStyle = THEME.axisLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartLeft, volTop - 2);
      ctx.lineTo(chartRight, volTop - 2);
      ctx.stroke();

      for (let i = 0; i < visible.length; i++) {
        const c = visible[i];
        if (!c.volume) continue;
        const x = Math.round(xScale(i));
        const barHeight = Math.round(volScale(c.volume));
        const isBull = c.close >= c.open;
        ctx.fillStyle = isBull ? THEME.bullVolume : THEME.bearVolume;
        ctx.fillRect(x - Math.floor(candleWidth / 2), volBottom - barHeight, candleWidth, barHeight);
      }
    }

    // ─── INDICATOR LINES ────────────────────────────────────────────────
    if (inds) {
      const indColors: Record<string, string> = {
        ema7: '#4ade80',
        ema13: '#22c55e',
        ema21: '#16a34a',
        ema35: '#f59e0b',
        rthVwap: '#ffffff',
      };
      for (const [key, values] of Object.entries(inds)) {
        if (!values || values.length === 0) continue;
        const color = indColors[key] || '#ffffff';
        ctx.strokeStyle = color;
        ctx.lineWidth = key === 'ema35' ? 2 : key === 'rthVwap' ? 2 : 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        // Align indicator values with visible candles
        const offset = data.length - values.length;
        for (let i = 0; i < visible.length; i++) {
          const dataIdx = startIndex + i;
          const indIdx = dataIdx - offset;
          if (indIdx < 0 || indIdx >= values.length) continue;
          const v = values[indIdx];
          // NaN breaks the path (for RTH VWAP outside its time window)
          if (!isFinite(v)) { started = false; continue; }
          const x = xScale(i);
          const y = yScale(v);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ─── OVERLAYS (Wave Engine signals) ──────────────────────────────────
    const ovls = overlaysRef.current;
    if (ovls.length > 0) {
      for (const o of ovls) {
        if (o.time === undefined || o.price === undefined) continue;

        // Find candle index for this timestamp
        let candleIdx = -1;
        for (let i = 0; i < visible.length; i++) {
          if (visible[i].time === o.time) { candleIdx = i; break; }
          if (i < visible.length - 1 && visible[i].time <= o.time && visible[i + 1].time > o.time) {
            candleIdx = i; break;
          }
        }
        if (candleIdx === -1 && visible.length > 0 && o.time >= visible[visible.length - 1].time) {
          candleIdx = visible.length - 1;
        }
        if (candleIdx === -1) continue;

        const cx = xScale(candleIdx);
        const cy = yScale(o.price);
        const color = o.color || '#ffffff';
        const alpha = o.opacity ?? 1.0;

        ctx.save();
        ctx.globalAlpha = alpha;

        switch (o.type) {
          case 'arrow': {
            const isUp = o.direction === 'up';
            const arrowSize = 8;
            const yOff = isUp ? 12 : -12;

            ctx.fillStyle = color;
            ctx.beginPath();
            if (isUp) {
              ctx.moveTo(cx, cy + yOff);
              ctx.lineTo(cx - arrowSize / 2, cy + yOff + arrowSize);
              ctx.lineTo(cx + arrowSize / 2, cy + yOff + arrowSize);
            } else {
              ctx.moveTo(cx, cy + yOff);
              ctx.lineTo(cx - arrowSize / 2, cy + yOff - arrowSize);
              ctx.lineTo(cx + arrowSize / 2, cy + yOff - arrowSize);
            }
            ctx.closePath();
            ctx.fill();
            break;
          }

          case 'dot': {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, 3, 0, Math.PI * 2);
            ctx.fill();
            break;
          }

          case 'line': {
            if (o.endTime !== undefined && o.endPrice !== undefined) {
              let endIdx = -1;
              for (let i = 0; i < visible.length; i++) {
                if (visible[i].time === o.endTime) { endIdx = i; break; }
                if (i < visible.length - 1 && visible[i].time <= o.endTime && visible[i + 1].time > o.endTime) {
                  endIdx = i; break;
                }
              }
              if (endIdx === -1 && visible.length > 0 && o.endTime >= visible[visible.length - 1].time) {
                endIdx = visible.length - 1;
              }
              if (endIdx === -1) endIdx = candleIdx;

              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.setLineDash(o.style === 'dashed' ? [4, 3] : []);
              ctx.beginPath();
              ctx.moveTo(cx, cy);
              ctx.lineTo(xScale(endIdx), yScale(o.endPrice));
              ctx.stroke();
              ctx.setLineDash([]);
            } else {
              // Horizontal line from this candle to right edge
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.setLineDash(o.style === 'dashed' ? [4, 3] : []);
              ctx.beginPath();
              ctx.moveTo(cx, Math.round(cy) + 0.5);
              ctx.lineTo(chartRight, Math.round(cy) + 0.5);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            break;
          }

          case 'label': {
            ctx.fillStyle = color;
            ctx.font = 'bold 8px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(o.label || '', cx, cy - 6);
            break;
          }

          default:
            break;
        }

        // Render label for arrows/dots
        if ((o.type === 'arrow' || o.type === 'dot') && o.label) {
          ctx.fillStyle = color;
          ctx.font = 'bold 8px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          const labelY = o.type === 'arrow'
            ? (o.direction === 'up' ? cy + 28 : cy - 26)
            : cy - 8;
          ctx.fillText(o.label, cx, labelY);
        }

        ctx.restore();
      }
    }

    // ─── CURRENT PRICE LINE ─────────────────────────────────────────────
    if (price !== null) {
      const py = Math.round(yScale(price)) + 0.5;
      const isBullish = visible.length > 0 && price >= visible[visible.length - 1].open;
      const lineColor = isBullish ? THEME.bull : THEME.bear;

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(chartLeft, py);
      ctx.lineTo(chartRight, py);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price badge on right axis
      ctx.fillStyle = lineColor;
      roundRect(ctx, chartRight + 1, py - 9, 67, 18, 3);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(formatPrice(price), chartRight + 34, py + 4);

      // Candle-close countdown — attached directly under the price badge (TradingView style)
      const countdown = countdownRef.current;
      if (countdown) {
        ctx.fillStyle = 'rgba(18, 21, 26, 0.95)';
        roundRect(ctx, chartRight + 1, py + 10, 67, 15, 3);
        ctx.fill();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        roundRect(ctx, chartRight + 1, py + 10, 67, 15, 3);
        ctx.stroke();
        ctx.fillStyle = lineColor;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(countdown, chartRight + 34, py + 21);
      }
    }

    // ─── PRICE AXIS (right) ─────────────────────────────────────────────
    ctx.fillStyle = THEME.axisText;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    for (let p = gridStart; p <= maxPrice; p += priceStep) {
      const y = Math.round(yScale(p));
      ctx.fillText(formatPrice(p), chartRight + 4, y + 4);
    }

    // Axis border
    ctx.strokeStyle = THEME.axisLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartRight + 0.5, chartTop);
    ctx.lineTo(chartRight + 0.5, height - PADDING.bottom);
    ctx.stroke();

    // ─── CROSSHAIR ──────────────────────────────────────────────────────
    const mx = s.mouseX;
    const my = s.mouseY;
    if (mx >= chartLeft && mx <= chartRight && my >= chartTop && my <= chartBottom) {
      // Vertical line
      ctx.strokeStyle = THEME.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(mx) + 0.5, chartTop);
      ctx.lineTo(Math.round(mx) + 0.5, chartBottom);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(chartLeft, Math.round(my) + 0.5);
      ctx.lineTo(chartRight, Math.round(my) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price label on horizontal crosshair
      const crossPrice = yScale.invert(my);
      ctx.fillStyle = THEME.tooltipBg;
      roundRect(ctx, chartRight + 1, my - 9, 67, 18, 3);
      ctx.fill();
      ctx.strokeStyle = THEME.tooltipBorder;
      ctx.lineWidth = 1;
      roundRect(ctx, chartRight + 1, my - 9, 67, 18, 3);
      ctx.stroke();
      ctx.fillStyle = THEME.tooltipText;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(formatPrice(crossPrice), chartRight + 34, my + 4);

      // Find nearest candle for tooltip
      const candleIdx = Math.round(xScale.invert(mx));
      if (candleIdx >= 0 && candleIdx < visible.length) {
        const hoveredCandle = visible[candleIdx];

        // OHLC tooltip box
        drawTooltip(ctx, hoveredCandle, chartLeft + 8, chartTop + 8);

        // Notify parent
        if (onCrosshairMove) onCrosshairMove(hoveredCandle);
      }
    } else {
      if (onCrosshairMove) onCrosshairMove(null);
    }

    ctx.restore();
  }, []); // No deps - uses refs for all data

  // ─── RENDER LOOP ────────────────────────────────────────────────────

  useEffect(() => {
    let lastDrawTime = 0;
    const DRAW_INTERVAL = 33; // ~30fps

    const renderLoop = () => {
      const now = performance.now();
      if (stateRef.current.dirty && now - lastDrawTime >= DRAW_INTERVAL) {
        stateRef.current.dirty = false;
        lastDrawTime = now;
        draw();
      }
      stateRef.current.animFrameId = requestAnimationFrame(renderLoop);
    };

    stateRef.current.animFrameId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(stateRef.current.animFrameId);
  }, [draw]);

  // ─── RESIZE OBSERVER ────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      stateRef.current.width = w;
      stateRef.current.height = h;
      stateRef.current.dpr = dpr;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      stateRef.current.dirty = true;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize(); // Initial size

    return () => observer.disconnect();
  }, []);

  // ─── MOUSE EVENTS ──────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      stateRef.current.mouseX = e.clientX - rect.left;
      stateRef.current.mouseY = e.clientY - rect.top;

      if (stateRef.current.isDragging) {
        // Horizontal drag → scroll candles
        // Positive scrollOffset = into past; Negative = into "future" empty space
        const dx = e.clientX - stateRef.current.dragStartX;
        const pixelsPerCandle = stateRef.current.width / stateRef.current.visibleCount;
        const candleOffset = Math.round(dx / pixelsPerCandle);
        const newOffset = stateRef.current.dragStartOffset + candleOffset;
        // Allow scrolling up to 70% of viewport into future (keeps current candle visible)
        const maxFutureScroll = Math.floor(stateRef.current.visibleCount * 0.7);
        const maxPastScroll = candlesRef.current.length - 10;
        stateRef.current.scrollOffset = Math.max(-maxFutureScroll, Math.min(maxPastScroll, newOffset));

        // Vertical drag → pan price view (inverted: drag down = view moves down)
        const dy = e.clientY - stateRef.current.dragStartY;
        const chartH = stateRef.current.height || 1;
        // Fraction of chart height dragged (negative dy = dragged up = view shifts up)
        const yPanDelta = -dy / chartH;
        const newY = stateRef.current.dragStartYOffset + yPanDelta;
        stateRef.current.yOffset = Math.max(-2, Math.min(2, newY)); // clamp to ±2 screens
      }

      stateRef.current.dirty = true;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // Left click
        stateRef.current.isDragging = true;
        stateRef.current.dragStartX = e.clientX;
        stateRef.current.dragStartY = e.clientY;
        stateRef.current.dragStartOffset = stateRef.current.scrollOffset;
        stateRef.current.dragStartYOffset = stateRef.current.yOffset;
        canvas.style.cursor = 'grabbing';
      }
    };

    // Double-click resets vertical pan (recentre on price)
    const onDoubleClick = (e: MouseEvent) => {
      e.preventDefault();
      stateRef.current.yOffset = 0;
      stateRef.current.dirty = true;
    };

    const onMouseUp = () => {
      stateRef.current.isDragging = false;
      canvas.style.cursor = 'crosshair';
    };

    const onMouseLeave = () => {
      stateRef.current.mouseX = -1;
      stateRef.current.mouseY = -1;
      stateRef.current.isDragging = false;
      canvas.style.cursor = 'crosshair';
      stateRef.current.dirty = true;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+Wheel → vertical pan (scroll past price)
        const panStep = 0.05; // 5% of price range per wheel tick
        const delta = e.deltaY > 0 ? -panStep : panStep;
        const newY = stateRef.current.yOffset + delta;
        stateRef.current.yOffset = Math.max(-2, Math.min(2, newY));
      } else {
        // Regular wheel → horizontal zoom
        const delta = e.deltaY > 0 ? 1.1 : 0.9;
        const newCount = Math.round(stateRef.current.visibleCount * delta);
        stateRef.current.visibleCount = Math.max(20, Math.min(500, newCount));
      }
      stateRef.current.dirty = true;
    };

    const onContextMenuEvt = (e: MouseEvent) => {
      e.preventDefault();
      const scale = priceScaleRef.current;
      const cb = onContextMenuRef.current;
      if (!scale || !cb) return;
      const rect = canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // Linear invert: chartBottom → minPrice, chartTop → maxPrice
      const { minPrice, maxPrice, chartTop, chartBottom } = scale;
      const clampedY = Math.max(chartTop, Math.min(chartBottom, y));
      const frac = (chartBottom - clampedY) / (chartBottom - chartTop);
      const price = minPrice + frac * (maxPrice - minPrice);
      cb(price, e);
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenuEvt);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenuEvt);
      canvas.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden" style={{ background: THEME.bg }}>
      <canvas
        ref={canvasRef}
        style={{ cursor: 'crosshair', display: 'block' }}
      />
      {/* Hidden tooltip div for screen readers / future HTML overlay */}
      <div ref={tooltipRef} className="hidden" />
    </div>
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let step: number;
  if (norm <= 1.5) step = 1;
  else if (norm <= 3) step = 2;
  else if (norm <= 7) step = 5;
  else step = 10;
  return step * pow;
}

function niceTimeStep(candleCount: number, chartWidth: number): number {
  // Target ~80px between time labels
  const maxLabels = Math.floor(chartWidth / 80);
  return Math.max(1, Math.ceil(candleCount / maxLabels));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawTooltip(ctx: CanvasRenderingContext2D, candle: CandleData, x: number, y: number) {
  const isBull = candle.close >= candle.open;
  const w = 160;
  const h = 82;

  // Background
  ctx.fillStyle = THEME.tooltipBg;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = THEME.tooltipBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 4);
  ctx.stroke();

  // Date
  const date = new Date(candle.time * 1000);
  ctx.fillStyle = '#9CA3AF';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${formatDate(date)} ${formatTime(date)}`, x + 8, y + 14);

  // OHLC values
  const labels = [
    { label: 'O', value: candle.open, color: THEME.tooltipText },
    { label: 'H', value: candle.high, color: THEME.bull },
    { label: 'L', value: candle.low, color: THEME.bear },
    { label: 'C', value: candle.close, color: isBull ? THEME.bull : THEME.bear },
  ];

  let ly = y + 30;
  for (const item of labels) {
    ctx.fillStyle = '#6B7280';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(item.label, x + 8, ly);
    ctx.fillStyle = item.color;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(formatPrice(item.value), x + 24, ly);
    ly += 13;
  }

  // Volume
  if (candle.volume !== undefined) {
    ctx.fillStyle = '#6B7280';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`Vol: ${candle.volume.toLocaleString()}`, x + 90, y + 14);
  }
}

export default memo(CandlestickChart);
