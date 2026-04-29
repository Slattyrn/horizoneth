import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { subscribe } from "../lib/ws";
import ChartContextMenu from "./ChartContextMenu";
import CandlestickChart, { CandleData, ZoneLine, OverlayObject } from "./CandlestickChart";
import type { WaveSignal } from './WaveEngine';
import { useTicker } from "../contexts/TickerContext";
import { TICKER_KEYS, TickerKey, isTickerKey } from "../config/tickers";
import TickerToggle from "./TickerToggle";

// FIXED: Removed lightweight-charts import — replaced with custom D3 canvas chart

export interface FVG {
  time: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  entry: number;
}

type Timeframe = '1m' | '2m' | '3m' | '5m' | '10m' | '30m';

interface ChartPanelProps {
  className?: string;
  onOrderPlacement?: (order: any) => void;
  upperZone?: number | null;
  lowerZone?: number | null;
  upperZoneR2?: number | null;
  lowerZoneS2?: number | null;
  r3Zone?: number | null;
  s3Zone?: number | null;
  r4Zone?: number | null;
  s4Zone?: number | null;
  zoneSize?: number;
  fvgEnabled?: boolean;
  enabledEdges?: {
    wave: boolean;
    rangePlay: boolean;
    dropOff: boolean;
    manual: boolean;
  };
  onEdgesChange?: (edges: any) => void;
  onCandlesUpdate?: (candles: CandleData[], timeframe: string) => void;
  onLatestCandle?: (candle: CandleData) => void;
  onCancelAllOrders?: () => void;
  onFVGDetection?: (fvg: FVG | null) => void;
  waveSignals?: WaveSignal[];
  // FIXED: Accept extra props from App.tsx that were previously silently ignored
  [key: string]: any;
}

const TIMEFRAMES: { label: string; value: Timeframe; minutes: number }[] = [
  { label: '1m', value: '1m', minutes: 1 },
  { label: '2m', value: '2m', minutes: 2 },
  { label: '3m', value: '3m', minutes: 3 },
  { label: '5m', value: '5m', minutes: 5 },
  { label: '10m', value: '10m', minutes: 10 },
  { label: '30m', value: '30m', minutes: 30 },
];

function getMinutesForTimeframe(tf: Timeframe): number {
  const tfInfo = TIMEFRAMES.find(t => t.value === tf);
  return tfInfo?.minutes || 5;
}

// Aggregate 1m bars up to the target timeframe. Used for both initial history
// load and in-memory timeframe switches so we never need to re-hit the history
// endpoint (which disconnects SignalR).
function aggregate1mBars(oneMinBars: CandleData[], targetMinutes: number): CandleData[] {
  if (oneMinBars.length === 0) return [];
  if (targetMinutes === 1) return oneMinBars.slice().sort((a, b) => a.time - b.time);
  const targetSeconds = targetMinutes * 60;
  const aggregated = new Map<number, CandleData>();
  const sorted = oneMinBars.slice().sort((a, b) => a.time - b.time);
  for (const bar of sorted) {
    const bucket = Math.floor(bar.time / targetSeconds) * targetSeconds;
    const agg = aggregated.get(bucket);
    if (agg) {
      agg.high = Math.max(agg.high, bar.high);
      agg.low = Math.min(agg.low, bar.low);
      agg.close = bar.close;
      agg.volume = (agg.volume || 0) + (bar.volume || 0);
    } else {
      aggregated.set(bucket, {
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0,
      });
    }
  }
  return Array.from(aggregated.values()).sort((a, b) => a.time - b.time);
}

function getApiInterval(tf: Timeframe): number {
  const minutes = getMinutesForTimeframe(tf);
  if (minutes < 5) return 1;
  return 5;
}

async function fetchHistoricalBars(timeframe: Timeframe, contract: string): Promise<CandleData[]> {
  const targetMinutes = getMinutesForTimeframe(timeframe);
  const apiInterval = getApiInterval(timeframe);

  try {
    const url = `/api/history/bars?symbol=${contract}&interval=${apiInterval}&limit=10000`;
    console.log(`Fetching bars: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      console.error('Failed to fetch bars:', response.status);
      const fallbackResponse = await fetch(`/api/candles?symbol=${contract}&interval=${apiInterval}&limit=10000`);
      if (!fallbackResponse.ok) return [];
      const bars = await fallbackResponse.json();
      return processApiResponse(bars, targetMinutes, apiInterval);
    }

    const bars = await response.json();
    if (!bars || bars.length === 0) return [];

    return processApiResponse(bars, targetMinutes, apiInterval);
  } catch (error) {
    console.error('Error fetching historical bars:', error);
    return [];
  }
}

function processApiResponse(bars: any[], targetMinutes: number, sourceMinutes: number): CandleData[] {
  if (!bars || bars.length === 0) return [];

  const sortedBars = [...bars].sort((a: any, b: any) => {
    const timeA = typeof a.t === 'string' ? new Date(a.t).getTime() : a.t * 1000;
    const timeB = typeof b.t === 'string' ? new Date(b.t).getTime() : b.t * 1000;
    return timeA - timeB;
  });

  const converted: CandleData[] = sortedBars.map((bar: any) => {
    let timestamp: number;
    if (typeof bar.t === 'string') {
      timestamp = Math.floor(new Date(bar.t).getTime() / 1000);
    } else if (typeof bar.t === 'number') {
      timestamp = bar.t < 10000000000 ? bar.t : Math.floor(bar.t / 1000);
    } else {
      timestamp = Math.floor(Date.now() / 1000);
    }

    return {
      time: timestamp,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v || 0,
    };
  });

  if (targetMinutes === sourceMinutes) return converted;

  if (targetMinutes > sourceMinutes) {
    const targetSeconds = targetMinutes * 60;
    const aggregated: Map<number, CandleData> = new Map();

    for (const candle of converted) {
      const aggregatedTime = Math.floor(candle.time / targetSeconds) * targetSeconds;

      if (aggregated.has(aggregatedTime)) {
        const existing = aggregated.get(aggregatedTime)!;
        existing.high = Math.max(existing.high, candle.high);
        existing.low = Math.min(existing.low, candle.low);
        existing.close = candle.close;
        existing.volume = (existing.volume || 0) + (candle.volume || 0);
      } else {
        aggregated.set(aggregatedTime, {
          time: aggregatedTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume || 0,
        });
      }
    }

    return Array.from(aggregated.values()).sort((a, b) => a.time - b.time);
  }

  return converted;
}

interface IndicatorState {
  ema6: boolean;
  ema12: boolean;
  ema18: boolean;
  ema35: boolean;
  rthVwap: boolean;
  pdhPdl: boolean;
}

interface PdhPdlLevels {
  psh?: number;
  psl?: number;
  onh?: number;
  onl?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHART PANEL - Data management + UI wrapper for CandlestickChart
// ═══════════════════════════════════════════════════════════════════════════════

export default function ChartPanel({
  className = "",
  upperZone, lowerZone, upperZoneR2, lowerZoneS2,
  r3Zone, s3Zone, r4Zone, s4Zone,
  zoneSize = 6,
  fvgEnabled = false,
  enabledEdges,
  onEdgesChange,
  onCandlesUpdate,
  onLatestCandle,
  onCancelAllOrders,
  onOrderPlacement,
  onFVGDetection,
  waveSignals = [],
}: ChartPanelProps) {
  // FIXED: Removed all lightweight-charts refs (chartRef, seriesRef, volumeSeriesRef, ema*Ref, priceLineRefsRef)

  // Active ticker (MYM or MES) — drives contract id, display strings, and which
  // per-ticker candle map is visible. Both tickers stream in the background so
  // switching is near-instant.
  const { activeTicker, activeConfig } = useTicker();

  // Per-ticker candle backing stores. Both tickers accumulate candles continuously
  // regardless of which one is currently displayed. `candlesMapRef` / `baseCandlesMapRef`
  // always point to the ACTIVE ticker's map and are kept in sync on switch.
  const candlesStoreRef = useRef<Record<TickerKey, Map<number, CandleData>>>({
    MGC: new Map(),
  });
  const baseCandlesStoreRef = useRef<Record<TickerKey, Map<number, CandleData>>>({
    MGC: new Map(),
  });

  const candlesMapRef = useRef<Map<number, CandleData>>(candlesStoreRef.current[activeTicker]);
  // 1m base buffer — always fed by the tick stream regardless of the selected
  // timeframe. On TF switch we re-bucket this into the display map instead of
  // clearing + refetching (history endpoint disconnects SignalR).
  const baseCandlesMapRef = useRef<Map<number, CandleData>>(baseCandlesStoreRef.current[activeTicker]);

  // Mirror of activeTicker into a ref so the subscribe callback (which only
  // closes over its initial value) always reads the latest ticker on every tick.
  const activeTickerRef = useRef<TickerKey>(activeTicker);
  useEffect(() => { activeTickerRef.current = activeTicker; }, [activeTicker]);
  const lastCandleTimeRef = useRef<number>(0);
  const tickCountRef = useRef(0);
  const currentPriceRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef(Date.now());
  const isLoadingRef = useRef(false);
  const lastSaveTimeRef = useRef(0);
  const prevPriceRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Server-to-local clock offset in ms. Updated from every tick that carries
  // a server timestamp so the countdown lines up with actual bar closes on
  // TopstepX (not our local clock + network latency).
  const serverOffsetMsRef = useRef<number | null>(null);

  // Cumulative VWAP state (reset daily)
  const vwapCumTPVRef = useRef(0);    // cumulative(typicalPrice * volume)
  const vwapCumVolRef = useRef(0);    // cumulative(volume)
  const vwapBarCountRef = useRef(0);  // fallback: count of bars (when no volume)
  const vwapCumTPRef = useRef(0);     // fallback: sum of typicalPrice
  const vwapDateRef = useRef<string>('');  // track date for daily reset

  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('5m');
  const [candleCountdown, setCandleCountdown] = useState<string>('--:--');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');
  const [ticksPerSecond, setTicksPerSecond] = useState<number>(0);
  const [candleCount, setCandleCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; price: number } | null>(null);
  const [showVolume, setShowVolume] = useState(false);
  const [showEdgesMenu, setShowEdgesMenu] = useState(false);
  const [showFvg, setShowFvg] = useState(fvgEnabled);
  const [indicators, setIndicators] = useState<IndicatorState>({
    ema6: true,
    ema12: true,
    ema18: true,
    ema35: false,
    rthVwap: false,
    pdhPdl: false
  });

  const [pdhPdlLevels, setPdhPdlLevels] = useState<PdhPdlLevels>({});

  // Chart data state - the sorted candle array passed to CandlestickChart
  const [chartCandles, setChartCandles] = useState<CandleData[]>([]);

  const activeEdgesCount = enabledEdges ? Object.values(enabledEdges).filter(Boolean).length : 0;

  // ─── INDICATOR CALCULATION ──────────────────────────────────────────

  const calculateEMA = useCallback((data: CandleData[], period: number): number[] => {
    if (data.length < period) return [];
    const prices = data.map(d => d.close);
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);
    let prevEma = prices[0];

    for (let i = 1; i < prices.length; i++) {
      const currentEma = (prices[i] - prevEma) * multiplier + prevEma;
      ema.push(currentEma);
      prevEma = currentEma;
    }
    return ema;
  }, []);

  // RTH VWAP: resets daily at 09:30 ET, freezes (holds last value) after 16:30 ET.
  // Bars outside [09:30, 16:30] on a given date get NaN (renderer breaks the path).
  const calculateRthVwap = useCallback((data: CandleData[]): number[] => {
    const out: number[] = new Array(data.length).fill(NaN);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    let currentDate = '';
    let tpv = 0;
    let vol = 0;
    let frozen = NaN; // holds the 16:30 close-out value for post-session rendering

    for (let i = 0; i < data.length; i++) {
      const bar = data[i];
      const parts = fmt.formatToParts(new Date(bar.time * 1000));
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
      const date = `${get('year')}-${get('month')}-${get('day')}`;
      const mins = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);

      if (date !== currentDate) {
        currentDate = date;
        tpv = 0;
        vol = 0;
        frozen = NaN;
      }

      const inWindow = mins >= 9 * 60 + 30 && mins <= 16 * 60 + 30;
      if (inWindow) {
        const typ = (bar.high + bar.low + bar.close) / 3;
        const v = bar.volume ?? 0;
        tpv += typ * v;
        vol += v;
        if (vol > 0) {
          const vwap = tpv / vol;
          out[i] = vwap;
          frozen = vwap;
        }
      } else if (mins > 16 * 60 + 30 && isFinite(frozen)) {
        // Post-session: hold the last value until the date rolls
        out[i] = frozen;
      }
    }

    return out;
  }, []);

  const calculateVWAP = useCallback((data: CandleData[]): number[] => {
    const vwap: number[] = [];
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (const candle of data) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeTPV += typicalPrice * (candle.volume || 1);
      cumulativeVolume += (candle.volume || 1);
      vwap.push(cumulativeTPV / cumulativeVolume);
    }
    return vwap;
  }, []);

  // Compute indicator arrays from current candle data
  const computedIndicators = useMemo(() => {
    if (chartCandles.length === 0) return undefined;
    const result: Record<string, number[]> = {};

    if (indicators.ema6) result.ema6 = calculateEMA(chartCandles, 6);
    if (indicators.ema12) result.ema12 = calculateEMA(chartCandles, 12);
    if (indicators.ema18) result.ema18 = calculateEMA(chartCandles, 18);
    if (indicators.ema35) result.ema35 = calculateEMA(chartCandles, 35);
    if (indicators.rthVwap) result.rthVwap = calculateRthVwap(chartCandles);

    return Object.keys(result).length > 0 ? result : undefined;
  }, [chartCandles, indicators, calculateEMA, calculateRthVwap]);

  // Fetch PDH/PDL/PMH/PML levels when toggle is enabled
  useEffect(() => {
    if (!indicators.pdhPdl) {
      setPdhPdlLevels({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/levels/pdh-pdl');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!cancelled) setPdhPdlLevels(data);
      } catch (e) {
        console.warn('Failed to fetch PDH/PDL levels:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [indicators.pdhPdl]);

  // Build PDH/PDL level lines for the chart
  const pdhPdlLines = useMemo((): ZoneLine[] => {
    if (!indicators.pdhPdl) return [];
    const lines: ZoneLine[] = [];
    if (pdhPdlLevels.psh) lines.push({ price: pdhPdlLevels.psh, color: '#3b82f6', label: 'PSH', lineWidth: 1, dashed: true });
    if (pdhPdlLevels.psl) lines.push({ price: pdhPdlLevels.psl, color: '#3b82f6', label: 'PSL', lineWidth: 1, dashed: true });
    if (pdhPdlLevels.onh) lines.push({ price: pdhPdlLevels.onh, color: '#ec4899', label: 'ONH', lineWidth: 1, dashed: true });
    if (pdhPdlLevels.onl) lines.push({ price: pdhPdlLevels.onl, color: '#ec4899', label: 'ONL', lineWidth: 1, dashed: true });
    return lines;
  }, [indicators.pdhPdl, pdhPdlLevels]);

  // ─── WAVE ENGINE OVERLAYS ─────────────────────────────────────────
  const waveOverlays = useMemo<OverlayObject[]>(() => {
    if (!waveSignals || waveSignals.length === 0) return [];
    const overlays: OverlayObject[] = [];

    for (const sig of waveSignals) {
      switch (sig.type) {
        case 'entry':
          overlays.push({
            type: 'arrow',
            time: sig.time,
            price: sig.price,
            color: sig.side === 1 ? '#00D9FF' : '#FF6B6B',
            direction: sig.side === 1 ? 'up' : 'down',
            label: sig.label,
          });
          break;
        case 'sl':
          overlays.push({
            type: 'line',
            time: sig.time,
            price: sig.price,
            color: '#ef4444',
            style: 'dashed',
            label: sig.label,
            opacity: 0.7,
          });
          break;
        case 'tp':
          overlays.push({
            type: 'line',
            time: sig.time,
            price: sig.price,
            color: '#22c55e',
            style: 'dashed',
            label: sig.label,
            opacity: 0.7,
          });
          break;
        case 'rolling_sl':
          overlays.push({
            type: 'dot',
            time: sig.time,
            price: sig.price,
            color: '#f59e0b',
            opacity: 0.8,
          });
          break;
        case 'pb':
          overlays.push({
            type: 'label',
            time: sig.time,
            price: sig.side === 1 ? sig.price - 2 : sig.price + 2,
            color: '#a855f7',
            label: sig.label || 'PB',
            opacity: 0.9,
          });
          break;
        case 'rec':
          overlays.push({
            type: 'label',
            time: sig.time,
            price: sig.side === 1 ? sig.price + 2 : sig.price - 2,
            color: '#06b6d4',
            label: sig.label || 'REC',
            opacity: 0.9,
          });
          break;
        case 'armed':
          overlays.push({
            type: 'label',
            time: sig.time,
            price: sig.side === 1 ? sig.price + 4 : sig.price - 4,
            color: '#f59e0b',
            label: 'ARMED',
            opacity: 0.9,
          });
          break;
        case 'timeout':
          overlays.push({
            type: 'label',
            time: sig.time,
            price: sig.price,
            color: '#6B7280',
            label: sig.label || 'TIMEOUT',
            opacity: 0.6,
          });
          break;
        case 'vwap_reset':
          overlays.push({
            type: 'label',
            time: sig.time,
            price: sig.price,
            color: '#a855f7',
            label: 'VWAP X',
            opacity: 0.6,
          });
          break;
      }
    }
    return overlays;
  }, [waveSignals]);

  // ─── ZONE LINES ─────────────────────────────────────────────────────

  const zoneLines = useMemo<ZoneLine[]>(() => {
    const zones: { price: number | null | undefined; color: string; label: string }[] = [
      { price: upperZone, color: '#ef4444', label: 'R1' },
      { price: lowerZone, color: '#22c55e', label: 'S1' },
      { price: upperZoneR2, color: '#f97316', label: 'R2' },
      { price: lowerZoneS2, color: '#06b6d4', label: 'S2' },
      { price: r3Zone, color: '#f59e0b', label: 'R3' },
      { price: s3Zone, color: '#3b82f6', label: 'S3' },
      { price: r4Zone, color: '#eab308', label: 'R4' },
      { price: s4Zone, color: '#6366f1', label: 'S4' },
    ];

    return zones
      .filter((z): z is { price: number; color: string; label: string } =>
        z.price !== null && z.price !== undefined)
      .map(z => ({ price: z.price, color: z.color, label: z.label }));
  }, [upperZone, lowerZone, upperZoneR2, lowerZoneS2, r3Zone, s3Zone, r4Zone, s4Zone]);

  // ─── DATA MANAGEMENT ────────────────────────────────────────────────

  const loadHistoricalData = useCallback(async (tf: Timeframe, merge: boolean = false) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);

    try {
      // Always pull history at 1m granularity so the base buffer is deep from
      // the first load. Every displayed TF is derived from this base via
      // aggregate1mBars — TF switches then never need to re-hit the history
      // endpoint (which disconnects SignalR).
      const oneMin = await fetchHistoricalBars('1m', activeConfig.contract);

      if (merge) {
        for (const bar of oneMin) {
          const existing = baseCandlesMapRef.current.get(bar.time);
          if (!existing) baseCandlesMapRef.current.set(bar.time, bar);
        }
      } else {
        // Clear + repopulate in-place so candlesStoreRef and candlesMapRef keep
        // pointing to the SAME Map object. Creating a new Map breaks the tick
        // handler (which writes to the store ref) and the animation frame (which
        // reads candlesMapRef), causing live ticks to never appear on the chart.
        baseCandlesMapRef.current.clear();
        for (const bar of oneMin) baseCandlesMapRef.current.set(bar.time, bar);
      }

      // Aggregate up to the selected TF for display.
      const baseBars = Array.from(baseCandlesMapRef.current.values());
      const display = aggregate1mBars(baseBars, getMinutesForTimeframe(tf));

      if (merge) {
        for (const bar of display) {
          const existing = candlesMapRef.current.get(bar.time);
          if (!existing || bar.time < (lastCandleTimeRef.current || 0)) {
            candlesMapRef.current.set(bar.time, bar);
          }
        }
      } else {
        candlesMapRef.current.clear();
        for (const bar of display) candlesMapRef.current.set(bar.time, bar);
      }

      const sorted = Array.from(candlesMapRef.current.values()).sort((a, b) => a.time - b.time);
      setChartCandles(sorted);
      setCandleCount(sorted.length);

      if (onCandlesUpdate && sorted.length > 0) onCandlesUpdate(sorted, tf);
      if (onLatestCandle && sorted.length > 0) onLatestCandle(sorted[sorted.length - 1]);
    } catch (error) {
      console.error('Error loading historical data:', error);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, [onCandlesUpdate, onLatestCandle]);

  const handleContextMenuAction = useCallback((
    action: 'buy_market' | 'sell_market' | 'buy_stop' | 'sell_stop' | 'buy_limit' | 'sell_limit',
    price: number
  ) => {
    if (!onOrderPlacement) return;

    const side: 'buy' | 'sell' = action.startsWith('buy') ? 'buy' : 'sell';
    const isStop = action.endsWith('_stop');
    const isLimit = action.endsWith('_limit');
    const isMarket = action.endsWith('_market');
    const orderType: 'market' | 'limit' | 'stop' = isStop ? 'stop' : (isLimit ? 'limit' : 'market');

    // MYM trades in 1pt tick increments — snap to nearest integer
    const roundedPrice = Math.round(price);

    if (isMarket) {
      // Market orders: let App.tsx compute dynamic stop/target from 1m EMA6 lookback
      onOrderPlacement({
        symbol: activeConfig.contract,
        side,
        quantity: 0,
        orderType: 'market',
        engine: 'Manual',
      } as any);
      return;
    }

    if (isStop) {
      // Stop orders: same EMA6 dynamic pathway as market orders.
      // Pass only stopPrice (trigger). No stopLoss — App.tsx computes it from the
      // EMA6 wick anchor so sizing + SL + TP are all dynamic, identical to market.
      onOrderPlacement({
        symbol: activeConfig.contract,
        side,
        quantity: 0,
        orderType: 'stop',
        stopPrice: roundedPrice,
        engine: 'Manual',
      } as any);
      return;
    }

    // Limit orders: send as-is, no brackets.
    onOrderPlacement({
      symbol: activeConfig.contract,
      side,
      quantity: 0,
      orderType: 'limit',
      limitPrice: roundedPrice,
      engine: 'Manual',
    } as any);
  }, [onOrderPlacement]);

  const handleTimeframeChange = useCallback((tf: Timeframe) => {
    setSelectedTimeframe(tf);

    // Rebucket the 1m base into the new TF in memory — no history fetch, so
    // SignalR stays connected. If the base hasn't loaded yet (very fresh
    // session), fall back to a history fetch so first paint still works.
    const base = baseCandlesMapRef.current;
    if (base.size === 0) {
      candlesMapRef.current.clear();
      setChartCandles([]);
      loadHistoricalData(tf);
      return;
    }

    const baseBars = Array.from(base.values());
    const display = aggregate1mBars(baseBars, getMinutesForTimeframe(tf));

    // Clear + repopulate in-place — preserves the Map reference so the live
    // tick handler keeps writing to the same object candlesMapRef points at.
    candlesMapRef.current.clear();
    for (const bar of display) candlesMapRef.current.set(bar.time, bar);

    setChartCandles(display);
    setCandleCount(display.length);
    if (onCandlesUpdate && display.length > 0) onCandlesUpdate(display, tf);
    if (onLatestCandle && display.length > 0) onLatestCandle(display[display.length - 1]);
  }, [loadHistoricalData, onCandlesUpdate, onLatestCandle]);

  const toggleEdge = useCallback((edge: 'wave' | 'rangePlay' | 'dropOff' | 'manual') => {
    if (onEdgesChange && enabledEdges) {
      onEdgesChange({ ...enabledEdges, [edge]: !enabledEdges[edge] });
    }
  }, [onEdgesChange, enabledEdges]);

  const toggleIndicator = useCallback((key: keyof IndicatorState) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // On ticker switch: re-point candle refs at the new ticker's persistent store
  // and refresh React state from it. Outgoing ticker's data stays in the store
  // (continues to accumulate from background ticks) so flipping back is instant.
  useEffect(() => {
    candlesMapRef.current = candlesStoreRef.current[activeTicker];
    baseCandlesMapRef.current = baseCandlesStoreRef.current[activeTicker];
    const sorted = Array.from(candlesMapRef.current.values()).sort((a, b) => a.time - b.time);
    setChartCandles(sorted);
    setCandleCount(sorted.length);
    lastCandleTimeRef.current = sorted.length > 0 ? sorted[sorted.length - 1].time : 0;
    if (onCandlesUpdate) onCandlesUpdate(sorted, selectedTimeframe);
    if (onLatestCandle && sorted.length > 0) onLatestCandle(sorted[sorted.length - 1]);
    // Reset VWAP — each ticker has its own price scale / VWAP run.
    vwapCumTPVRef.current = 0;
    vwapCumVolRef.current = 0;
    vwapBarCountRef.current = 0;
    vwapCumTPRef.current = 0;
    // Reset current price display until the new ticker's next tick arrives
    currentPriceRef.current = null;
    setCurrentPrice(null);
    prevPriceRef.current = null;
    console.log(`🔁 Chart switched to ${activeTicker} — ${sorted.length} candles loaded`);
  }, [activeTicker]);

  // Save candles to database
  const saveCandles = useCallback(async () => {
    const sorted = Array.from(candlesMapRef.current.values()).sort((a, b) => a.time - b.time);
    if (sorted.length === 0) return;

    const minutes = getMinutesForTimeframe(selectedTimeframe);
    const timeframe = `${minutes}m`;

    try {
      await fetch('/api/candles/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: activeTicker,
          timeframe: timeframe,
          candles: sorted.slice(-500).map(c => ({
            timestamp: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0,
          })),
        }),
      });
    } catch (e) {
      console.error('Failed to save candles:', e);
    }
  }, [selectedTimeframe, activeTicker]);

  // ─── LIFECYCLE EFFECTS ──────────────────────────────────────────────

  // Candle close countdown — ticks every second, aligned to SERVER UTC
  // boundaries so it matches TradingView's bar close (which buckets on the
  // same server timestamps). Offset comes from the tick stream; falls back to
  // local clock until the first tick arrives.
  useEffect(() => {
    const minutes = getMinutesForTimeframe(selectedTimeframe);
    const totalSec = minutes * 60;

    const tick = () => {
      const serverMs = Date.now() + (serverOffsetMsRef.current ?? 0);
      const nowSec = Math.floor(serverMs / 1000);
      const remaining = totalSec - (nowSec % totalSec);
      if (minutes >= 60) {
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        setCandleCountdown(`${h}:${m.toString().padStart(2, '0')}`);
      } else {
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        setCandleCountdown(`${m}:${s.toString().padStart(2, '0')}`);
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selectedTimeframe]);

  // Load data on mount
  useEffect(() => {
    loadHistoricalData(selectedTimeframe);
  }, []);

  // Tab visibility change - refetch to fill gaps
  useEffect(() => {
    let lastHiddenTime = 0;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        lastHiddenTime = Date.now();
      } else {
        const hiddenDuration = Date.now() - lastHiddenTime;
        const minutesForTf = getMinutesForTimeframe(selectedTimeframe);
        const gapThreshold = minutesForTf * 60 * 1000 * 2;

        if (lastHiddenTime > 0 && hiddenDuration > gapThreshold) {
          loadHistoricalData(selectedTimeframe, true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [selectedTimeframe, loadHistoricalData]);

  // Close edges dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.edges-dropdown') && !target.closest('.edges-trigger')) {
        setShowEdgesMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Context menu handler — price comes from CandlestickChart's yScale at click Y
  const handleChartContextMenu = useCallback((price: number, e: MouseEvent) => {
    // MYM trades in 1pt tick increments — snap to nearest integer
    const snapped = Math.round(price);
    setContextMenu({ x: e.clientX, y: e.clientY, price: snapped });
  }, []);

  // ─── WEBSOCKET TICK HANDLER ─────────────────────────────────────────

  useEffect(() => {
    let isDirty = false;
    let lastUpdateTime = 0;
    let animationFrameId: number;
    const UPDATE_INTERVAL = 33; // ~30fps

    const updateChart = () => {
      const now = Date.now();

      if (isDirty && now - lastUpdateTime > UPDATE_INTERVAL) {
        isDirty = false;
        lastUpdateTime = now;

        // FIXED: Build sorted array and update React state instead of calling seriesRef.update()
        const sorted = Array.from(candlesMapRef.current.values()).sort((a, b) => a.time - b.time);
        if (sorted.length > 0) {
          const lastCandle = sorted[sorted.length - 1];
          lastCandleTimeRef.current = lastCandle.time;

          // Batch state update - only set if count changed or last candle modified
          setChartCandles(sorted);
          setCandleCount(sorted.length);

          if (onCandlesUpdate) onCandlesUpdate(sorted, selectedTimeframe);
          if (onLatestCandle) onLatestCandle(lastCandle);

          // Save to database every 5 seconds
          if (now - lastSaveTimeRef.current > 5000) {
            saveCandles();
            lastSaveTimeRef.current = now;
          }
        }
      }
      animationFrameId = requestAnimationFrame(updateChart);
    };

    const unsubscribe = subscribe((tick: any) => {
      if (typeof tick.price !== 'number') return;

      // Route tick to the correct per-ticker store. Backend broadcasts both MYM
      // and MES simultaneously; the `ticker` field on each tick tells us which.
      // Ticks with an unknown ticker (residual defensive branches in backend for
      // MGC/YM/etc) are dropped so they never contaminate an active ticker's map.
      // Ticks with no ticker field at all fall back to the active ticker.
      let tickTicker: TickerKey;
      if (tick.ticker === undefined || tick.ticker === null) {
        tickTicker = activeTickerRef.current;
      } else if (isTickerKey(tick.ticker)) {
        tickTicker = tick.ticker;
      } else {
        return; // unknown ticker — drop tick
      }
      const isActive = tickTicker === activeTickerRef.current;
      const candlesMap = candlesStoreRef.current[tickTicker];
      const baseMap = baseCandlesStoreRef.current[tickTicker];

      // Only update display state (price, direction, redraw trigger) for the
      // active ticker. Inactive ticker still accumulates candles silently.
      if (isActive) {
        if (prevPriceRef.current !== null) {
          if (tick.price > prevPriceRef.current) setPriceDirection('up');
          else if (tick.price < prevPriceRef.current) setPriceDirection('down');
        }
        prevPriceRef.current = tick.price;

        currentPriceRef.current = tick.price;
        setCurrentPrice(tick.price);
        tickCountRef.current++;
        isDirty = true;
      }

      const now = Date.now();
      // Bucket by the server-normalized tick timestamp, NOT Date.now(). By the
      // time a tick reaches the browser (SignalR → backend → WS → handler), ~50-200ms
      // have passed. Using the local clock drifts bar boundaries vs TopstepX —
      // the end-of-bar tick lands in the next bar, flipping candle colors and
      // producing phantom pullbacks. The backend already normalizes ProjectX's
      // authoritative timestamp into `tick.timestamp` (UTC seconds).
      const tickSec = (typeof tick.timestamp === 'number' && tick.timestamp > 0)
        ? tick.timestamp
        : Math.floor(now / 1000);

      // Track server/local clock offset (ms) from every server-stamped tick
      // regardless of which ticker — network latency is the same for both.
      if (isActive && typeof tick.timestamp === 'number' && tick.timestamp > 0) {
        const sample = tick.timestamp * 1000 - now;
        serverOffsetMsRef.current = serverOffsetMsRef.current === null
          ? sample
          : Math.round(serverOffsetMsRef.current * 0.9 + sample * 0.1);
      }
      const minutes = getMinutesForTimeframe(selectedTimeframe);
      const seconds = minutes * 60;
      const time = Math.floor(tickSec / seconds) * seconds;

      // Daily VWAP reset (check ET date) — only for active ticker; inactive
      // ticker doesn't drive VWAP display.
      if (isActive) {
        const etDate = new Date(now).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
        if (etDate !== vwapDateRef.current) {
          vwapDateRef.current = etDate;
          vwapCumTPVRef.current = 0;
          vwapCumVolRef.current = 0;
          vwapBarCountRef.current = 0;
          vwapCumTPRef.current = 0;
        }
      }

      // SignalR sends `tradeVolume` (per-trade size) on TRADE events and
      // `cumulativeVolume` (running daily total) on QUOTE events. Only tradeVolume
      // is a per-tick delta we can accumulate into the forming bar. `volume` is
      // a generic fallback some paths may set.
      const tickDelta = (typeof tick.tradeVolume === 'number' ? tick.tradeVolume : 0)
                     || (typeof tick.volume === 'number' ? tick.volume : 0);

      // Maintain the 1m base in parallel with the displayed TF so TF switches
      // can re-bucket in place instead of blanking the chart.
      const baseTime = Math.floor(tickSec / 60) * 60;
      const baseExisting = baseMap.get(baseTime);
      if (baseExisting) {
        baseExisting.high = Math.max(baseExisting.high, tick.price);
        baseExisting.low = Math.min(baseExisting.low, tick.price);
        baseExisting.close = tick.price;
        if (tickDelta > 0) baseExisting.volume = (baseExisting.volume || 0) + tickDelta;
      } else {
        baseMap.set(baseTime, {
          time: baseTime,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
          volume: tickDelta,
        });
      }

      const existing = candlesMap.get(time);
      if (existing) {
        existing.high = Math.max(existing.high, tick.price);
        existing.low = Math.min(existing.low, tick.price);
        existing.close = tick.price;
        if (tickDelta > 0) existing.volume = (existing.volume || 0) + tickDelta;
        candlesMap.set(time, existing);
      } else {
        // New candle — previous candle just closed, update cumulative VWAP.
        // VWAP is ticker-specific; only advance for active ticker.
        if (isActive) {
          const prevTime = time - seconds;
          const prevCandle = candlesMap.get(prevTime);
          if (prevCandle) {
            const tp = (prevCandle.high + prevCandle.low + prevCandle.close) / 3;
            const vol = prevCandle.volume || 1;
            vwapCumTPVRef.current += tp * vol;
            vwapCumVolRef.current += vol;
            vwapCumTPRef.current += tp;
            vwapBarCountRef.current += 1;
          }
        }

        candlesMap.set(time, {
          time,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
          volume: tickDelta,
        });
      }

      // Compute current cumulative VWAP including the forming candle (active ticker only)
      if (isActive) {
        const currentCandle = candlesMap.get(time)!;
        const curTP = (currentCandle.high + currentCandle.low + currentCandle.close) / 3;
        const curVol = currentCandle.volume || 1;
        const totalTPV = vwapCumTPVRef.current + curTP * curVol;
        const totalVol = vwapCumVolRef.current + curVol;
        currentCandle.vwap = totalVol > 0 ? totalTPV / totalVol : curTP;
      }
    });

    animationFrameId = requestAnimationFrame(updateChart);
    return () => { unsubscribe(); cancelAnimationFrame(animationFrameId); };
  }, [selectedTimeframe, onCandlesUpdate, onLatestCandle, saveCandles]);

  // Ticks per second counter
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastTickTimeRef.current) / 1000;
      if (elapsed > 0) {
        setTicksPerSecond(Math.round(tickCountRef.current / elapsed));
        tickCountRef.current = 0;
        lastTickTimeRef.current = Date.now();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ─── RENDER ─────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-full bg-[#0A0C0F] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-gradient-to-r from-[#0A0C0F] via-[#0D1117] to-[#0A0C0F]">
        {/* Ticker + Price */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2">
                <div className="absolute w-2 h-2 bg-green-500 rounded-full animate-ping opacity-75" />
                <div className="absolute w-2 h-2 bg-green-400 rounded-full" />
              </div>
              <div
                key={activeConfig.key}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#00D9FF]/15 to-[#00D9FF]/5 border border-[#00D9FF]/30 backdrop-blur-sm animate-[fadeIn_220ms_ease-out]"
              >
                <span className="text-[#00D9FF] font-bold text-sm tracking-wider">{activeConfig.key}</span>
                <span className="text-white/30 text-xs">|</span>
                <span className="text-white/60 text-xs font-medium">{activeConfig.exchange}</span>
              </div>
            </div>
            <div key={activeConfig.key} className="hidden sm:block animate-[fadeIn_220ms_ease-out]">
              <div className="text-white/80 text-sm font-medium">{activeConfig.displayName}</div>
              <div className="text-white/30 text-[10px] uppercase tracking-wider">Futures</div>
            </div>
            <TickerToggle />
          </div>

          <div className="h-8 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />

          {/* Live Price */}
          <div className="flex items-center gap-3">
            <div className={`relative overflow-hidden rounded-lg px-4 py-2 ${priceDirection === 'up'
              ? 'bg-gradient-to-r from-green-500/20 to-green-500/5 border border-green-500/30'
              : priceDirection === 'down'
                ? 'bg-gradient-to-r from-red-500/20 to-red-500/5 border border-red-500/30'
                : 'bg-white/5 border border-white/10'
              }`}>
              <div className={`absolute inset-0 blur-xl opacity-30 ${priceDirection === 'up' ? 'bg-green-500' : priceDirection === 'down' ? 'bg-red-500' : 'bg-white/10'}`} />
              <div className="relative flex items-center gap-2">
                <div className={`transition-all duration-150 ${priceDirection === 'up' ? 'text-green-400' : priceDirection === 'down' ? 'text-red-400' : 'text-white/30'}`}>
                  {priceDirection === 'up' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  ) : priceDirection === 'down' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
                  )}
                </div>
                <span className={`font-mono font-bold text-xl tracking-tight transition-colors duration-150 ${priceDirection === 'up' ? 'text-green-400' : priceDirection === 'down' ? 'text-red-400' : 'text-white'}`}>
                  {currentPrice?.toFixed(2) || '-----.--'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isLoading && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#00D9FF]/10 border border-[#00D9FF]/20">
                  <div className="w-1.5 h-1.5 bg-[#00D9FF] rounded-full animate-pulse" />
                  <span className="text-[#00D9FF] text-[10px] font-medium uppercase tracking-wider">Loading</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5">
                <span className="text-white/40 text-[10px] font-mono">{ticksPerSecond}</span>
                <span className="text-white/20 text-[10px]">t/s</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5">
                <span className="text-white/40 text-[10px] font-mono">{candleCount}</span>
                <span className="text-white/20 text-[10px]">bars</span>
              </div>
            </div>
          </div>
        </div>

        {/* Timeframes */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => handleTimeframeChange(tf.value)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all duration-150 ${selectedTimeframe === tf.value
                ? 'bg-[#00D9FF]/20 text-[#00D9FF] shadow-lg shadow-[#00D9FF]/10'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Indicators + Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
            {(['ema6', 'ema12', 'ema18', 'ema35', 'rthVwap', 'pdhPdl'] as const).map((ind) => {
              const label = ind === 'pdhPdl' ? 'PDH/PDL' : ind === 'rthVwap' ? 'VWAP' : ind.toUpperCase().replace('EMA', 'E');
              return (
                <button
                  key={ind}
                  onClick={() => toggleIndicator(ind)}
                  className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${indicators[ind] ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setShowVolume(!showVolume)}
            className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${showVolume ? 'bg-[#00D9FF]/20 text-[#00D9FF]' : 'text-white/30 hover:text-white/50'}`}
          >
            VOL
          </button>

          {/* Edges Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowEdgesMenu(!showEdgesMenu)}
              className={`edges-trigger px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${showEdgesMenu || activeEdgesCount > 0
                ? 'bg-[#00D9FF]/15 text-[#00D9FF] border border-[#00D9FF]/30'
                : 'text-white/40 hover:text-white/60 bg-white/5 border border-transparent'
                }`}
            >
              Edges
              {activeEdgesCount > 0 && (
                <span className="bg-[#00D9FF] text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {activeEdgesCount}
                </span>
              )}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`transition-transform ${showEdgesMenu ? 'rotate-180' : ''}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {showEdgesMenu && (
              <div className="edges-dropdown absolute top-full right-0 mt-2 rounded-xl bg-[#1A1E24] border border-white/10 shadow-2xl z-50 overflow-hidden min-w-[160px]">
                <div className="p-2 space-y-1">
                  {[
                    { key: 'wave', label: 'Wave', color: '#00D9FF', desc: 'ORB Breakout' },
                    { key: 'rangePlay', label: 'Range Play', color: '#00FF88', desc: 'Zone Bounces' },
                    { key: 'dropOff', label: 'Drop Off', color: '#f97316', desc: 'R1/S1 Fades' },
                    { key: 'manual', label: 'Manual', color: '#a855f7', desc: 'Chart Orders' },
                  ].map((edge) => {
                    const isActive = enabledEdges?.[edge.key as keyof typeof enabledEdges];
                    return (
                      <button
                        key={edge.key}
                        onClick={() => toggleEdge(edge.key as 'wave' | 'rangePlay' | 'dropOff' | 'manual')}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full transition-all ${isActive ? 'scale-100' : 'scale-75 opacity-50'}`} style={{ backgroundColor: edge.color }} />
                          <div className="text-left">
                            <div className={`text-xs font-medium ${isActive ? 'text-white' : 'text-white/60'}`}>{edge.label}</div>
                            <div className="text-[9px] text-white/30">{edge.desc}</div>
                          </div>
                        </div>
                        <div className={`w-8 h-4 rounded-full transition-all flex items-center ${isActive ? 'bg-green-500/30 justify-end' : 'bg-white/10 justify-start'}`}>
                          <div className={`w-3 h-3 rounded-full mx-0.5 transition-all ${isActive ? 'bg-green-400' : 'bg-white/30'}`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart - FIXED: Replaced lightweight-charts div with CandlestickChart canvas component */}
      <div ref={chartContainerRef} className="flex-1 relative overflow-hidden">
        <CandlestickChart
          candles={chartCandles}
          currentPrice={currentPrice}
          zones={[...zoneLines, ...pdhPdlLines]}
          showVolume={showVolume}
          indicators={computedIndicators}
          overlays={waveOverlays}
          candleCountdown={candleCountdown}
          onContextMenu={handleChartContextMenu}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-[#0A0C0F]">
        <div className="flex items-center gap-1">
          {[
            { key: 'wave', label: 'Wave', color: '#00D9FF' },
            { key: 'rangePlay', label: 'RP', color: '#00FF88' },
            { key: 'dropOff', label: 'Drop', color: '#f97316' },
            { key: 'manual', label: 'Manual', color: '#a855f7' },
          ].map((edge) => {
            const isActive = enabledEdges?.[edge.key as keyof typeof enabledEdges];
            return (
              <button
                key={edge.key}
                onClick={() => toggleEdge(edge.key as 'wave' | 'rangePlay' | 'dropOff' | 'manual')}
                className={`px-2 py-1 rounded text-[10px] font-mono transition-all flex items-center gap-1.5 ${isActive ? 'bg-white/10' : 'opacity-40 hover:opacity-70'}`}
                style={{ color: isActive ? edge.color : 'rgba(255,255,255,0.3)' }}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? '' : 'opacity-50'}`} style={{ backgroundColor: edge.color }} />
                {edge.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono text-white/30">
          <span>{new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} EST</span>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ChartContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          price={contextMenu.price}
          currentPrice={currentPrice || undefined}
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
          onResetZoom={() => {}}
          onCancelAll={onCancelAllOrders}
        />
      )}
    </div>
  );
}
