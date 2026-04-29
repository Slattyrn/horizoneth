import { useState, useEffect } from "react";
import { Target, TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Clock, Ruler, XCircle } from "lucide-react";
import { useTicker } from "../contexts/TickerContext";

export interface FVG {
  time: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  entry: number;
  endTime?: number;
}

export interface OrderSuggestion {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  orderType: 'buy' | 'sell';
  riskRewardRatio: number;
  fvgHeight: number;
  fvgHeightTicks: number;
  riskTicks: number;
  profitTicks: number;
  isValid: boolean;
  warnings: string[];
}

interface FVGOrderSuggestionProps {
  latestFVG: FVG | null;
  currentPrice: number | null;
  onAutoFillOrder: (suggestion: OrderSuggestion) => void;
  onClearOrderLines?: () => void;
  className?: string;
}

export default function FVGOrderSuggestion({
  latestFVG,
  currentPrice,
  onAutoFillOrder,
  onClearOrderLines,
  className = ""
}: FVGOrderSuggestionProps) {
  const [suggestion, setSuggestion] = useState<OrderSuggestion | null>(null);
  const [entryMode, setEntryMode] = useState<'midpoint' | 'edge' | 'aggressive'>('midpoint');
  const [rrMultiplier, setRRMultiplier] = useState<number>(2.0);
  const [stopBufferTicks, setStopBufferTicks] = useState<number>(4);
  const [autoFilled, setAutoFilled] = useState<boolean>(false);
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  const [cancelSuccess, setCancelSuccess] = useState<boolean>(false);

  // Tick economics follow the active ticker (MYM 1.0/$0.50 or MES 0.25/$1.25).
  const { activeConfig } = useTicker();
  const TICK_SIZE = activeConfig.tickSize;
  const TICK_VALUE = activeConfig.tickValue;
  const MIN_RR_RATIO = 1.5;
  const MAX_FVG_AGE_CANDLES = 10;

  // Round price to valid tick increment
  const roundToTick = (price: number): number => {
    return Math.round(price / TICK_SIZE) * TICK_SIZE;
  };

  // Calculate order suggestion from FVG
  const calculateSuggestion = (fvg: FVG): OrderSuggestion | null => {
    const warnings: string[] = [];
    const fvgHeight = fvg.top - fvg.bottom;
    const fvgHeightTicks = Math.round(fvgHeight / TICK_SIZE);

    // Validate FVG height (minimum 2 ticks)
    if (fvgHeightTicks < 2) {
      warnings.push('FVG too small (< 2 ticks)');
      return null;
    }

    let entry: number;
    let stopLoss: number;
    let takeProfit: number;
    let orderType: 'buy' | 'sell';

    if (fvg.type === 'bullish') {
      // Long setup
      orderType = 'buy';

      // Calculate entry based on mode
      switch (entryMode) {
        case 'midpoint':
          entry = fvg.bottom + (fvgHeight * 0.5);
          break;
        case 'edge':
          entry = fvg.bottom; // Bottom of FVG (more conservative)
          break;
        case 'aggressive':
          entry = fvg.top - (fvgHeight * 0.25); // Upper quarter
          break;
      }
      entry = roundToTick(entry);

      // Stop loss: Below FVG with buffer
      stopLoss = roundToTick(fvg.bottom - (stopBufferTicks * TICK_SIZE));

      // Take profit: Entry + (Risk * RR Multiplier)
      const risk = entry - stopLoss;
      takeProfit = roundToTick(entry + (risk * rrMultiplier));

    } else {
      // Short setup
      orderType = 'sell';

      // Calculate entry based on mode
      switch (entryMode) {
        case 'midpoint':
          entry = fvg.top - (fvgHeight * 0.5);
          break;
        case 'edge':
          entry = fvg.top; // Top of FVG (more conservative)
          break;
        case 'aggressive':
          entry = fvg.bottom + (fvgHeight * 0.25); // Lower quarter
          break;
      }
      entry = roundToTick(entry);

      // Stop loss: Above FVG with buffer
      stopLoss = roundToTick(fvg.top + (stopBufferTicks * TICK_SIZE));

      // Take profit: Entry - (Risk * RR Multiplier)
      const risk = stopLoss - entry;
      takeProfit = roundToTick(entry - (risk * rrMultiplier));
    }

    // Calculate metrics
    const riskPoints = Math.abs(entry - stopLoss);
    const profitPoints = Math.abs(takeProfit - entry);
    const riskTicks = Math.round(riskPoints / TICK_SIZE);
    const profitTicks = Math.round(profitPoints / TICK_SIZE);
    const riskRewardRatio = riskTicks > 0 ? profitTicks / riskTicks : 0;

    // Validate R:R ratio
    if (riskRewardRatio < MIN_RR_RATIO) {
      warnings.push(`R:R below minimum (${riskRewardRatio.toFixed(2)} < ${MIN_RR_RATIO})`);
    }

    // Check distance from current price
    if (currentPrice) {
      const distanceFromEntry = Math.abs(currentPrice - entry);
      const distanceTicks = Math.round(distanceFromEntry / TICK_SIZE);

      if (distanceTicks > 20) {
        warnings.push(`Entry far from current price (${distanceTicks} ticks)`);
      }

      // Check if FVG has been invalidated (price filled the gap)
      if (orderType === 'buy' && currentPrice < fvg.bottom) {
        warnings.push('FVG potentially invalidated (price below gap)');
      } else if (orderType === 'sell' && currentPrice > fvg.top) {
        warnings.push('FVG potentially invalidated (price above gap)');
      }
    }

    const isValid = warnings.length === 0 || warnings.every(w => !w.includes('invalidated') && !w.includes('too small'));

    return {
      entry,
      stopLoss,
      takeProfit,
      orderType,
      riskRewardRatio,
      fvgHeight,
      fvgHeightTicks,
      riskTicks,
      profitTicks,
      isValid,
      warnings
    };
  };

  // Recalculate suggestion when FVG or parameters change
  useEffect(() => {
    if (!latestFVG) {
      setSuggestion(null);
      setAutoFilled(false);
      return;
    }

    const newSuggestion = calculateSuggestion(latestFVG);
    setSuggestion(newSuggestion);
    setAutoFilled(false);
  }, [latestFVG, entryMode, rrMultiplier, stopBufferTicks, currentPrice]);

  // Handle auto-fill button click
  const handleAutoFill = () => {
    if (suggestion && suggestion.isValid) {
      onAutoFillOrder(suggestion);
      setAutoFilled(true);

      // Reset auto-filled indicator after 3 seconds
      setTimeout(() => setAutoFilled(false), 3000);
    }
  };

  // Handle clear order lines (visual lines on chart, not actual orders)
  const handleCancelAllOrders = () => {
    if (!window.confirm('Clear order lines from chart?')) {
      return;
    }

    setIsCanceling(true);
    setCancelSuccess(false);

    try {
      // Clear the visual order lines on the chart
      if (onClearOrderLines) {
        onClearOrderLines();
        console.log('✅ Order lines cleared from chart');
        setCancelSuccess(true);
        setTimeout(() => setCancelSuccess(false), 2000);
      }
    } catch (error) {
      console.error('Clear order lines error:', error);
    } finally {
      setIsCanceling(false);
    }
  };

  // Calculate FVG age (time since detection)
  const getFVGAge = (): string => {
    if (!latestFVG) return 'N/A';
    const now = Math.floor(Date.now() / 1000);
    const ageSeconds = now - latestFVG.time;
    const ageMinutes = Math.floor(ageSeconds / 60);

    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes === 1) return '1 min ago';
    if (ageMinutes < 60) return `${ageMinutes} mins ago`;

    const ageHours = Math.floor(ageMinutes / 60);
    return `${ageHours}h ${ageMinutes % 60}m ago`;
  };

  // No FVG detected
  if (!latestFVG || !suggestion) {
    return (
      <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-5 ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Target className="text-cyan-500" size={22} />
            FVG Order Suggestion
          </h3>
        </div>

        <div className="flex flex-col items-center justify-center py-8 text-gray-500">
          <AlertCircle size={40} className="mb-3 opacity-50" />
          <p className="text-sm">No recent FVG detected</p>
          <p className="text-xs mt-1 opacity-70">Waiting for valid pattern...</p>
        </div>

        {/* Cancel All Orders Button (always available) */}
        <button
          onClick={handleCancelAllOrders}
          disabled={isCanceling || cancelSuccess}
          className={`w-full mt-4 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
            cancelSuccess
              ? 'bg-green-500/20 text-green-400 border border-green-500/40 cursor-default'
              : isCanceling
              ? 'bg-gray-700/50 text-gray-400 border border-gray-600/50 cursor-wait'
              : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 hover:border-red-500/60'
          }`}
        >
          {cancelSuccess ? (
            <>
              <CheckCircle2 size={18} />
              Lines Cleared
            </>
          ) : isCanceling ? (
            <>
              <div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />
              Clearing...
            </>
          ) : (
            <>
              <XCircle size={18} />
              Clear Order Lines
            </>
          )}
        </button>
      </div>
    );
  }

  const isBullish = latestFVG.type === 'bullish';

  return (
    <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-5 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <Target className="text-cyan-500" size={22} />
          FVG Order Suggestion
        </h3>

        {suggestion.isValid ? (
          <div className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/30 px-2 py-1 rounded-lg">
            <CheckCircle2 size={14} />
            Valid
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 px-2 py-1 rounded-lg">
            <AlertCircle size={14} />
            Warning
          </div>
        )}
      </div>

      {/* FVG Info */}
      <div className={`mb-4 p-3 rounded-lg border ${
        isBullish
          ? 'bg-green-500/5 border-green-500/30'
          : 'bg-red-500/5 border-red-500/30'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isBullish ? (
              <TrendingUp className="text-green-500" size={18} />
            ) : (
              <TrendingDown className="text-red-500" size={18} />
            )}
            <span className={`font-semibold text-sm ${
              isBullish ? 'text-green-400' : 'text-red-400'
            }`}>
              {isBullish ? 'Bullish' : 'Bearish'} FVG
            </span>
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Clock size={12} />
            {getFVGAge()}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-500">Top: </span>
            <span className="text-white font-mono">{latestFVG.top.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">Bottom: </span>
            <span className="text-white font-mono">{latestFVG.bottom.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">Height: </span>
            <span className="text-white font-mono">{suggestion.fvgHeight.toFixed(2)} pts</span>
          </div>
          <div>
            <span className="text-gray-500">Ticks: </span>
            <span className="text-white font-mono">{suggestion.fvgHeightTicks}</span>
          </div>
        </div>
      </div>

      {/* Entry Mode Selector */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 mb-2 block">Entry Mode</label>
        <div className="grid grid-cols-3 gap-2">
          {(['edge', 'midpoint', 'aggressive'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setEntryMode(mode)}
              className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                entryMode === mode
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                  : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:bg-gray-700/50'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* R:R Multiplier */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-400">R:R Multiplier</label>
          <span className="text-xs text-white font-mono">{rrMultiplier.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min="1.0"
          max="4.0"
          step="0.5"
          value={rrMultiplier}
          onChange={(e) => setRRMultiplier(parseFloat(e.target.value))}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1.0x</span>
          <span>4.0x</span>
        </div>
      </div>

      {/* Order Prices */}
      <div className="space-y-2 mb-4">
        <div className="bg-gray-800/50 border border-gray-700/50 p-3 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Entry ({entryMode}):</span>
            <span className="text-sm font-mono text-cyan-400 font-semibold">
              {suggestion.entry.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Stop Loss:</span>
            <span className="text-sm font-mono text-red-400 font-semibold">
              {suggestion.stopLoss.toFixed(2)}
            </span>
          </div>
          <div className="text-xs text-red-400/70">
            -{suggestion.riskTicks} ticks (${(suggestion.riskTicks * TICK_VALUE).toFixed(0)})
          </div>
        </div>

        <div className="bg-green-500/10 border border-green-500/30 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Take Profit:</span>
            <span className="text-sm font-mono text-green-400 font-semibold">
              {suggestion.takeProfit.toFixed(2)}
            </span>
          </div>
          <div className="text-xs text-green-400/70">
            +{suggestion.profitTicks} ticks (${(suggestion.profitTicks * TICK_VALUE).toFixed(0)})
          </div>
        </div>
      </div>

      {/* Risk/Reward Display */}
      <div className={`mb-4 p-3 rounded-lg border ${
        suggestion.riskRewardRatio >= MIN_RR_RATIO
          ? 'bg-green-500/10 border-green-500/30'
          : 'bg-yellow-500/10 border-yellow-500/30'
      }`}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Risk/Reward Ratio:</span>
          <span className={`text-lg font-bold font-mono ${
            suggestion.riskRewardRatio >= MIN_RR_RATIO ? 'text-green-400' : 'text-yellow-400'
          }`}>
            1:{suggestion.riskRewardRatio.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Warnings */}
      {suggestion.warnings.length > 0 && (
        <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 p-3 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              {suggestion.warnings.map((warning, idx) => (
                <p key={idx} className="text-xs text-yellow-400">
                  {warning}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Auto-Fill Button */}
      <button
        onClick={handleAutoFill}
        disabled={!suggestion.isValid || autoFilled}
        className={`w-full py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
          autoFilled
            ? 'bg-green-500/20 text-green-400 border border-green-500/40 cursor-default'
            : suggestion.isValid
            ? 'bg-cyan-500 hover:bg-cyan-600 text-white border border-cyan-400 shadow-lg shadow-cyan-500/20'
            : 'bg-gray-700/50 text-gray-500 border border-gray-600/50 cursor-not-allowed'
        }`}
      >
        {autoFilled ? (
          <>
            <CheckCircle2 size={18} />
            Order Auto-Filled
          </>
        ) : (
          <>
            <Target size={18} />
            Auto-Fill Orders
          </>
        )}
      </button>

      {/* Cancel All Orders Button */}
      <button
        onClick={handleCancelAllOrders}
        disabled={isCanceling || cancelSuccess}
        className={`w-full mt-3 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
          cancelSuccess
            ? 'bg-green-500/20 text-green-400 border border-green-500/40 cursor-default'
            : isCanceling
            ? 'bg-gray-700/50 text-gray-400 border border-gray-600/50 cursor-wait'
            : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 hover:border-red-500/60'
        }`}
      >
        {cancelSuccess ? (
          <>
            <CheckCircle2 size={18} />
            Lines Cleared
          </>
        ) : isCanceling ? (
          <>
            <div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />
            Clearing...
          </>
        ) : (
          <>
            <XCircle size={18} />
            Clear Order Lines
          </>
        )}
      </button>

      {/* Info Footer */}
      <div className="mt-4 text-xs text-gray-500 bg-gray-800/30 p-2 rounded-lg border border-gray-700/30">
        <div className="flex items-start gap-2">
          <Ruler size={12} className="mt-0.5 flex-shrink-0" />
          <span>Stop buffer: {stopBufferTicks} ticks ({(stopBufferTicks * TICK_SIZE).toFixed(2)} pts)</span>
        </div>
      </div>
    </div>
  );
}
