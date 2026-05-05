import { useState, useEffect } from "react";
import { Target, TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Clock, Ruler, XCircle, Layers, RefreshCw, Send } from "lucide-react";
import { useTicker } from "../contexts/TickerContext";
import { useAccount } from "../contexts/AccountContext";

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
  contracts: number;
  isValid: boolean;
  warnings: string[];
}

export interface ManualEntry {
  price: number;
  side: 'long' | 'short';
  mode: 'fvg' | 'reclaim';
  candleStop?: number; // pre-computed from candle lookup in ChartPanel
}

interface FVGOrderSuggestionProps {
  latestFVG: FVG | null;
  currentPrice: number | null;
  manualEntry?: ManualEntry | null;
  onAutoFillOrder: (suggestion: OrderSuggestion) => void;
  onSuggestionCalculated?: (suggestion: OrderSuggestion | null) => void;
  onClearOrderLines?: () => void;
  className?: string;
}

export default function FVGOrderSuggestion({
  latestFVG,
  currentPrice,
  manualEntry = null,
  onAutoFillOrder,
  onSuggestionCalculated,
  onClearOrderLines,
  className = ""
}: FVGOrderSuggestionProps) {
  const [suggestion, setSuggestion] = useState<OrderSuggestion | null>(null);
  const [entryMode, setEntryMode] = useState<'midpoint' | 'edge' | 'aggressive'>('midpoint');
  const [rrMultiplier, setRRMultiplier] = useState<number>(2.0);
  const [stopBufferTicks, setStopBufferTicks] = useState<number>(4);
  const [targetRisk, setTargetRisk] = useState<number>(500);
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  const [cancelSuccess, setCancelSuccess] = useState<boolean>(false);

  const { activeConfig } = useTicker();
  const { selectedAccountId } = useAccount();
  const TICK_SIZE = activeConfig.tickSize;
  const TICK_VALUE = activeConfig.tickValue;
  const MIN_RR_RATIO = 1.5;

  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderStatus, setOrderStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });

  const handlePlaceOrder = async () => {
    if (!suggestion || !suggestion.isValid) return;
    setIsPlacingOrder(true);
    setOrderStatus({ type: null, message: '' });
    try {
      const payload: any = {
        contractId: activeConfig.contract,
        side: suggestion.orderType,
        orderType: 'limit',
        quantity: suggestion.contracts,
        price: suggestion.entry,
        stopLoss: suggestion.stopLoss,
        takeProfit: suggestion.takeProfit,
      };
      const url = selectedAccountId
        ? `/api/orders/place?account_id=${selectedAccountId}`
        : '/api/orders/place';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || 'Order failed');
      if (data.success) {
        setOrderStatus({ type: 'success', message: `Sent — entry: ${data.orderId}` });
        setTimeout(() => setOrderStatus({ type: null, message: '' }), 5000);
      }
    } catch (err) {
      setOrderStatus({ type: 'error', message: err instanceof Error ? err.message : 'Order failed' });
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const roundToTick = (price: number): number => Math.round(price / TICK_SIZE) * TICK_SIZE;

  const computeContracts = (riskTicks: number): number =>
    Math.max(1, Math.floor(targetRisk / (riskTicks * TICK_VALUE)));

  // Determine active mode
  const activeMode: 'auto-fvg' | 'manual' | 'none' =
    latestFVG ? 'auto-fvg' :
    manualEntry ? 'manual' :
    'none';

  const modeLabel = activeMode === 'auto-fvg' ? 'FVG Entry' :
    manualEntry?.mode === 'reclaim' ? 'Reclaim Entry' : 'FVG Entry';

  // Build suggestion from auto-detected FVG
  const calculateFVGSuggestion = (fvg: FVG): OrderSuggestion | null => {
    const warnings: string[] = [];
    const fvgHeight = fvg.top - fvg.bottom;
    const fvgHeightTicks = Math.round(fvgHeight / TICK_SIZE);

    if (fvgHeightTicks < 2) {
      warnings.push('FVG too small (< 2 ticks)');
      return null;
    }

    let entry: number;
    let stopLoss: number;
    let takeProfit: number;
    let orderType: 'buy' | 'sell';

    if (fvg.type === 'bullish') {
      orderType = 'buy';
      switch (entryMode) {
        case 'midpoint': entry = fvg.bottom + fvgHeight * 0.5; break;
        case 'edge': entry = fvg.bottom; break;
        case 'aggressive': entry = fvg.top - fvgHeight * 0.25; break;
      }
      entry = roundToTick(entry!);
      stopLoss = roundToTick(fvg.bottom - stopBufferTicks * TICK_SIZE);
      const riskLong = entry - stopLoss;
      takeProfit = roundToTick(entry + riskLong * rrMultiplier);
    } else {
      orderType = 'sell';
      switch (entryMode) {
        case 'midpoint': entry = fvg.top - fvgHeight * 0.5; break;
        case 'edge': entry = fvg.top; break;
        case 'aggressive': entry = fvg.bottom + fvgHeight * 0.25; break;
      }
      entry = roundToTick(entry!);
      stopLoss = roundToTick(fvg.top + stopBufferTicks * TICK_SIZE);
      const riskShort = stopLoss - entry;
      takeProfit = roundToTick(entry - riskShort * rrMultiplier);
    }

    const riskPoints = Math.abs(entry - stopLoss);
    const profitPoints = Math.abs(takeProfit - entry);
    const riskTicks = Math.round(riskPoints / TICK_SIZE);
    const profitTicks = Math.round(profitPoints / TICK_SIZE);
    const riskRewardRatio = riskTicks > 0 ? profitTicks / riskTicks : 0;

    if (riskRewardRatio < MIN_RR_RATIO) warnings.push(`R:R below minimum (${riskRewardRatio.toFixed(2)} < ${MIN_RR_RATIO})`);

    if (currentPrice) {
      const distanceTicks = Math.round(Math.abs(currentPrice - entry) / TICK_SIZE);
      if (distanceTicks > 20) warnings.push(`Entry far from current price (${distanceTicks} ticks)`);
      if (orderType === 'buy' && currentPrice < fvg.bottom) warnings.push('FVG potentially invalidated (price below gap)');
      else if (orderType === 'sell' && currentPrice > fvg.top) warnings.push('FVG potentially invalidated (price above gap)');
    }

    const isValid = warnings.length === 0 || warnings.every(w => !w.includes('invalidated') && !w.includes('too small'));
    const contracts = computeContracts(riskTicks);

    return { entry, stopLoss, takeProfit, orderType, riskRewardRatio, fvgHeight, fvgHeightTicks, riskTicks, profitTicks, contracts, isValid, warnings };
  };

  // Build suggestion from right-click manual entry
  const calculateManualSuggestion = (me: ManualEntry): OrderSuggestion | null => {
    const warnings: string[] = [];
    const isLong = me.side === 'long';
    const orderType: 'buy' | 'sell' = isLong ? 'buy' : 'sell';

    let entry: number;
    let stopLoss: number;
    let takeProfit: number;

    if (me.mode === 'reclaim') {
      // Reclaim: entry is 1 tick beyond the series extreme (user clicked the extreme)
      entry = isLong
        ? roundToTick(me.price + TICK_SIZE)
        : roundToTick(me.price - TICK_SIZE);
      // Stop anchored to opposite-color 6 EMA candle if available, else to clicked level
      const reclaimBase = me.candleStop ?? me.price;
      stopLoss = isLong
        ? roundToTick(reclaimBase - stopBufferTicks * TICK_SIZE)
        : roundToTick(reclaimBase + stopBufferTicks * TICK_SIZE);
    } else {
      // FVG: entry directly at clicked price
      entry = roundToTick(me.price);
      // Stop anchored to same-direction candle below/above 6 EMA if available
      const fvgBase = me.candleStop ?? me.price;
      stopLoss = isLong
        ? roundToTick(fvgBase - stopBufferTicks * TICK_SIZE)
        : roundToTick(fvgBase + stopBufferTicks * TICK_SIZE);
    }

    const riskPoints = Math.abs(entry - stopLoss);
    const riskTicks = Math.round(riskPoints / TICK_SIZE);

    if (riskTicks < 1) {
      warnings.push('Risk too small — increase stop buffer');
      return null;
    }

    const profitPoints = riskPoints * rrMultiplier;
    takeProfit = isLong
      ? roundToTick(entry + profitPoints)
      : roundToTick(entry - profitPoints);

    const profitTicks = Math.round(profitPoints / TICK_SIZE);
    const riskRewardRatio = rrMultiplier;
    const contracts = computeContracts(riskTicks);

    return {
      entry, stopLoss, takeProfit, orderType, riskRewardRatio,
      fvgHeight: 0, fvgHeightTicks: 0,
      riskTicks, profitTicks, contracts, isValid: true, warnings
    };
  };

  useEffect(() => {
    setAutoFilled(false);
    let next: OrderSuggestion | null = null;
    if (activeMode === 'auto-fvg' && latestFVG) {
      next = calculateFVGSuggestion(latestFVG);
    } else if (activeMode === 'manual' && manualEntry) {
      next = calculateManualSuggestion(manualEntry);
    }
    setSuggestion(next);
    onSuggestionCalculated?.(next);
  }, [latestFVG, manualEntry, entryMode, rrMultiplier, stopBufferTicks, targetRisk, currentPrice]);

const handleClearOrderLines = () => {
    if (!window.confirm('Clear order lines from chart?')) return;
    setIsCanceling(true);
    setCancelSuccess(false);
    try {
      if (onClearOrderLines) {
        onClearOrderLines();
        setCancelSuccess(true);
        setTimeout(() => setCancelSuccess(false), 2000);
      }
    } catch {}
    finally { setIsCanceling(false); }
  };

  const getFVGAge = (): string => {
    if (!latestFVG) return 'N/A';
    const ageSeconds = Math.floor(Date.now() / 1000) - latestFVG.time;
    const ageMinutes = Math.floor(ageSeconds / 60);
    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes === 1) return '1 min ago';
    if (ageMinutes < 60) return `${ageMinutes} mins ago`;
    const ageHours = Math.floor(ageMinutes / 60);
    return `${ageHours}h ${ageMinutes % 60}m ago`;
  };

  const ModeIcon = manualEntry?.mode === 'reclaim' ? RefreshCw : Layers;

  // ─── Empty state ─────────────────────────────────────────────────────────
  if (activeMode === 'none' || !suggestion) {
    return (
      <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-5 ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Target className="text-cyan-500" size={22} />
            Risk Management
          </h3>
        </div>

        <div className="flex flex-col items-center justify-center py-6 text-gray-500">
          <AlertCircle size={36} className="mb-3 opacity-50" />
          <p className="text-sm">No setup active</p>
          <p className="text-xs mt-1 opacity-70">Right-click chart → FVG Long/Short or Reclaim Long/Short</p>
        </div>

        {/* Stop buffer + R:R controls still visible so user can configure before clicking */}
        <div className="space-y-3 mb-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-400">Stop Buffer</label>
              <span className="text-xs text-white font-mono">{stopBufferTicks}t ({(stopBufferTicks * TICK_SIZE).toFixed(2)} pts)</span>
            </div>
            <input type="range" min="1" max="20" step="1" value={stopBufferTicks}
              onChange={(e) => setStopBufferTicks(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-400">R:R Multiplier</label>
              <span className="text-xs text-white font-mono">{rrMultiplier.toFixed(1)}x</span>
            </div>
            <input type="range" min="1.0" max="4.0" step="0.5" value={rrMultiplier}
              onChange={(e) => setRRMultiplier(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-400">Target Risk ($)</label>
              <span className="text-xs text-white font-mono">${targetRisk}</span>
            </div>
            <input type="range" min="100" max="2000" step="50" value={targetRisk}
              onChange={(e) => setTargetRisk(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
          </div>
        </div>

        <button onClick={handleClearOrderLines} disabled={isCanceling || cancelSuccess}
          className={`w-full mt-2 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
            cancelSuccess ? 'bg-green-500/20 text-green-400 border border-green-500/40 cursor-default'
            : isCanceling ? 'bg-gray-700/50 text-gray-400 border border-gray-600/50 cursor-wait'
            : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 hover:border-red-500/60'}`}>
          {cancelSuccess ? <><CheckCircle2 size={18} /> Lines Cleared</>
            : isCanceling ? <><div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />Clearing...</>
            : <><XCircle size={18} /> Clear Order Lines</>}
        </button>
      </div>
    );
  }

  // ─── Active suggestion ────────────────────────────────────────────────────
  const isBullish = suggestion.orderType === 'buy';

  return (
    <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-5 ${className}`}>
      {/* Header + mode badge */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <Target className="text-cyan-500" size={22} />
          Risk Management
        </h3>
        <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${
          manualEntry?.mode === 'reclaim'
            ? 'text-purple-400 bg-purple-500/10 border-purple-500/30'
            : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30'}`}>
          <ModeIcon size={12} />
          {modeLabel}
        </div>
      </div>

      {/* Setup info row */}
      <div className={`mb-4 p-3 rounded-lg border ${
        isBullish ? 'bg-green-500/5 border-green-500/30' : 'bg-red-500/5 border-red-500/30'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isBullish ? <TrendingUp className="text-green-500" size={18} /> : <TrendingDown className="text-red-500" size={18} />}
            <span className={`font-semibold text-sm ${isBullish ? 'text-green-400' : 'text-red-400'}`}>
              {isBullish ? 'Long' : 'Short'} Setup
            </span>
          </div>
          {activeMode === 'auto-fvg' && latestFVG && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Clock size={12} />{getFVGAge()}
            </div>
          )}
          {activeMode === 'manual' && manualEntry && (
            <div className="text-xs text-gray-400 font-mono">
              @ {manualEntry.price.toFixed(activeConfig.priceDecimals)}
            </div>
          )}
        </div>
        {activeMode === 'auto-fvg' && latestFVG && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-gray-500">Top: </span><span className="text-white font-mono">{latestFVG.top.toFixed(2)}</span></div>
            <div><span className="text-gray-500">Bottom: </span><span className="text-white font-mono">{latestFVG.bottom.toFixed(2)}</span></div>
            <div><span className="text-gray-500">Height: </span><span className="text-white font-mono">{suggestion.fvgHeight.toFixed(2)} pts</span></div>
            <div><span className="text-gray-500">Ticks: </span><span className="text-white font-mono">{suggestion.fvgHeightTicks}</span></div>
          </div>
        )}
      </div>

      {/* Entry Mode (FVG only) */}
      {activeMode === 'auto-fvg' && (
        <div className="mb-4">
          <label className="text-xs text-gray-400 mb-2 block">Entry Mode</label>
          <div className="grid grid-cols-3 gap-2">
            {(['edge', 'midpoint', 'aggressive'] as const).map((mode) => (
              <button key={mode} onClick={() => setEntryMode(mode)}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  entryMode === mode
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                    : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:bg-gray-700/50'}`}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stop Buffer + R:R */}
      <div className="space-y-3 mb-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-400">Stop Buffer</label>
            <span className="text-xs text-white font-mono">{stopBufferTicks}t ({(stopBufferTicks * TICK_SIZE).toFixed(2)} pts)</span>
          </div>
          <input type="range" min="1" max="20" step="1" value={stopBufferTicks}
            onChange={(e) => setStopBufferTicks(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-400">R:R Multiplier</label>
            <span className="text-xs text-white font-mono">{rrMultiplier.toFixed(1)}x</span>
          </div>
          <input type="range" min="1.0" max="4.0" step="0.5" value={rrMultiplier}
            onChange={(e) => setRRMultiplier(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-400">Target Risk ($)</label>
            <span className="text-xs text-white font-mono">${targetRisk}</span>
          </div>
          <input type="range" min="100" max="2000" step="50" value={targetRisk}
            onChange={(e) => setTargetRisk(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
        </div>
      </div>

      {/* Order Levels */}
      <div className="space-y-2 mb-4">
        <div className="bg-gray-800/50 border border-gray-700/50 p-3 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Entry{activeMode === 'auto-fvg' ? ` (${entryMode})` : ''}:</span>
            <span className="text-sm font-mono text-cyan-400 font-semibold">
              {suggestion.entry.toFixed(activeConfig.priceDecimals)}
            </span>
          </div>
        </div>

        <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Stop Loss:</span>
            <span className="text-sm font-mono text-red-400 font-semibold">
              {suggestion.stopLoss.toFixed(activeConfig.priceDecimals)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-red-400/70">
            <span>-{suggestion.riskTicks} ticks (${(suggestion.riskTicks * TICK_VALUE).toFixed(0)})</span>
            <span className="text-orange-400 font-semibold">{suggestion.contracts} contract{suggestion.contracts !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="bg-green-500/10 border border-green-500/30 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Take Profit:</span>
            <span className="text-sm font-mono text-green-400 font-semibold">
              {suggestion.takeProfit.toFixed(activeConfig.priceDecimals)}
            </span>
          </div>
          <div className="text-xs text-green-400/70">
            +{suggestion.profitTicks} ticks (${(suggestion.profitTicks * TICK_VALUE).toFixed(0)})
          </div>
        </div>
      </div>

      {/* R:R display */}
      <div className={`mb-4 p-3 rounded-lg border ${
        suggestion.riskRewardRatio >= MIN_RR_RATIO
          ? 'bg-green-500/10 border-green-500/30'
          : 'bg-yellow-500/10 border-yellow-500/30'}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Risk/Reward:</span>
          <span className={`text-lg font-bold font-mono ${suggestion.riskRewardRatio >= MIN_RR_RATIO ? 'text-green-400' : 'text-yellow-400'}`}>
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
              {suggestion.warnings.map((w, i) => <p key={i} className="text-xs text-yellow-400">{w}</p>)}
            </div>
          </div>
        </div>
      )}

      {/* Order status */}
      {orderStatus.type && (
        <div className={`mb-3 p-3 rounded-lg border flex items-start gap-2 text-xs ${
          orderStatus.type === 'success'
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          {orderStatus.type === 'success' ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}
          {orderStatus.message}
        </div>
      )}

      {/* Place Order button — submits directly to TopstepX */}
      <button onClick={handlePlaceOrder} disabled={!suggestion.isValid || isPlacingOrder}
        className={`w-full py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
          isPlacingOrder ? 'bg-gray-700/50 text-gray-400 border border-gray-600/50 cursor-wait'
          : suggestion.isValid ? 'bg-cyan-500 hover:bg-cyan-600 text-white border border-cyan-400 shadow-lg shadow-cyan-500/20'
          : 'bg-gray-700/50 text-gray-500 border border-gray-600/50 cursor-not-allowed'}`}>
        {isPlacingOrder
          ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Placing...</>
          : <><Send size={16} /> Place Order ({suggestion.contracts} contract{suggestion.contracts !== 1 ? 's' : ''})</>}
      </button>

      {/* Clear Lines */}
      <button onClick={handleClearOrderLines} disabled={isCanceling || cancelSuccess}
        className={`w-full mt-3 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
          cancelSuccess ? 'bg-green-500/20 text-green-400 border border-green-500/40 cursor-default'
          : isCanceling ? 'bg-gray-700/50 text-gray-400 border border-gray-600/50 cursor-wait'
          : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 hover:border-red-500/60'}`}>
        {cancelSuccess ? <><CheckCircle2 size={18} /> Lines Cleared</>
          : isCanceling ? <><div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />Clearing...</>
          : <><XCircle size={18} /> Clear Order Lines</>}
      </button>

      <div className="mt-4 text-xs text-gray-500 bg-gray-800/30 p-2 rounded-lg border border-gray-700/30">
        <div className="flex items-start gap-2">
          <Ruler size={12} className="mt-0.5 flex-shrink-0" />
          <span>Stop buffer: {stopBufferTicks}t · R:R {rrMultiplier}x · Risk ${targetRisk} → {suggestion.contracts} contract{suggestion.contracts !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}
