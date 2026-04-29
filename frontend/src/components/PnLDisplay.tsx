import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Activity, X } from 'lucide-react';
import { useTicker } from '../contexts/TickerContext';

interface PnLDisplayProps {
  position: {
    entryPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    side: 'buy' | 'sell';
    quantity: number;
    contractId: string;
  } | null;
  currentPrice: number | null;
  onClose?: () => void;
  className?: string;
}

export default function PnLDisplay({
  position,
  currentPrice,
  onClose,
  className = ''
}: PnLDisplayProps) {
  const [pnl, setPnl] = useState<number>(0);
  const [pnlPercent, setPnlPercent] = useState<number>(0);
  const [ticksProfit, setTicksProfit] = useState<number>(0);

  // Tick economics follow the active ticker (MYM 1.0/$0.50 or MES 0.25/$1.25).
  const { activeConfig } = useTicker();
  const TICK_SIZE = activeConfig.tickSize;
  const TICK_VALUE = activeConfig.tickValue;

  // Calculate P&L in real-time
  useEffect(() => {
    if (!position || !currentPrice) {
      setPnl(0);
      setPnlPercent(0);
      setTicksProfit(0);
      return;
    }

    let priceDiff = 0;

    if (position.side === 'buy') {
      // Long position: profit when price goes up
      priceDiff = currentPrice - position.entryPrice;
    } else {
      // Short position: profit when price goes down
      priceDiff = position.entryPrice - currentPrice;
    }

    // Calculate ticks and dollar P&L
    const ticks = priceDiff / TICK_SIZE;
    const dollarPnl = ticks * TICK_VALUE * position.quantity;

    // Calculate percentage
    const percent = (priceDiff / position.entryPrice) * 100;
    const signedPercent = position.side === 'buy' ? percent : -percent;

    setPnl(dollarPnl);
    setPnlPercent(signedPercent);
    setTicksProfit(ticks);
  }, [position, currentPrice]);

  // Don't render if no position
  if (!position || !currentPrice) {
    return null;
  }

  const isProfit = pnl >= 0;
  const profitClass = isProfit ? 'text-green-400' : 'text-red-400';
  const bgClass = isProfit ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30';

  // Calculate distance to SL/TP
  const distanceToSL = position.stopLoss
    ? Math.abs(currentPrice - position.stopLoss)
    : null;
  const distanceToTP = position.takeProfit
    ? Math.abs(currentPrice - position.takeProfit)
    : null;

  return (
    <div className={`rounded-xl border-2 ${bgClass} p-4 shadow-2xl ${className} relative overflow-hidden grayscale opacity-50 pointer-events-none`}>
      {/* DISABLED OVERLAY */}
      <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
        <div className="bg-gray-900/90 border border-white/10 px-3 py-1.5 rounded-lg shadow-2xl">
          <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Feature Disabled</span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className={profitClass} size={20} />
          <h3 className="text-lg font-bold text-white">Live Position</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-700/50 rounded"
            aria-label="Close position display"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Position Info */}
      <div className="bg-gray-900/50 rounded-lg p-3 mb-3 border border-gray-700/50">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-gray-400 text-xs">Side</div>
            <div className={`font-semibold flex items-center gap-1 ${
              position.side === 'buy' ? 'text-green-400' : 'text-red-400'
            }`}>
              {position.side === 'buy' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {position.side.toUpperCase()}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">Contracts</div>
            <div className="text-white font-semibold">{position.quantity}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">Entry Price</div>
            <div className="text-white font-semibold">${position.entryPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">Current Price</div>
            <div className="text-white font-semibold">${currentPrice.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* P&L Display */}
      <div className="space-y-2">
        {/* Main P&L */}
        <div className="bg-gray-900/70 rounded-lg p-4 border-2 border-gray-700/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-400">Unrealized P&L</span>
            <span className={`text-xs font-medium ${profitClass}`}>
              {isProfit ? '▲' : '▼'} {Math.abs(ticksProfit).toFixed(2)} ticks
            </span>
          </div>
          <div className={`text-3xl font-bold ${profitClass} mb-1`}>
            {isProfit ? '+' : ''}${pnl.toFixed(2)}
          </div>
          <div className={`text-sm font-semibold ${profitClass}`}>
            {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
          </div>
        </div>

        {/* Distance to SL/TP */}
        <div className="grid grid-cols-2 gap-2">
          {/* Stop Loss Distance */}
          {position.stopLoss && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2">
              <div className="text-xs text-gray-400 mb-1">Distance to SL</div>
              <div className="text-sm font-semibold text-yellow-400">
                ${distanceToSL?.toFixed(2)}
              </div>
              <div className="text-xs text-gray-500">
                @ ${position.stopLoss.toFixed(2)}
              </div>
            </div>
          )}

          {/* Take Profit Distance */}
          {position.takeProfit && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
              <div className="text-xs text-gray-400 mb-1">Distance to TP</div>
              <div className="text-sm font-semibold text-blue-400">
                ${distanceToTP?.toFixed(2)}
              </div>
              <div className="text-xs text-gray-500">
                @ ${position.takeProfit.toFixed(2)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contract Info */}
      <div className="mt-3 text-xs text-gray-500 text-center border-t border-gray-700/50 pt-2">
        {position.contractId} • Tick: ${TICK_VALUE} • Size: {TICK_SIZE}
      </div>
    </div>
  );
}
