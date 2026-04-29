import { useState, useEffect, useRef, useCallback } from 'react';
import { FVG } from '../components/ChartPanel';

/**
 * =============================================================================
 * HORIZON ALPHA AUTOMATION ENGINE - STATE MACHINE HOOK
 * =============================================================================
 *
 * Multi-stage trading automation with precise condition sequencing:
 * 1. Zone break detection
 * 2. Volume confirmation (2 candles)
 * 3. FVG detection
 * 4. Dynamic position sizing
 * 5. Automatic order placement
 * 6. Trailing stop management
 *
 * Built for production-grade trading environments with comprehensive logging.
 * =============================================================================
 */

// ===== TYPE DEFINITIONS =====

export enum AutomationState {
  IDLE = 'idle',
  WAITING_ZONE_BREAK = 'waiting_zone_break',
  PRE_SESSION_BREAK = 'pre_session_break', // Zone broken before session - smart context analysis
  WAITING_RETEST = 'waiting_retest', // Waiting for wick back to zone (high probability only)
  ZONE_BROKEN = 'zone_broken',
  CONFIRMING_VOLUME = 'confirming_volume',
  VOLUME_CONFIRMED = 'volume_confirmed',
  WAITING_FVG = 'waiting_fvg',
  FVG_DETECTED = 'fvg_detected',
  CALCULATING_SIZE = 'calculating_size',
  PLACING_ORDER = 'placing_order',
  ORDER_ACTIVE = 'order_active',
  MANAGING_POSITION = 'managing_position',
  TRADE_COMPLETE = 'trade_complete',
  ERROR = 'error'
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  vwap?: number;   // Cumulative VWAP (reset daily)
}

export interface AutomationContext {
  state: AutomationState;
  direction: 'bullish' | 'bearish' | null;

  // Pre-session break tracking
  preSessionBreakDetected: boolean;
  preSessionBreakDirection: 'bullish' | 'bearish' | null;
  preSessionBreakTime: number | null;
  retestDetected: boolean;
  retestCandle: CandleData | null;
  retestTime: number | null;

  // Stage 1: Zone break
  zoneBreakCandle: CandleData | null;
  zoneBreakPrice: number | null;
  zoneBreakTime: number | null;

  // Stage 2: Volume confirmation
  volumeConfirmationComplete: boolean;

  // Stage 3: FVG
  detectedFVG: FVG | null;
  fvgDetectionTime: number | null;

  // Stage 4: Position sizing
  calculatedEntry: number | null;
  calculatedStopLoss: number | null;
  calculatedTakeProfit: number | null;
  calculatedContracts: number | null;
  stopDistancePoints: number | null;
  riskRewardRatio: number | null;

  // Stage 5: Order placement
  placedOrderId: string | null;
  orderPlacementTime: number | null;

  // Stage 6: Position management
  entryPrice: number | null;
  fillTime: number | null;
  breakEvenMoved: boolean;
  trailingStopActive: boolean;
  currentStopLoss: number | null;

  // Metadata
  error: string | null;
  lastActionTime: number | null;
  sessionStartTime: number | null;
}

export interface AutomationConfig {
  enabled: boolean;
  timeframe: string; // Must be '5m' for safety

  // Volume confirmation
  volumeMultiplier: number; // Default: 1.2x (checks zone break candle OR next candle)
  volumeCandles: number; // Deprecated: now always checks 1 candle (kept for compatibility)

  // Position sizing
  targetRiskMin: number; // Default: $300
  targetRiskMax: number; // Default: $300
  tickSize: number; // Default: 0.25
  tickValue: number; // Default: $1.25 (Micro E-mini S&P - MES)

  // Trailing stop
  breakEvenTrigger: number; // Default: 10 points

  // Safety limits
  maxDailyTrades: number; // Default: 5
  maxDailyLoss: number; // Default: $500

  // Feature flags
  autoPlaceOrders: boolean;
  autoManageStops: boolean;
}

export interface AutomationStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnL: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  todayTrades: number;
  todayPnL: number;
}

interface AutomationLog {
  timestamp: number;
  state: AutomationState;
  action: string;
  data?: any;
  level: 'info' | 'warning' | 'error' | 'success';
}

// ===== MAIN HOOK =====

export function useAutomation(config: AutomationConfig) {
  // Context state
  const [context, setContext] = useState<AutomationContext>({
    state: AutomationState.IDLE,
    direction: null,
    preSessionBreakDetected: false,
    preSessionBreakDirection: null,
    preSessionBreakTime: null,
    retestDetected: false,
    retestCandle: null,
    retestTime: null,
    zoneBreakCandle: null,
    zoneBreakPrice: null,
    zoneBreakTime: null,
    volumeConfirmationComplete: false,
    detectedFVG: null,
    fvgDetectionTime: null,
    calculatedEntry: null,
    calculatedStopLoss: null,
    calculatedTakeProfit: null,
    calculatedContracts: null,
    stopDistancePoints: null,
    riskRewardRatio: null,
    placedOrderId: null,
    orderPlacementTime: null,
    entryPrice: null,
    fillTime: null,
    breakEvenMoved: false,
    trailingStopActive: false,
    currentStopLoss: null,
    error: null,
    lastActionTime: null,
    sessionStartTime: Date.now(),
  });

  // Statistics
  const [stats, setStats] = useState<AutomationStats>({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnL: 0,
    winRate: 0,
    averageWin: 0,
    averageLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    todayTrades: 0,
    todayPnL: 0,
  });

  // Logging
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const maxLogs = 500;

  // Refs for candle tracking
  const lastProcessedCandleTime = useRef<number>(0);
  const candleBuffer = useRef<CandleData[]>([]);

  // Stable refs for context and stats - prevents circular dependencies
  const contextRef = useRef(context);
  const statsRef = useRef(stats);

  // Update refs on every render (but don't trigger re-renders)
  useEffect(() => {
    contextRef.current = context;
    statsRef.current = stats;
  });

  // ===== LOGGING UTILITY =====

  const log = useCallback((action: string, data?: any, level: 'info' | 'warning' | 'error' | 'success' = 'info') => {
    const logEntry: AutomationLog = {
      timestamp: Date.now(),
      state: contextRef.current.state, // Read from ref, not closure
      action,
      data,
      level,
    };

    setLogs(prev => {
      const updated = [...prev, logEntry];
      return updated.slice(-maxLogs); // Keep only last N logs
    });

    // Console logging with formatting
    const emoji = level === 'error' ? '❌' : level === 'success' ? '✅' : level === 'warning' ? '⚠️' : '📋';
    const timestamp = new Date(logEntry.timestamp).toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
    console.log(`${emoji} [${timestamp} EST] [${contextRef.current.state}] ${action}`, data || '');
  }, []); // EMPTY deps - log is now stable!

  // ===== STATE MACHINE TRANSITIONS =====

  const transitionTo = useCallback((newState: AutomationState, reason: string) => {
    log(`State transition: ${contextRef.current.state} → ${newState} (${reason})`, null, 'info');
    setContext(prev => ({
      ...prev,
      state: newState,
      lastActionTime: Date.now(),
    }));
  }, [log]); // log is stable, so this is stable

  const setError = useCallback((errorMessage: string) => {
    log(`Error: ${errorMessage}`, null, 'error');
    setContext(prev => ({
      ...prev,
      state: AutomationState.ERROR,
      error: errorMessage,
      lastActionTime: Date.now(),
    }));
  }, [log]);

  // ===== STAGE 1: ZONE BREAK DETECTION =====

  const detectZoneBreak = useCallback((candle: CandleData, upperZone: number | null, lowerZone: number | null): {
    broken: boolean;
    direction: 'bullish' | 'bearish' | null;
  } => {
    const ZONE_MARGIN = 3; // Must close 3 pts beyond zone to count as break

    // Debug: Show why zone breaks are rejected
    if (upperZone !== null && candle.close > upperZone && candle.close <= upperZone + ZONE_MARGIN) {
      console.log(`❌ Zone break rejected: Close at ${candle.close.toFixed(2)} but need ${(upperZone + ZONE_MARGIN).toFixed(2)} (upper ${upperZone} + 3pt margin)`);
    }
    if (lowerZone !== null && candle.close < lowerZone && candle.close >= lowerZone - ZONE_MARGIN) {
      console.log(`❌ Zone break rejected: Close at ${candle.close.toFixed(2)} but need ${(lowerZone - ZONE_MARGIN).toFixed(2)} (lower ${lowerZone} - 3pt margin)`);
    }

    // Bullish: close above upper zone + 3 pts
    if (upperZone !== null && candle.close > upperZone + ZONE_MARGIN) {
      log(`Zone break detected: Bullish (close ${candle.close} > upper ${upperZone} + ${ZONE_MARGIN} pts)`, { candle, upperZone }, 'success');
      return { broken: true, direction: 'bullish' };
    }

    // Bearish: close below lower zone - 3 pts
    if (lowerZone !== null && candle.close < lowerZone - ZONE_MARGIN) {
      log(`Zone break detected: Bearish (close ${candle.close} < lower ${lowerZone} - ${ZONE_MARGIN} pts)`, { candle, lowerZone }, 'success');
      return { broken: true, direction: 'bearish' };
    }

    return { broken: false, direction: null };
  }, [log]);

  // ===== STAGE 2: VOLUME CONFIRMATION =====

  const checkVolumeConfirmation = useCallback((candles: CandleData[], zoneBreakTime: number): boolean => {
    // Find zone break candle by time
    const zoneBreakIndex = candles.findIndex(c => c.time === zoneBreakTime);
    if (zoneBreakIndex === -1) {
      log('Zone break candle not found in array', { zoneBreakTime }, 'warning');
      return false;
    }

    const zoneBreakCandle = candles[zoneBreakIndex];
    const zoneBreakVolume = zoneBreakCandle.volume || 0;

    // Check if zone break candle itself has volume confirmation
    if (zoneBreakIndex > 0) {
      const previousCandle = candles[zoneBreakIndex - 1];
      const previousVolume = previousCandle.volume || 0;
      const ratio = zoneBreakVolume / previousVolume;

      console.log('🔊 VOLUME CHECK - Zone Break Candle:', {
        zoneBreakVolume,
        previousVolume,
        ratio: ratio.toFixed(2),
        required: config.volumeMultiplier,
        passes: ratio >= config.volumeMultiplier ? '✅ YES' : '❌ NO'
      });

      if (ratio >= config.volumeMultiplier) {
        log(`✅ Volume confirmed: Zone break candle has ${config.volumeMultiplier}x volume`, {
          zoneBreakVolume,
          previousVolume,
          multiplier: ratio.toFixed(2)
        }, 'success');
        return true;
      }
    }

    // If zone break candle doesn't have volume confirmation, check next candle
    if (candles.length <= zoneBreakIndex + 1) {
      console.log('⏳ Next candle not available yet, waiting...');
      return false; // Next candle not available yet
    }

    const nextCandle = candles[zoneBreakIndex + 1];
    const nextVolume = nextCandle.volume || 0;
    const nextRatio = nextVolume / zoneBreakVolume;

    console.log('🔊 VOLUME CHECK - Next Candle:', {
      nextVolume,
      zoneBreakVolume,
      ratio: nextRatio.toFixed(2),
      required: config.volumeMultiplier,
      passes: nextRatio >= config.volumeMultiplier ? '✅ YES' : '❌ NO'
    });

    if (nextRatio >= config.volumeMultiplier) {
      log(`✅ Volume confirmed: Next candle after zone break has ${config.volumeMultiplier}x volume`, {
        nextVolume,
        zoneBreakVolume,
        multiplier: nextRatio.toFixed(2)
      }, 'success');
      return true;
    }

    return false;
  }, [config.volumeMultiplier, log]);

  // ===== STAGE 4: POSITION SIZING =====

  const calculatePositionSize = useCallback((middleCandle: CandleData, direction: 'bullish' | 'bearish'): {
    contracts: number;
    stopDistance: number;
  } => {
    const { tickSize, tickValue, targetRiskMin, targetRiskMax } = config;

    // Calculate entry and stop based on middle FVG candle
    let entry: number;
    let stop: number;

    if (direction === 'bullish') {
      entry = middleCandle.high;              // Entry at exact high (no buffer)
      stop = middleCandle.low - tickSize;     // Stop at low - 1 tick
    } else {
      entry = middleCandle.low;               // Entry at exact low (no buffer)
      stop = middleCandle.high + tickSize;    // Stop at high + 1 tick
    }

    const stopDistance = Math.abs(entry - stop);
    const stopDistanceTicks = Math.round(stopDistance / tickSize);
    const stopDistanceDollars = stopDistanceTicks * tickValue;

    // Calculate contracts to achieve target risk between $190-$210
    let contracts = Math.max(1, Math.floor(targetRiskMin / stopDistanceDollars));

    // Verify risk is within range, adjust if needed
    let actualRisk = contracts * stopDistanceTicks * tickValue;

    // If risk is too high, reduce contracts
    while (actualRisk > targetRiskMax && contracts > 1) {
      contracts--;
      actualRisk = contracts * stopDistanceTicks * tickValue;
    }

    // If risk is too low with 1 contract, that's the minimum
    if (contracts === 1 && actualRisk < targetRiskMin) {
      log(`Warning: Risk ($${actualRisk.toFixed(2)}) below target ($${targetRiskMin}) with 1 contract`, {
        middleCandle,
        direction,
        stopDistance,
        contracts
      }, 'warning');
    }

    log(`Position size calculated: ${contracts} contracts (stop: ${stopDistance.toFixed(2)}pts, risk: $${actualRisk.toFixed(2)})`, {
      middleCandle,
      direction,
      entry: entry.toFixed(2),
      stop: stop.toFixed(2),
      stopDistance: stopDistance.toFixed(2),
      stopDistanceTicks,
      stopDistanceDollars: stopDistanceDollars.toFixed(2),
      contracts,
      actualRisk: actualRisk.toFixed(2)
    }, 'info');

    return { contracts, stopDistance };
  }, [config, log]);

  // ===== STAGE 5: ORDER PRICE CALCULATION =====

  const calculateOrderPrices = useCallback((
    middleCandle: CandleData,
    stopDistance: number,
    direction: 'bullish' | 'bearish'
  ): {
    entry: number;
    stopLoss: number;
    takeProfit: number;
    rrRatio: number;
  } => {
    const { tickSize } = config;

    let entry: number;
    let stopLoss: number;
    let takeProfit: number;

    if (direction === 'bullish') {
      // Bullish: Entry at exact high, Stop at low - 1 tick
      entry = middleCandle.high;
      stopLoss = middleCandle.low - tickSize;

      const stopDistancePoints = Math.abs(entry - stopLoss);

      // R:R ratio based on stop distance
      let rrRatio: number;
      if (stopDistancePoints > 6) {
        rrRatio = 2; // 2:1 R:R for stops > 6pts
      } else if (stopDistancePoints >= 3) {
        rrRatio = 3; // 3:1 R:R for stops 3-6pts
      } else {
        rrRatio = 5; // 5:1 R:R for stops < 3pts
      }

      takeProfit = entry + (stopDistancePoints * rrRatio);

    } else {
      // Bearish: Entry at exact low, Stop at high + 1 tick
      entry = middleCandle.low;
      stopLoss = middleCandle.high + tickSize;

      const stopDistancePoints = Math.abs(stopLoss - entry);

      // R:R ratio based on stop distance
      let rrRatio: number;
      if (stopDistancePoints > 6) {
        rrRatio = 2; // 2:1 R:R for stops > 6pts
      } else if (stopDistancePoints >= 3) {
        rrRatio = 3; // 3:1 R:R for stops 3-6pts
      } else {
        rrRatio = 5; // 5:1 R:R for stops < 3pts
      }

      takeProfit = entry - (stopDistancePoints * rrRatio);
    }

    const stopDistancePoints = Math.abs(entry - stopLoss);
    const rrRatio = direction === 'bullish'
      ? (stopDistancePoints > 6 ? 2 : stopDistancePoints >= 3 ? 3 : 5)
      : (stopDistancePoints > 6 ? 2 : stopDistancePoints >= 3 ? 3 : 5);

    log(`Order prices calculated: Entry=${entry.toFixed(2)}, SL=${stopLoss.toFixed(2)}, TP=${takeProfit.toFixed(2)}, R:R=${rrRatio}:1`, {
      middleCandle,
      direction,
      entry,
      stopLoss,
      takeProfit,
      stopDistancePoints,
      rrRatio
    }, 'success');

    return { entry, stopLoss, takeProfit, rrRatio };
  }, [config, log]);

  // ===== STAGE 6: TRAILING STOP MANAGEMENT =====

  const manageTrailingStop = useCallback((
    entryPrice: number,
    currentPrice: number,
    stopLoss: number,
    direction: 'bullish' | 'bearish'
  ): {
    shouldMoveToBreakEven: boolean;
    newStopLoss: number;
  } => {
    const profitPoints = direction === 'bullish'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;

    // Move to breakeven when 10pts in profit
    if (profitPoints >= config.breakEvenTrigger) {
      log(`Trailing stop: Moving to breakeven (profit: ${profitPoints.toFixed(2)}pts)`, {
        entryPrice,
        currentPrice,
        profitPoints
      }, 'success');

      return {
        shouldMoveToBreakEven: true,
        newStopLoss: entryPrice
      };
    }

    return {
      shouldMoveToBreakEven: false,
      newStopLoss: stopLoss
    };
  }, [config.breakEvenTrigger, log]);

  // ===== SAFETY VALIDATIONS =====

  const validateSafety = useCallback((): { valid: boolean; reason?: string } => {
    // Check timeframe
    if (config.timeframe !== '5m') {
      return { valid: false, reason: 'Automation only runs on 5-minute timeframe' };
    }

    // Check daily trade limit
    if (statsRef.current.todayTrades >= config.maxDailyTrades) {
      return { valid: false, reason: `Daily trade limit reached (${config.maxDailyTrades})` };
    }

    // Check daily loss limit
    if (statsRef.current.todayPnL <= -config.maxDailyLoss) {
      return { valid: false, reason: `Daily loss limit reached ($${config.maxDailyLoss})` };
    }

    return { valid: true };
  }, [config.timeframe, config.maxDailyTrades, config.maxDailyLoss]); // Only primitive values

  // ===== RESET FUNCTION =====

  const reset = useCallback((reason: string = 'Manual reset') => {
    log(`Automation reset: ${reason}`, null, 'warning');
    setContext(prev => ({
      state: AutomationState.IDLE,
      direction: null,
      preSessionBreakDetected: false,
      preSessionBreakDirection: null,
      preSessionBreakTime: null,
      retestDetected: false,
      retestCandle: null,
      retestTime: null,
      zoneBreakCandle: null,
      zoneBreakPrice: null,
      zoneBreakTime: null,
      volumeConfirmationComplete: false,
      detectedFVG: null,
      fvgDetectionTime: null,
      calculatedEntry: null,
      calculatedStopLoss: null,
      calculatedTakeProfit: null,
      calculatedContracts: null,
      stopDistancePoints: null,
      riskRewardRatio: null,
      placedOrderId: null,
      orderPlacementTime: null,
      entryPrice: null,
      fillTime: null,
      breakEvenMoved: false,
      trailingStopActive: false,
      currentStopLoss: null,
      error: null,
      lastActionTime: Date.now(),
      sessionStartTime: prev.sessionStartTime,
    }));
  }, [log]);

  // ===== EMERGENCY STOP =====

  const emergencyStop = useCallback(() => {
    log('EMERGENCY STOP TRIGGERED', null, 'error');
    reset('Emergency stop');
    // TODO: Cancel all pending orders
    // TODO: Close all positions (if config allows)
  }, [reset, log]);

  // ===== RETURN INTERFACE =====

  return {
    // State
    context,
    stats,
    logs,

    // Actions
    detectZoneBreak,
    checkVolumeConfirmation,
    calculatePositionSize,
    calculateOrderPrices,
    manageTrailingStop,
    validateSafety,
    transitionTo,
    setError,
    reset,
    emergencyStop,
    log,

    // Utilities
    setContext,
    setStats,
  };
}
