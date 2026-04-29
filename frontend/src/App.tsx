import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import ChartPanel from "./components/ChartPanel";
import OrdersPanel from "./components/OrdersPanel";
import FVGFinder from "./components/FVGFinder";
import MetricsBar from "./components/MetricsBar";
import AccountSwitcher from "./components/AccountSwitcher";
import LiveDataPanel from "./components/LiveDataPanel";
import PnLDisplay from "./components/PnLDisplay";
import WaveEngine from "./components/WaveEngine";
import AutomationStatus from "./components/AutomationStatus";
import AutomationConfig from "./components/AutomationConfig";
import AutomationControlPanel from "./components/AutomationControlPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AutomationConfig as AutomationConfigType, AutomationState, CandleData } from "./hooks/useAutomation";
import { useDynamicTitle } from "./hooks/useDynamicTitle";
import { AccountProvider, useAccount } from "./contexts/AccountContext";
import { useTicker } from "./contexts/TickerContext";
import { Activity, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { subscribe } from "./lib/ws";
import { snapToTickOrUndefined } from "./utils/snapToTick";

// FVG interface (matching ChartPanel export)
interface FVG {
  time: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  entry: number;
  endTime?: number;
  middleCandle: CandleData;
}

// OrderData interface for automation orders
interface OrderData {
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  stopOrderId: string | null;
  tpOrderId: string | null;
}

export default function App() {
  const { activeTicker, activeConfig } = useTicker();
  const [showSidebar, setShowSidebar] = useState(false); // Tab system state (Default: Closed)
  const selectedTicker = activeTicker; // Driven by TickerContext (MYM or MES)
  const [upperZone, setUpperZone] = useState<number | null>(null);
  const [lowerZone, setLowerZone] = useState<number | null>(null);
  const [r1Zone, setR1Zone] = useState<number | null>(null);            // 🆕 R1 (Resistance 1)
  const [s1Zone, setS1Zone] = useState<number | null>(null);            // 🆕 S1 (Support 1)
  const [upperZoneR2, setUpperZoneR2] = useState<number | null>(null);  // 🆕 R2 (Resistance 2)
  const [lowerZoneS2, setLowerZoneS2] = useState<number | null>(null);  // 🆕 S2 (Support 2)

  // 🚨 CRITICAL FIX: Wrapper functions to round zones to 2 decimals (prevents floating point drift)
  const setUpperZoneRounded = useCallback((value: number | null) => {
    if (value === null) {
      setUpperZone(null);
    } else {
      setUpperZone(Math.round(value * 100) / 100); // Round to 0.01 precision
    }
  }, []);

  const setLowerZoneRounded = useCallback((value: number | null) => {
    if (value === null) {
      setLowerZone(null);
    } else {
      setLowerZone(Math.round(value * 100) / 100); // Round to 0.01 precision
    }
  }, []);

  const setR1ZoneRounded = useCallback((value: number | null) => {
    if (value === null) {
      setR1Zone(null);
    } else {
      setR1Zone(Math.round(value * 100) / 100); // Round to 0.01 precision
    }
  }, []);

  const setS1ZoneRounded = useCallback((value: number | null) => {
    if (value === null) {
      setS1Zone(null);
    } else {
      setS1Zone(Math.round(value * 100) / 100); // Round to 0.01 precision
    }
  }, []);

  const setUpperZoneR2Rounded = useCallback((value: number | null) => {
    if (value === null) {
      setUpperZoneR2(null);
    } else {
      setUpperZoneR2(Math.round(value * 100) / 100); // Round to 0.01 precision
    }
  }, []);

  const setLowerZoneS2Rounded = useCallback((value: number | null) => {
    if (value === null) {
      setLowerZoneS2(null);
    } else {
      setLowerZoneS2(Math.round(value * 100) / 100); // Round to 0.01 precision
    }
  }, []);
  const [openPrice, setOpenPrice] = useState<number | null>(null);

  // 🆕 R3/S3 and R4/S4 Zones
  const [r3Zone, setR3Zone] = useState<number | null>(null);
  const [s3Zone, setS3Zone] = useState<number | null>(null);
  const [r4Zone, setR4Zone] = useState<number | null>(null);
  const [s4Zone, setS4Zone] = useState<number | null>(null);

  const setR3ZoneRounded = useCallback((value: number | null) => {
    if (value === null) setR3Zone(null);
    else setR3Zone(Math.round(value * 100) / 100);
  }, []);

  const setS3ZoneRounded = useCallback((value: number | null) => {
    if (value === null) setS3Zone(null);
    else setS3Zone(Math.round(value * 100) / 100);
  }, []);

  const setR4ZoneRounded = useCallback((value: number | null) => {
    if (value === null) setR4Zone(null);
    else setR4Zone(Math.round(value * 100) / 100);
  }, []);

  const setS4ZoneRounded = useCallback((value: number | null) => {
    if (value === null) setS4Zone(null);
    else setS4Zone(Math.round(value * 100) / 100);
  }, []);

  // 🆕 Individual zone sizes (4-6pts per zone)
  const [zoneSizes, setZoneSizes] = useState<{
    upper: number;
    lower: number;
    r1: number;
    s1: number;
    r2: number;
    s2: number;
    r3: number;
    s3: number;
    r4: number;
    s4: number;
  }>({
    upper: 6,
    lower: 6,
    r1: 6,
    s1: 6,
    r2: 6,
    s2: 6,
    r3: 6,
    s3: 6,
    r4: 6,
    s4: 6
  });

  const [volumeMultiplier, setVolumeMultiplier] = useState<number>(1.05);
  const [volumeEnabled, setVolumeEnabled] = useState<boolean>(true);
  const [fvgEnabled, setFvgEnabled] = useState<boolean>(true);
  const [bullishFvgCount, setBullishFvgCount] = useState<number>(0);
  const [bearishFvgCount, setBearishFvgCount] = useState<number>(0);
  const [latestFVG, setLatestFVG] = useState<FVG | null>(null);
  const [recentFVGs, setRecentFVGs] = useState<FVG[]>([]); // All recent FVGs for multi-order placement
  const [orderSuggestion, setOrderSuggestion] = useState<OrderSuggestion | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [dailyOpen, setDailyOpen] = useState<number | null>(null);
  const [dailyHigh, setDailyHigh] = useState<number | null>(null);
  const [dailyLow, setDailyLow] = useState<number | null>(null);
  const [orderLines, setOrderLines] = useState<{
    limitPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    orderType: 'buy' | 'sell';
    entryPrice?: number | null;
    isFilled?: boolean;
  } | null>(null);

  // Update browser tab title with ticker and price
  useDynamicTitle(selectedTicker, currentPrice, openPrice);

  // Automation state
  const [automationEnabled, setAutomationEnabled] = useState<boolean>(true);

  // 🚨 CIRCUIT BREAKER: Track daily P&L and trade count
  const [dailyRealizedPnL, setDailyRealizedPnL] = useState<number>(0);
  const [dailyTradeCount, setDailyTradeCount] = useState<number>(0);
  const lastSessionDateRef = useRef<string | null>(null);

  // Wrapper to log automation state changes and prevent accidental unmounting
  const handleAutomationToggle = (enabled: boolean) => {
    console.log(`🔄 Automation ${enabled ? 'STARTED' : 'STOPPED'}`);
    setAutomationEnabled(enabled);
  };
  const [automationConfig, setAutomationConfig] = useState<AutomationConfigType>({
    enabled: false,
    timeframe: '5m',
    volumeMultiplier: 1.05,
    volumeCandles: 2,
    targetRiskMin: 495,
    targetRiskMax: 515,
    tickSize: activeConfig.tickSize,
    tickValue: activeConfig.tickValue,
    breakEvenTrigger: 10,
    maxDailyTrades: 2,
    maxDailyLoss: 425,
    autoPlaceOrders: false,
    autoManageStops: true
  });

  // Keep automationConfig.tickSize/tickValue in sync with the active ticker.
  // When user switches MYM ↔ MES, tick grid + $/tick update automatically so
  // Wave engine and risk sizing always match the currently-traded instrument.
  useEffect(() => {
    setAutomationConfig(prev => (
      prev.tickSize === activeConfig.tickSize && prev.tickValue === activeConfig.tickValue
        ? prev
        : { ...prev, tickSize: activeConfig.tickSize, tickValue: activeConfig.tickValue }
    ));
  }, [activeConfig.tickSize, activeConfig.tickValue]);

  // Stop automation on ticker switch — matches user requirement that only one
  // ticker has live automation at any moment (option 2 from design). User must
  // re-enable automation explicitly on the new ticker.
  const prevTickerRef = useRef(activeTicker);
  useEffect(() => {
    if (prevTickerRef.current !== activeTicker) {
      console.log(`🔁 Ticker switched ${prevTickerRef.current} → ${activeTicker} — stopping automation`);
      setAutomationEnabled(false);
      prevTickerRef.current = activeTicker;
    }
  }, [activeTicker]);

  // Edge selection state (Wave + Manual only)
  const [enabledEdges, setEnabledEdges] = useState<{
    wave: boolean;
    manual: boolean;
  }>({
    wave: true,
    manual: true,
  });

  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('5m');
  const [candles, setCandles] = useState<CandleData[]>([]);

  // Candle state for Wave engine — primary `candles` tracks the selected TF.
  const [candles5min, setCandles5min] = useState<CandleData[]>([]);
  const [candles1min, setCandles1min] = useState<CandleData[]>([]);
  const [candles15min, setCandles15min] = useState<CandleData[]>([]);
  const [waveTestMode, setWaveTestMode] = useState<boolean>(true);

  // ─── Balance-derived session P&L ─────────────────────────────────────
  // Activated once the Wave engine executes a trade. Thereafter we poll the
  // account balance on a 2-minute cadence and expose balance − startingBalance
  // as the authoritative session P&L (replaces the engine's hypothetical P&L
  // for both the sidebar display AND the daily-lock decision).
  const [sessionStartingBalance, setSessionStartingBalance] = useState<number | null>(null);
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);
  const realtimeDailyPnL = useMemo(() => {
    if (sessionStartingBalance === null || currentBalance === null) return null;
    return currentBalance - sessionStartingBalance;
  }, [sessionStartingBalance, currentBalance]);

  // Poll account balance every 2 minutes once a session has been activated.
  useEffect(() => {
    if (sessionStartingBalance === null) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const selectedAccountId = localStorage.getItem('selectedAccountId');
        const url = selectedAccountId ? `/api/account?account_id=${selectedAccountId}` : '/api/account';
        const r = await fetch(url);
        if (!r.ok) return;
        const data = await r.json();
        const acct = (data.accounts || []).find((a: any) => String(a.id) === selectedAccountId)
          || (data.accounts || [])[0];
        const bal = typeof acct?.balance === 'number' ? acct.balance : null;
        if (!cancelled && bal !== null) setCurrentBalance(bal);
      } catch { /* swallow — next tick will retry */ }
    };
    pull();
    const id = window.setInterval(pull, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionStartingBalance]);

  // Indicator values for Wave engine
  const [currentVwap, setCurrentVwap] = useState<number | null>(null);

  // Wave engine signals for chart overlays
  const [waveSignals, setWaveSignals] = useState<any[]>([]);

  // Automation context/stats ref (populated by AutomationEngine via window object)
  const [automationContext, setAutomationContext] = useState<any>(null);

  // Sync automation config with chart settings for perfect harmony
  // NOTE: Individual edge enabled state is passed via enabledEdges to each engine component
  useEffect(() => {
    setAutomationConfig(prev => ({
      ...prev,
      enabled: automationEnabled,
      timeframe: selectedTimeframe,
      volumeMultiplier: volumeMultiplier
    }));
  }, [automationEnabled, selectedTimeframe, volumeMultiplier]);

  // Poll automation context from window object (set by AutomationEngine)
  // 🚨 CRITICAL PERFORMANCE FIX: Reduced from 500ms to 5000ms to prevent screen blanking
  useEffect(() => {
    if (!automationEnabled) {
      setAutomationContext(null);
      return;
    }

    const interval = setInterval(() => {
      const engine = (window as any).__automationEngine;
      if (engine && engine.getContext) {
        setAutomationContext(engine.getContext());
      }
    }, 5000); // Poll every 5 seconds (was 500ms - CAUSING SCREEN BLANKING)

    return () => clearInterval(interval);
  }, [automationEnabled]);

  // Active position state (for P&L display and filled orders)
  const [activePosition, setActivePosition] = useState<{
    entryPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    side: 'buy' | 'sell';
    quantity: number;
    contractId: string;
  } | null>(null);

  // 🆕 Expose zone state globally for Telegram commands
  useEffect(() => {
    (window as any).__horizonState = {
      zones: {
        s1: s1Zone,
        lower: lowerZone,
        upper: upperZone,
        r1: r1Zone,
        r2: upperZoneR2,
        s2: lowerZoneS2,
      },
      openPrice,
      zoneSizes,
      currentPrice,
    };
  }, [s1Zone, lowerZone, upperZone, r1Zone, upperZoneR2, lowerZoneS2, openPrice, zoneSizes, currentPrice]);

  // Subscribe to price updates for PlaceOrders, P&L, and daily OHLC
  useEffect(() => {
    let openPriceSet = false;

    const unsubscribe = subscribe((tick: any) => {
      const price = tick.lastPrice ?? tick.price ?? tick.bid;
      if (price) {
        setCurrentPrice(price);

        // 🚨 FIX: If no open price yet, use first tick as open
        if (!openPriceSet) {
          setOpenPrice(price);
          setDailyOpen(price);
          openPriceSet = true;
          console.log(`📊 Open Price set to first tick: $${price.toFixed(2)} (no API open available)`);
        }
      }

      // Capture daily OHLC from live stream if available
      if (tick.open !== undefined && tick.open !== null) {
        setDailyOpen(tick.open);
        setOpenPrice(tick.open); // Override with real open if API provides it
        openPriceSet = true;
        console.log(`📊 Daily OPEN updated from API: $${tick.open.toFixed(2)} | Browser tab openPrice set`);
      }
      if (tick.high !== undefined && tick.high !== null) {
        setDailyHigh(tick.high);
        console.log(`📊 Daily HIGH updated: $${tick.high.toFixed(2)}`);
      }
      if (tick.low !== undefined && tick.low !== null) {
        setDailyLow(tick.low);
        console.log(`📊 Daily LOW updated: $${tick.low.toFixed(2)}`);
      }
    });

    return () => unsubscribe();
  }, []);

  // Use refs to prevent interval restart on state changes
  const orderLinesRef = useRef(orderLines);
  const activePositionRef = useRef(activePosition);
  const currentPriceRef = useRef(currentPrice);

  useEffect(() => {
    orderLinesRef.current = orderLines;
    activePositionRef.current = activePosition;
    currentPriceRef.current = currentPrice;
  }, [orderLines, activePosition, currentPrice]);

  // Monitor positions from TopstepX every 10 seconds (DISABLED but kept for logic)
  useEffect(() => {
    const fetchPositions = async () => {
      try {
        const selectedAccountId = localStorage.getItem('selectedAccountId');
        const url = selectedAccountId
          ? `/api/positions?account_id=${selectedAccountId}`
          : '/api/positions';

        const response = await fetch(url);
        if (!response.ok) return;

        const positions = await response.json();

        // API is currently returning empty [] when disabled
        if (!Array.isArray(positions) || positions.length === 0) {
          if (activePosition) setActivePosition(null);
          return;
        }

        // Get first open position (logic remains if API ever returns data)
        const pos = positions[0];
        const side = pos.side === 0 ? 'buy' : 'sell';

        const newPosition = {
          entryPrice: pos.averageEntryPrice || pos.entryPrice || currentPrice || 0,
          stopLoss: null,
          takeProfit: null,
          side,
          quantity: pos.size || pos.quantity || 1,
          contractId: pos.contractId || 'CON.F.US.MNQ.H25',
        };

        const posChanged = !activePosition ||
          activePosition.entryPrice !== newPosition.entryPrice ||
          activePosition.quantity !== newPosition.quantity ||
          activePosition.side !== newPosition.side;

        if (posChanged) {
          setActivePosition(newPosition);
        }
      } catch (error) {
        // Silently fail when API is disabled
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, []); 

  const handleOrderPlaced = (order: OrderData) => {
    console.log('Order placed:', order);
    // Order lines are already set via onOrderLinesChange callback
    // Position will be detected via polling when order fills
  };

  const handleClosePosition = () => {
    // Clear active position and order lines
    setActivePosition(null);
    setOrderLines(null);
  };

  // Track automation-placed orders to prevent duplicates
  const placedAutomationOrdersRef = useRef<Set<string>>(new Set());

  // Track automation order details (for displaying SL/TP in UI)
  const [automationOrders, setAutomationOrders] = useState<Map<string, OrderData>>(new Map());

  // 🆕 Calculate session medians from daily high/low (for Drop Off edge)
  useEffect(() => {
    if (dailyHigh && dailyLow && openPrice) {
      // Upper median = midpoint between open and high
      const upperMedian = (openPrice + dailyHigh) / 2;

      // Lower median = midpoint between open and low
      const lowerMedian = (openPrice + dailyLow) / 2;

      setSessionMedianUpper(Math.round(upperMedian * 100) / 100);
      setSessionMedianLower(Math.round(lowerMedian * 100) / 100);

      console.log(`📊 Session medians: Upper ${upperMedian.toFixed(2)}, Lower ${lowerMedian.toFixed(2)}`);
    }
  }, [dailyHigh, dailyLow, openPrice]);

  // 🚨 CIRCUIT BREAKER: Reset P&L and trade count at session boundary (midnight EST)
  useEffect(() => {
    const checkSessionReset = () => {
      const estDate = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];

      if (lastSessionDateRef.current === null) {
        // First load - initialize
        lastSessionDateRef.current = estDate;
        console.log(`📅 Session initialized: ${estDate}`);
      } else if (lastSessionDateRef.current !== estDate) {
        // New trading day - reset
        console.log(`🆕 NEW TRADING DAY: ${estDate} - Resetting circuit breakers & winners`);
        setDailyRealizedPnL(0);
        setDailyTradeCount(0);

        lastSessionDateRef.current = estDate;
      }
    };

    // Check immediately on load
    checkSessionReset();

    // Check every minute for midnight boundary
    const interval = setInterval(checkSessionReset, 60000);
    return () => clearInterval(interval);
  }, []);

  // Automation order placement handler
  const handleAutomationOrderPlacement = async (order: {
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    orderType?: 'market' | 'limit' | 'stop'; // Added 'stop' for manual stop orders
    limitPrice?: number; // Optional for market orders
    stopPrice?: number; // For stop orders (manual right-click)
    stopLoss?: number; // Optional: Outside Range uses 2-order pipeline (Entry + Stop only)
    takeProfit?: number; // Optional: Outside Range places TP AFTER entry fills
    engine?: 'Wave' | 'Manual';
    localOrderId?: string; // 🚨 BUG #26 FIX: Local order ID from engine
  }) => {
    // ═════════════════════════════════════════════════════════════════════
    // 🎯 DYNAMIC EMA6 LOOKBACK STOP/TARGET (Manual market orders only)
    //
    // For right-click Buy/Sell Market orders: compute stop/target from the 1m
    // chart's most recent opposite candle that sits on the correct side of EMA6.
    //   LONG : find most recent bearish candle with close > EMA6 (opposite candle
    //          ABOVE EMA — shallow pullback in uptrend) within 5 bars
    //          stop   = min wick from that candle → now, minus 1 tick
    //          target = entry + (entry - stop)  (1:1 RR)
    //   SHORT: find most recent bullish candle with close < EMA6 (opposite candle
    //          BELOW EMA — shallow bounce in downtrend) within 5 bars
    //          stop   = max wick from that candle → now, plus 1 tick
    //          target = entry - (stop - entry)  (1:1 RR)
    //   No anchor within 5 bars → ABORT (no fallback — prevents the old bug where
     //   a 10-tick fallback stop blew sizing up to 40 contracts at $400 target).
    //   Sizing : round(targetRisk / (stop_ticks × tick_value)), min 1.
    // ═════════════════════════════════════════════════════════════════════
    if (
      order.engine === 'Manual' &&
      (order.orderType === 'market' || order.orderType === 'stop' || order.orderType === 'limit' || !order.orderType) &&
      !order.stopLoss
    ) {
      const tickSize = automationConfig.tickSize || 1.0;
      const tickValue = automationConfig.tickValue || 0.50;
      const targetRisk = automationConfig.targetRiskMin || 500;
      const isStopOrder = order.orderType === 'stop';
      const isLimitOrder = order.orderType === 'limit';
      const entryTypeLabel = isStopOrder ? 'STOP' : isLimitOrder ? 'LIMIT' : 'MARKET';
      // For market: entry = live price. For stop: entry = trigger price. For limit: entry = limit price.
      // All snapped to the active ticker's tick grid (MYM 1.0 / MES 0.25).
      const rawEntry = isStopOrder ? (order.stopPrice ?? 0) : isLimitOrder ? (order.limitPrice ?? 0) : (currentPrice ?? 0);
      const entry = parseFloat((Math.round(rawEntry / activeConfig.tickSize) * activeConfig.tickSize).toFixed(4));

      if (entry <= 0) {
        console.error(`⚠️ ${entryTypeLabel} order: no valid entry price — aborting`);
        return;
      }

      const isLong = order.side === 'buy';
      let stopPrice: number;
      let anchorInfo = '';

      // Use the CURRENTLY SELECTED timeframe's candles for the EMA7 anchor so
      // manual right-click orders work on any TF (1m/2m/5m/10m/etc.), not just 1m.
      // Fall back to the 1m stream if the active TF hasn't populated yet.
      const tfCandles = (candles && candles.length >= 2) ? candles : candles1min;
      if (tfCandles.length < 2) {
        console.error(`⚠️ ${entryTypeLabel} order: not enough candles on selected TF (${selectedTimeframe}) for EMA7 anchor — aborting`);
        return;
      }

      const ema7: number[] = [];
      const k = 2 / (7 + 1);
      for (let i = 0; i < tfCandles.length; i++) {
        if (i === 0) ema7.push(tfCandles[i].close);
        else ema7.push(tfCandles[i].close * k + ema7[i - 1] * (1 - k));
      }

      const n = tfCandles.length;
      let anchorIdx = -1;
      const maxLookback = Math.min(5, n - 1);

      if (isLimitOrder) {
        // LIMIT orders: anchor = most recent candle whose low (long) or high (short)
        // is on the correct side of EMA7 — color doesn't matter, just position vs EMA.
        for (let back = 1; back <= maxLookback; back++) {
          const i = n - 1 - back;
          if (i < 0) break;
          const c = tfCandles[i];
          const e = ema7[i];
          if (isLong) {
            if (c.low > e) { anchorIdx = i; break; }
          } else {
            if (c.high < e) { anchorIdx = i; break; }
          }
        }
      } else {
        // MARKET / STOP orders: anchor = most recent opposite-color candle on correct side of EMA7.
        for (let back = 1; back <= maxLookback; back++) {
          const i = n - 1 - back;
          if (i < 0) break;
          const c = tfCandles[i];
          const e = ema7[i];
          if (isLong) {
            // LONG: bearish candle (red) sitting ABOVE 7 EMA (close > EMA)
            if (c.close < c.open && c.close > e) { anchorIdx = i; break; }
          } else {
            // SHORT: bullish candle (green) sitting BELOW 7 EMA (close < EMA)
            if (c.close > c.open && c.close < e) { anchorIdx = i; break; }
          }
        }
      }

      if (anchorIdx < 0) {
        console.error(`⚠️ ${entryTypeLabel} order on ${selectedTimeframe}: no valid EMA7 anchor in last ${maxLookback} bars — aborting`);
        return;
      }

      let extreme: number;
      if (isLimitOrder) {
        // Limit orders: use the anchor candle's wick directly (no extension across subsequent bars).
        extreme = isLong ? tfCandles[anchorIdx].low : tfCandles[anchorIdx].high;
      } else {
        // Market/stop orders: extend the wick min/max from anchor candle to present.
        extreme = isLong ? tfCandles[anchorIdx].low : tfCandles[anchorIdx].high;
        for (let i = anchorIdx + 1; i < n; i++) {
          const c = tfCandles[i];
          if (isLong) extreme = Math.min(extreme, c.low);
          else extreme = Math.max(extreme, c.high);
        }
      }
      stopPrice = isLong ? extreme - tickSize : extreme + tickSize;
      anchorInfo = `${selectedTimeframe}/${n - 1 - anchorIdx}b`;

      // Snap to the active ticker's tick grid (MYM 1.0 / MES 0.25).
      stopPrice = parseFloat((Math.round(stopPrice / tickSize) * tickSize).toFixed(4));

      // For limit orders the stop MUST be on the correct side of the entry price.
      // If the anchor candle is above the limit entry (common when limit is far below market),
      // the computed stop will be above entry for a long — invalid. Abort cleanly.
      if (isLimitOrder) {
        if (isLong && stopPrice >= entry) {
          console.error(`⚠️ LIMIT order: computed stop ${stopPrice} is at or above entry ${entry} — anchor too far above limit price. Move limit closer to EMA7 or abort.`);
          return;
        }
        if (!isLong && stopPrice <= entry) {
          console.error(`⚠️ LIMIT order: computed stop ${stopPrice} is at or below entry ${entry} — anchor too far below limit price. Move limit closer to EMA7 or abort.`);
          return;
        }
      }

      const stopDistance = Math.abs(entry - stopPrice);
      const stopTicks = stopDistance / tickSize;
      const riskPerContract = stopTicks * tickValue;
      const qty = Math.max(1, Math.round(targetRisk / riskPerContract));
      const totalRisk = qty * riskPerContract;

      if (isLimitOrder) {
        console.log(
          `🎯 ${order.side.toUpperCase()} LIMIT @ ${entry} | Stop ${stopPrice} (${stopTicks}t) | ${qty}x | Risk $${totalRisk.toFixed(2)} | Anchor ${anchorInfo} | TP: manual`
        );
        order = {
          ...order,
          quantity: qty,
          stopLoss: stopPrice,
        };
      } else {
        const rawTarget = isLong ? entry + stopDistance : entry - stopDistance;
        const target = parseFloat((Math.round(rawTarget / tickSize) * tickSize).toFixed(4));
        console.log(
          `🎯 ${order.side.toUpperCase()} ${entryTypeLabel} @ ${entry} | Stop ${stopPrice} (${stopTicks}t) | TP ${target.toFixed(2)} | ${qty}x | Risk $${totalRisk.toFixed(2)} | Anchor ${anchorInfo}`
        );
        order = {
          ...order,
          quantity: qty,
          stopLoss: stopPrice,
          takeProfit: target,
        };
      }
    }

    // 🚨 CIRCUIT BREAKER: Check daily loss limit BEFORE placing order
    // 🟢 BYPASS FOR MANUAL ORDERS: Allow manual trading even if automation limits hit
    // 🚨 REMOVED: Console logging blocked UI for 50-100ms during order placement
    // console.log(`📊 Circuit Breaker Check: P&L = $${dailyRealizedPnL.toFixed(2)} ...`);

    if (order.engine !== 'Manual' && dailyRealizedPnL <= -automationConfig.maxDailyLoss) {
      const message = `🚨 CIRCUIT BREAKER: Max daily loss reached ($${dailyRealizedPnL.toFixed(2)} / -$${automationConfig.maxDailyLoss}). Automation disabled.`;
      console.error(message);
      alert(message);
      setAutomationConfig(prev => ({ ...prev, enabled: false }));
      setAutomationEnabled(false);
      return;
    }

    // 🚨 CIRCUIT BREAKER: Check daily trade limit BEFORE placing order
    // 🟢 BYPASS FOR MANUAL ORDERS: Allow manual trading even if automation limits hit
    if (order.engine !== 'Manual' && dailyTradeCount >= automationConfig.maxDailyTrades) {
      const message = `🚨 CIRCUIT BREAKER: Max daily trades reached (${dailyTradeCount} / ${automationConfig.maxDailyTrades}). Automation disabled.`;
      console.error(message);
      alert(message);
      setAutomationConfig(prev => ({ ...prev, enabled: false }));
      setAutomationEnabled(false);
      return;
    }

    // Determine order type (default to limit for backward compatibility)
    const actualOrderType = order.orderType || 'limit';

    // (Stop-order TP injection removed — stop orders now flow through the unified
    //  EMA6 block above, so they get a real SL + TP just like market orders.)

    // 🚨 BUG #3 FIX: Generate unique order tag to prevent duplicates
    // Use SECONDS instead of milliseconds to prevent duplicate orders on rapid calls
    const priceTag = order.limitPrice ? order.limitPrice.toFixed(2) : 'MARKET';
    const orderTag = `AUTO-${Math.floor(Date.now() / 1000)}-${order.side}-${priceTag}`;

    // Check if we've already placed this order
    if (placedAutomationOrdersRef.current.has(orderTag)) {
      console.warn('⚠️ Order already placed, skipping duplicate:', orderTag);
      return;
    }

    // 🚨 REMOVED: Console logging blocked UI for 100-200ms during order placement
    // console.log(`🤖 ${order.engine || 'Unknown'} engine placing order:`, order);

    // Mark as placed immediately to prevent race conditions
    placedAutomationOrdersRef.current.add(orderTag);

    // Set order lines for visualization (use limitPrice if available, otherwise null for market)
    setOrderLines({
      limitPrice: order.limitPrice || null,
      stopLoss: order.stopLoss || null,
      takeProfit: order.takeProfit || null,
      orderType: order.side,
      entryPrice: null,
      isFilled: false
    });

    // Place order via API with customTag
    try {
      // Get selected account ID from localStorage (set by AccountContext)
      const selectedAccountId = localStorage.getItem('selectedAccountId');
      const url = selectedAccountId
        ? `/api/orders/place?account_id=${selectedAccountId}`
        : '/api/orders/place';

      // 🚨 REMOVED: Console logging blocked UI
      // console.log(`🤖 Placing ${actualOrderType.toUpperCase()} order on account: ${selectedAccountId}`);

      // 🟢 DYNAMIC SIZING LOGIC (Linked to Sidebar)
      let finalQuantity = order.quantity;

      console.log(`🔍 Order received: engine=${order.engine}, qty=${order.quantity}, stopLoss=${order.stopLoss}`);

      // If Manual OR Wave Order with "0" quantity, calculate size based on Risk
      if ((order.engine === 'Manual' || order.engine === 'Wave') && (!order.quantity || order.quantity === 0)) {

        // 1. GET RISK FROM SIDEBAR CONFIG
        const targetRiskDollars = automationConfig.targetRiskMin || 300;

        // 2. Determine Entry Price (Limit/Stop price, or Current Price for Market)
        const entryPrice = order.limitPrice || order.stopPrice || currentPrice || 0;

        console.log(`📊 Sizing inputs: targetRisk=$${targetRiskDollars}, entry=${entryPrice}, stop=${order.stopLoss}`);

        // 3. Calculate Distance
        if (entryPrice > 0 && order.stopLoss && order.stopLoss > 0) {
          const distPoints = Math.abs(entryPrice - order.stopLoss);

          // Risk sizing uses active ticker's tick economics (MYM: $0.50/pt, MES: $5/pt).
          // tickSize / tickValue flow from TickerContext via automationConfig sync above.
          const tickSize = automationConfig.tickSize || activeConfig.tickSize;
          const tickValue = automationConfig.tickValue || activeConfig.tickValue;
          const dollarsPerPoint = tickValue / tickSize;
          const riskPerContract = distPoints * dollarsPerPoint;

          // Calculate contracts: round to get closest to target risk
          let calcQty = Math.round(targetRiskDollars / riskPerContract);

          // Min 1 contract
          finalQuantity = Math.max(1, calcQty);

          // Calculate actual risk
          const actualRisk = finalQuantity * riskPerContract;

          console.log(`⚖️ SIZING: ${distPoints.toFixed(2)}pts × $${dollarsPerPoint.toFixed(2)}/pt = $${riskPerContract.toFixed(2)}/contract`);
          console.log(`⚖️ SIZING: $${targetRiskDollars} target ÷ $${riskPerContract.toFixed(2)} = ${calcQty} contracts`);
          console.log(`⚖️ SIZING: Final ${finalQuantity} contracts × $${riskPerContract.toFixed(2)} = $${actualRisk.toFixed(2)} actual risk`);
        } else {
          finalQuantity = 1;
          console.log(`⚠️ Sizing fallback: entry=${entryPrice}, stopLoss=${order.stopLoss} - using qty=1`);
        }
      } else {
        console.log(`ℹ️ Not manual sizing: engine=${order.engine}, qty=${order.quantity}`);
      }

      // 🎯 UNIVERSAL PRICE SNAP — kills every 0.0000000001 drift before it leaves the app.
      //   Rounds every outgoing price to the active ticker's tick grid (MYM 1.0 / MES 0.25)
      //   and strips IEEE-754 float noise via toFixed(4) → parseFloat. Applied to
      //   entry / stop / SL / TP on BOTH the primary payload and the bracket leg requests below.
      const snapTick = activeConfig.tickSize;
      const snapPrice = (p: number | null | undefined): number | undefined =>
        snapToTickOrUndefined(p, snapTick);

      // Snap every price on the order object so ALL downstream consumers
      // (payload, bracket legs, setOrderLines, automationOrders map) see clean values.
      order = {
        ...order,
        limitPrice: snapPrice(order.limitPrice),
        stopPrice: snapPrice(order.stopPrice),
        stopLoss: snapPrice(order.stopLoss),
        takeProfit: snapPrice(order.takeProfit),
      };

      // Build request payload based on order type
      const payload: any = {
        contractId: order.symbol,
        side: order.side,
        orderType: actualOrderType,
        quantity: finalQuantity, // 👈 Uses the calculated size
        customTag: orderTag
      };

      // Include price for limit orders
      if (order.limitPrice !== undefined) {
        payload.price = order.limitPrice;
      }

      // 🟢 MANUAL STOP ORDERS: Add stopPrice for stop orders from right-click
      if (order.stopPrice !== undefined) {
        payload.stopPrice = order.stopPrice;

        // 🚨 FIX: Force Stop Market by ensuring 'price' is NOT set for standard stop orders
        // TopstepX/Backend treats 'stop' with 'price' as Stop Limit.
        // We want Stop Market (Trigger -> Market Order).
        if (actualOrderType === 'stop') {
          delete payload.price; // Explicitly remove price to avoid Stop Limit rejection
        }

        // 🚨 CRITICAL FIX: Validate stop order direction BEFORE sending to broker
        // Buy Stop must be ABOVE current market price, Sell Stop must be BELOW
        const marketPrice = currentPrice || 0;
        if (marketPrice > 0) {
          if (order.side === 'buy' && order.stopPrice <= marketPrice) {
            const message = `❌ Invalid Buy Stop Order\n\nStop Price: ${order.stopPrice.toFixed(2)}\nCurrent Market: ${marketPrice.toFixed(2)}\n\nBuy Stop must be ABOVE market price.\n(Use Sell Limit for orders below market)`;
            console.error(message);
            alert(message);
            placedAutomationOrdersRef.current.delete(orderTag);
            return;
          }

          if (order.side === 'sell' && order.stopPrice >= marketPrice) {
            const message = `❌ Invalid Sell Stop Order\n\nStop Price: ${order.stopPrice.toFixed(2)}\nCurrent Market: ${marketPrice.toFixed(2)}\n\nSell Stop must be BELOW market price.\n(Use Buy Limit for orders above market)`;
            console.error(message);
            alert(message);
            placedAutomationOrdersRef.current.delete(orderTag);
            return;
          }

          console.log(`✅ Stop order validation passed: ${order.side.toUpperCase()} Stop @ ${order.stopPrice.toFixed(2)} (Market: ${marketPrice.toFixed(2)})`);
        }
      }

      // ⚡ OPTIMISTIC UPDATE: Show entry line immediately for Manual Market AND Stop Orders
      // This ensures the user sees their trade on the chart instantly without waiting for broker confirmation
      if (order.engine === 'Manual' && (actualOrderType === 'market' || actualOrderType === 'stop')) {
        const estimatedEntry = order.limitPrice || order.stopPrice || currentPrice || 0;

        // console.log(`⚡ Optimistic UI: Showing ${order.side} entry at ${estimatedEntry} with ${finalQuantity} contracts`);

        // Update order lines immediately (so chart shows Green/Red entry line)
        setOrderLines({
          limitPrice: estimatedEntry, // Entry price shows as the limit line
          stopLoss: order.stopLoss || null,
          takeProfit: order.takeProfit || null,
          orderType: order.side,
          entryPrice: estimatedEntry,
          isFilled: actualOrderType === 'market' // Only Market orders are "filled" immediately. Stop orders are working.
        });

        // CRITICAL: Market orders need a price reference for bracket orders
        // Use current price if not already set
        if (actualOrderType === 'market' && !payload.price) {
          payload.price = estimatedEntry;
        }
      }

      // 🛡️ VALIDATION: Ensure critical fields are not null/zero
      // SKIP price check for stop orders (use stopPrice) and manual market orders
      if (order.engine !== 'Manual' && actualOrderType !== 'stop' && (!payload.price || payload.price === 0)) {
        // console.error('❌ Order validation failed: price is missing or zero', payload);
        alert('Cannot place order: Current price unavailable. Please wait for live data.');
        placedAutomationOrdersRef.current.delete(orderTag);
        return;
      }

      // stopLoss validation removed — Wave engine places brackets separately after fill


      // console.log(`📤 Sending order to TopstepX:`, JSON.stringify(payload, null, 2));

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Automation order placed successfully:', result);

        // First Wave execution of the session → snapshot the account balance.
        // Every subsequent P&L readout is `currentBalance − startingBalance`.
        if (order.engine === 'Wave' && sessionStartingBalance === null) {
          (async () => {
            try {
              const selectedAccountId = localStorage.getItem('selectedAccountId');
              const aurl = selectedAccountId ? `/api/account?account_id=${selectedAccountId}` : '/api/account';
              const aresp = await fetch(aurl);
              if (aresp.ok) {
                const adata = await aresp.json();
                const acct = (adata.accounts || []).find((a: any) => String(a.id) === selectedAccountId)
                  || (adata.accounts || [])[0];
                const bal = typeof acct?.balance === 'number' ? acct.balance : null;
                if (bal !== null) {
                  setSessionStartingBalance(bal);
                  setCurrentBalance(bal);
                  console.log(`💰 Session starting balance captured: $${bal.toFixed(2)}`);
                }
              }
            } catch (e) {
              console.warn('Could not capture starting balance:', e);
            }
          })();
        }

        // Store order details for UI display
        const orderId = result.orderId?.toString() || orderTag;

        // 🎯 MANUAL BRACKETS — LOCKED-IN BEHAVIOUR:
        //   • MARKET entry  → place BOTH SL (stop) + TP (limit)
        //   • STOP  entry  → place ONLY TP (limit) — user drags SL manually
        //   • LIMIT entry  → no brackets (handled elsewhere)
        // TopstepX has no OCO so each bracket is an independent order.
        let manualStopOrderId: string | null = null;
        let manualTpOrderId: string | null = null;
        const isManual = order.engine === 'Manual';
        const isWave = order.engine === 'Wave';
        const isMarketEntry = actualOrderType === 'market';
        const isStopEntry = actualOrderType === 'stop';
        const isLimitEntry = actualOrderType === 'limit';
        // 🎯 UNIFIED BRACKET RULES:
        //   • MARKET entry → SL + TP
        //   • STOP   entry → SL + TP
        //   • LIMIT  entry → SL only (user manages TP manually)
        // Wave now flows through the same bracket pipeline as Manual.
        const shouldPlaceTP = (isManual || isWave) && (isMarketEntry || isStopEntry) && !!order.takeProfit;
        const shouldPlaceSL = (isManual || isWave) && (isMarketEntry || isStopEntry || isLimitEntry) && !!order.stopLoss;

        if (shouldPlaceTP || shouldPlaceSL) {
          const exitSide = order.side === 'buy' ? 'sell' : 'buy';
          const headers = { 'Content-Type': 'application/json' };

          // TP leg — only for STOP entries
          let tpPromise: Promise<Response | null> = Promise.resolve(null);
          if (shouldPlaceTP) {
            tpPromise = fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                contractId: order.symbol,
                side: exitSide,
                orderType: 'limit',
                price: order.takeProfit,
                quantity: finalQuantity,
                customTag: `${orderTag}-TP`,
              }),
            }).catch(e => { console.error('❌ Manual TP error:', e); return null; });
          }

          // SL leg — only for MARKET entries
          let slPromise: Promise<Response | null> = Promise.resolve(null);
          if (shouldPlaceSL) {
            slPromise = fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                contractId: order.symbol,
                side: exitSide,
                orderType: 'stop',
                stopPrice: order.stopLoss,
                quantity: finalQuantity,
                customTag: `${orderTag}-SL`,
              }),
            }).catch(e => { console.error('❌ Manual SL error:', e); return null; });
          }

          const [tpResp, slResp] = await Promise.all([tpPromise, slPromise]);

          // TP response — only alert when we actually tried to place it
          if (shouldPlaceTP) {
            if (tpResp && tpResp.ok) {
              const tpData = await tpResp.json();
              manualTpOrderId = tpData.orderId?.toString() || null;
              console.log(`🎯 ${isStopEntry ? 'STOP' : 'MARKET'}-entry TP placed @ ${order.takeProfit}: ID ${manualTpOrderId}`);
            } else if (tpResp) {
              const errText = await tpResp.text();
              console.error(`❌ Manual TP bracket FAILED @ ${order.takeProfit}: ${errText}`);
              alert(`⚠️ TP LIMIT FAILED TO PLACE @ ${order.takeProfit}\n${errText}`);
            } else {
              console.error(`❌ Manual TP bracket: no response`);
              alert(`⚠️ TP LIMIT FAILED TO PLACE @ ${order.takeProfit}`);
            }
          }

          // SL response — best-effort
          if (shouldPlaceSL) {
            if (slResp && slResp.ok) {
              const slData = await slResp.json();
              manualStopOrderId = slData.orderId?.toString() || null;
              console.log(`🛡️ ${isStopEntry ? 'STOP' : 'MARKET'}-entry SL placed @ ${order.stopLoss}: ID ${manualStopOrderId}`);
            } else if (slResp) {
              console.error(`❌ Manual SL bracket failed: ${await slResp.text()}`);
            }
          }
        }

        setAutomationOrders(prev => new Map(prev).set(orderId, {
          entry: order.limitPrice || order.stopPrice || null,
          stopLoss: order.stopLoss || null,
          takeProfit: order.takeProfit || null,
          stopOrderId: manualStopOrderId,
          tpOrderId: manualTpOrderId,
          side: order.side,
          quantity: order.quantity
        }));

        // Notify Wave engine with real order ID (entry stop order)
        if (order.localOrderId && result.orderId) {
          const realOrderId = result.orderId.toString();
          console.log(`🔄 Updating ${order.engine} engine: ${order.localOrderId} → ${realOrderId}`);

          if (order.engine === 'Wave') {
            (window as any).__waveEngine?.updateOrderId(
              order.localOrderId,
              realOrderId
            );
          }
        }

        console.log(`✅ ${order.engine || 'Unknown'} engine order placed successfully`);
      } else {
        // Remove from set if placement failed so it can be retried
        placedAutomationOrdersRef.current.delete(orderTag);
        const errorText = await response.text();
        console.error('❌ Order placement failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          payload: payload
        });
        alert(`Order failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      placedAutomationOrdersRef.current.delete(orderTag);
      console.error('❌ Order placement error:', error);
      alert(`Order error: ${error}`);
    }
  };

  // 🚨 CIRCUIT BREAKER: Track position closes and update P&L
  const handlePositionClose = (orderId: string, entryPrice: number, exitPrice: number, quantity: number, side: 'buy' | 'sell') => {
    // Calculate realized P&L
    const pnl = side === 'buy'
      ? (exitPrice - entryPrice) * quantity * automationConfig.tickValue  // LONG: profit when exit > entry
      : (entryPrice - exitPrice) * quantity * automationConfig.tickValue; // SHORT: profit when entry > exit

    // Update daily P&L and trade count
    setDailyRealizedPnL(prev => {
      const newPnL = prev + pnl;
      console.log(`💰 Position closed: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Daily P&L: $${newPnL.toFixed(2)} | Trades: ${dailyTradeCount + 1}/${automationConfig.maxDailyTrades}`);
      return newPnL;
    });

    setDailyTradeCount(prev => prev + 1);

    // Check circuit breakers after trade closes
    const newPnL = dailyRealizedPnL + pnl;
    const newTradeCount = dailyTradeCount + 1;

    if (newPnL <= -automationConfig.maxDailyLoss) {
      const message = `🚨 CIRCUIT BREAKER TRIGGERED: Max daily loss reached ($${newPnL.toFixed(2)}). Automation disabled.`;
      console.error(message);
      alert(message);
      setAutomationConfig(prev => ({ ...prev, enabled: false }));
      setAutomationEnabled(false);
    }

    if (newTradeCount >= automationConfig.maxDailyTrades) {
      const message = `🚨 CIRCUIT BREAKER TRIGGERED: Max daily trades reached (${newTradeCount}). Automation disabled.`;
      console.error(message);
      alert(message);
      setAutomationConfig(prev => ({ ...prev, enabled: false }));
      setAutomationEnabled(false);
    }
  };

  // Automation stop loss update handler
  const handleAutomationStopUpdate = async (orderId: string, newStopLoss: number) => {
    // 🚨 REMOVED: Console logging blocked UI
    // console.log(`🤖 Automation updating stop loss: ${orderId} → ${newStopLoss}`);

    // Update order lines visualization
    if (orderLines) {
      setOrderLines({
        ...orderLines,
        stopLoss: newStopLoss
      });
    }

    // Call backend API to update stop loss (cancel and replace)
    try {
      const response = await fetch(`/api/orders/${orderId}/stop-loss?new_stop_loss=${newStopLoss}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Automation stop loss updated:', result);
      } else {
        console.error('❌ Automation stop loss update failed:', await response.text());
      }
    } catch (error) {
      console.error('❌ Automation stop loss update error:', error);
    }
  };

  // Automation state change handler
  const handleAutomationStateChange = (state: AutomationState) => {
    // 🚨 REMOVED: Console logging blocked UI
    // console.log(`🤖 Automation state: ${state}`);
  };

  // Cancel individual order (for breakeven management)
  const handleAutomationOrderCancel = async (orderId: string) => {
    try {
      const selectedAccountId = localStorage.getItem('selectedAccountId');
      const cancelUrl = selectedAccountId
        ? `/api/orders/${orderId}?account_id=${selectedAccountId}`
        : `/api/orders/${orderId}`;

      const response = await fetch(cancelUrl, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        console.log(`✅ Automation cancelled order: ${orderId}`);
      } else {
        console.error('❌ Automation order cancel failed:', await response.text());
      }
    } catch (error) {
      console.error('❌ Automation order cancel error:', error);
    }
  };

  // Cancel all pending orders using the bulk API endpoint (more reliable/efficient)
  const handleCancelAllOrders = async () => {
    try {
      console.log('🚫 Canceling ALL orders via backend API...');

      const selectedAccountId = localStorage.getItem('selectedAccountId');
      const url = selectedAccountId
        ? `/api/orders/cancel-all?account_id=${selectedAccountId}`
        : '/api/orders/cancel-all';

      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Bulk cancel successful:', result);
        const cancelledCount = result.cancelledCount || result.count || 0;
        alert(`✅ Successfully requested cancel for active orders`);

        // Force refresh orders logic if needed, but for now we just clear visuals
      } else {
        const errorText = await response.text();
        console.error('❌ Bulk cancel failed:', response.status, errorText);
        alert(`⚠️ Cancel All failed: ${response.status} ${errorText}`);
      }

      // Clear order lines immediately for UI responsiveness
      setOrderLines(null);

      // Clear active position in Wave engine
      if ((window as any).cancelWaveOrders) {
        (window as any).cancelWaveOrders();
      }

      console.log('🔄 ALL ENGINES: Manual cancel visual reset complete');

    } catch (error) {
      console.error('❌ Cancel all operation error:', error);
      alert('Failed to execute Cancel All. Check console.');
    }
  };



  // Memoized callbacks to prevent infinite loops
  const handleCandlesUpdate = useCallback((updatedCandles: CandleData[], timeframe: string) => {
    // 🐛 DEBUG: Log incoming candle data to detect corruption
    const lastCandle = updatedCandles[updatedCandles.length - 1];
    console.log(`[APP] 📊 Candles update - TF: ${timeframe}, Last candle:`, {
      time: lastCandle?.time,
      O: lastCandle?.open,
      H: lastCandle?.high,
      L: lastCandle?.low,
      C: lastCandle?.close
    });

    setCandles(updatedCandles);
    setSelectedTimeframe(timeframe);

    // Update specific timeframe candle state for Wave engine
    if (timeframe === '5m') {
      setCandles5min(updatedCandles);
    } else if (timeframe === '1m') {
      setCandles1min(updatedCandles);
    }
  }, []);

  // Multi-timeframe candle update for Wave engine
  const handleMultiTimeframeCandlesUpdate = useCallback((candles5min: CandleData[], candles1min: CandleData[], candles15min: CandleData[]) => {
    if (candles5min.length > 0) setCandles5min(candles5min);
    if (candles1min.length > 0) setCandles1min(candles1min);
    if (candles15min.length > 0) setCandles15min(candles15min);

    // Extract VWAP from latest 1min candle (cumulative VWAP computed in ChartPanel bar builder)
    if (candles1min.length > 0) {
      const last1min = candles1min[candles1min.length - 1];
      if (last1min?.vwap) {
        setCurrentVwap(last1min.vwap);
      }
    }

    // Sync wave engine signals to chart overlays
    const w = (window as any).__waveEngine;
    if (w?.signals) {
      setWaveSignals([...w.signals]);
    }
  }, []);

  const handleFvgCountsUpdate = useCallback((bullish: number, bearish: number) => {
    setBullishFvgCount(bullish);
    setBearishFvgCount(bearish);
  }, []);


  return (
    <AccountProvider>
      <div className="min-h-screen max-h-screen h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100 flex flex-col overflow-hidden">
        {/* Wave Engine - EMA Stack (PRIMARY ENGINE) */}
        {automationEnabled && enabledEdges.wave && (
          <ErrorBoundary componentName="Wave Engine">
          <WaveEngine
            enabled={automationEnabled && enabledEdges.wave}
            ticker={selectedTicker}
            candles5min={candles5min}
            candles={candles}
            testMode={waveTestMode}
            externalDailyPnL={realtimeDailyPnL}
            currentPrice={currentPrice}
            vwap={currentVwap}
            sma200={null}
            config={{
              targetRiskMin: automationConfig.targetRiskMin,
              targetRiskMax: automationConfig.targetRiskMax,
              tickSize: automationConfig.tickSize,
              tickValue: automationConfig.tickValue,
              autoPlaceOrders: automationConfig.autoPlaceOrders
            }}
            onOrderPlacement={(order) => {
              handleAutomationOrderPlacement({ ...order, engine: 'Wave' });
            }}
            onOrderCancel={handleAutomationOrderCancel}
            onEngineDisable={() => {
              console.log('🌊 Wave Engine disabling for the day');
              setEnabledEdges(prev => ({ ...prev, wave: false }));
            }}
          />
          </ErrorBoundary>
        )}

        {/* === REVAMPED HEADER === */}
        <header className="relative flex-shrink-0 overflow-hidden" style={{
          zIndex: 10000,
          background: 'linear-gradient(180deg, rgba(10, 12, 15, 0.98) 0%, rgba(18, 21, 26, 0.95) 100%)',
          borderBottom: '1px solid rgba(0, 217, 255, 0.1)'
        }}>
          {/* Subtle grid overlay */}
          <div className="absolute inset-0 opacity-[0.02]" style={{
            backgroundImage: 'linear-gradient(rgba(0, 217, 255, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 217, 255, 0.5) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }} />

          <div className="relative z-10 px-6 py-4 flex items-center justify-between">
            {/* Left: Logo + Brand */}
            <div className="flex items-center gap-4">
              {/* Logo */}
              <div className="relative w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden" style={{
                background: 'linear-gradient(135deg, rgba(0, 217, 255, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%)',
                border: '1px solid rgba(0, 217, 255, 0.3)',
                boxShadow: '0 0 20px rgba(0, 217, 255, 0.2)'
              }}>
                <Activity className="text-[#00D9FF]" size={22} />
                <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/5" />
              </div>

              {/* Brand Text */}
              <div>
                <h1 className="text-xl font-bold tracking-tight" style={{
                  background: 'linear-gradient(135deg, #00D9FF 0%, #A855F7 50%, #00FF88 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  textShadow: '0 0 30px rgba(0, 217, 255, 0.3)'
                }}>
                  HORIZON ALPHA
                </h1>
                <p className="text-[10px] font-mono text-white/30 uppercase tracking-[0.2em]">
                  Trading Terminal v2.0
                </p>
              </div>
            </div>

            {/* Right: Account + Metrics */}
            <div className="flex items-center gap-4">
              <AccountSwitcher />
              <div className="w-px h-8 bg-white/10" />
              <MetricsBar className="border-0 p-0" />
            </div>
          </div>

          {/* Bottom glow line */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#00D9FF]/40 to-transparent" />
        </header>

        {/* Main Content */}
        <main className="flex-1 flex gap-4 p-4 overflow-hidden relative" style={{ background: 'linear-gradient(180deg, #0A0C0F 0%, #12151A 100%)' }}>
          {/* Sidebar Toggle Button */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="fixed left-0 top-1/2 -translate-y-1/2 rounded-r-lg px-1.5 py-6 transition-all duration-300 hover:pl-2"
            style={{
              zIndex: 100,
              marginLeft: showSidebar ? '416px' : '16px',
              background: 'linear-gradient(135deg, rgba(0, 217, 255, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)',
              border: '1px solid rgba(0, 217, 255, 0.2)',
              borderLeft: 'none',
              boxShadow: '0 0 20px rgba(0, 217, 255, 0.1)',
              transition: 'margin-left 300ms ease-in-out, padding 150ms ease'
            }}
            title={showSidebar ? "Hide Sidebar" : "Show Sidebar"}
          >
            {showSidebar ? (
              <ChevronLeft size={16} className="text-[#00D9FF]" />
            ) : (
              <ChevronRight size={16} className="text-[#00D9FF]" />
            )}
          </button>

          {/* Sidebar - Proper width transition */}
          <aside
            className="flex flex-col gap-4 overflow-y-auto flex-shrink-0 transition-all duration-300 ease-in-out"
            style={{
              width: showSidebar ? '400px' : '0px',
              minWidth: showSidebar ? '400px' : '0px',
              opacity: showSidebar ? 1 : 0,
              overflow: showSidebar ? 'visible auto' : 'hidden',
              pointerEvents: showSidebar ? 'auto' : 'none'
            }}
          >

            {/* Automation Control — START/STOP + Wave toggle + Test Mode + live state */}
            <ErrorBoundary componentName="Automation Control">
              <AutomationControlPanel
                automationEnabled={automationEnabled}
                onAutomationToggle={handleAutomationToggle}
                enabledEdges={enabledEdges}
                onEdgesChange={setEnabledEdges}
                onCancelAllOrders={handleCancelAllOrders}
                testMode={waveTestMode}
                onTestModeChange={setWaveTestMode}
                className="flex-shrink-0"
              />
            </ErrorBoundary>

            {/* Dynamic Position Size Calculator */}
            <AutomationConfig
              config={automationConfig}
              onConfigChange={setAutomationConfig}
              className="flex-shrink-0"
            />
          </aside>

          {/* Center - Chart (Expanded to fill more space) */}
          <section className="flex-1 flex flex-col gap-5 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <ChartPanel
                className="h-full"
                // 🟢 MANUAL ORDER EXECUTION: Connect chart right-click to order handler
                onOrderPlacement={(order) => handleAutomationOrderPlacement({ ...order, engine: 'Manual' })}
                onCancelAllOrders={handleCancelAllOrders}
                upperZone={upperZone}
                lowerZone={lowerZone}
                r1Zone={r1Zone}
                s1Zone={s1Zone}
                upperZoneR2={upperZoneR2}
                lowerZoneS2={lowerZoneS2}
                r3Zone={r3Zone}
                s3Zone={s3Zone}
                r4Zone={r4Zone}
                s4Zone={s4Zone}
                openPrice={openPrice}
                zoneSizes={zoneSizes}
                volumeMultiplier={volumeMultiplier}
                volumeEnabled={volumeEnabled}
                fvgEnabled={fvgEnabled}
                orderLines={orderLines}
                onOrderLinesDrag={setOrderLines}
                onFvgCountsUpdate={handleFvgCountsUpdate}
                onLatestFVG={setLatestFVG}
                onRecentFVGs={setRecentFVGs}
                automationEnabled={automationEnabled}
                onCandlesUpdate={handleCandlesUpdate}
                onMultiTimeframeCandlesUpdate={handleMultiTimeframeCandlesUpdate}
                enabledEdges={enabledEdges}
                onEdgesChange={setEnabledEdges}
                onFVGDetection={setLatestFVG}
                waveSignals={waveSignals}
              />
            </div>

          </section>
        </main>
      </div>
    </AccountProvider>
  );
}