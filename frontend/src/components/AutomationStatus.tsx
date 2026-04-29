import React, { useEffect, useState } from 'react';
import {
  Activity, CheckCircle, Clock, TrendingUp, AlertCircle, XCircle,
  ArrowRight, DollarSign, Target, Shield, Zap
} from 'lucide-react';
import { AutomationState, AutomationContext, AutomationStats, AutomationLog } from '../hooks/useAutomation';

/**
 * =============================================================================
 * AUTOMATION STATUS DISPLAY
 * =============================================================================
 *
 * Real-time visualization of automation engine state:
 * - Current state with visual progress indicator
 * - Sequence progress (stage completion)
 * - Next expected event
 * - Last action taken with timestamp
 * - Trade statistics (win rate, P&L, etc.)
 * - Active trade monitoring (if position is open)
 *
 * Updates in real-time as the state machine progresses.
 * =============================================================================
 */

interface AutomationStatusProps {
  context: AutomationContext;
  stats: AutomationStats;
  logs?: AutomationLog[];
  enabled: boolean;
  dryRunMode?: boolean;
  className?: string;
}

// State display configuration
const STATE_CONFIG: Record<AutomationState, {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ComponentType<any>;
  description: string;
}> = {
  [AutomationState.IDLE]: {
    label: 'Idle',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20',
    icon: Clock,
    description: 'Waiting for activation'
  },
  [AutomationState.WAITING_ZONE_BREAK]: {
    label: 'Waiting for Zone Break',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    icon: Target,
    description: 'Monitoring price for zone breakout'
  },
  [AutomationState.ZONE_BROKEN]: {
    label: 'Zone Broken',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: CheckCircle,
    description: 'Zone break detected, proceeding to volume check'
  },
  [AutomationState.CONFIRMING_VOLUME]: {
    label: 'Confirming Volume',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    icon: Activity,
    description: 'Waiting for volume confirmation candles'
  },
  [AutomationState.VOLUME_CONFIRMED]: {
    label: 'Volume Confirmed',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: CheckCircle,
    description: 'Volume confirmed, waiting for FVG'
  },
  [AutomationState.WAITING_FVG]: {
    label: 'Waiting for FVG',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    icon: Target,
    description: 'Monitoring for Fair Value Gap formation'
  },
  [AutomationState.FVG_DETECTED]: {
    label: 'FVG Detected',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: CheckCircle,
    description: 'FVG detected, calculating position size'
  },
  [AutomationState.CALCULATING_SIZE]: {
    label: 'Calculating Position',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    icon: DollarSign,
    description: 'Computing optimal position size and prices'
  },
  [AutomationState.PLACING_ORDER]: {
    label: 'Placing Order',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    icon: Zap,
    description: 'Submitting order to broker'
  },
  [AutomationState.ORDER_ACTIVE]: {
    label: 'Order Active',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
    icon: Clock,
    description: 'Waiting for order fill'
  },
  [AutomationState.MANAGING_POSITION]: {
    label: 'Managing Position',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: Shield,
    description: 'Position active, monitoring trailing stop'
  },
  [AutomationState.TRADE_COMPLETE]: {
    label: 'Trade Complete',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: CheckCircle,
    description: 'Trade closed, ready for next signal'
  },
  [AutomationState.ERROR]: {
    label: 'Error',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    icon: XCircle,
    description: 'Error occurred, automation paused'
  }
};

// Calculate sequence progress (0-100%)
// Uses weighted progress to handle skipped states (e.g., initial zone scan skips WAITING_ZONE_BREAK)
const getSequenceProgress = (state: AutomationState, context: AutomationContext): number => {
  // Weighted progress based on major milestones (not linear)
  const stateWeights: Record<AutomationState, number> = {
    [AutomationState.IDLE]: 0,
    [AutomationState.WAITING_ZONE_BREAK]: 5,
    [AutomationState.ZONE_BROKEN]: 20,
    [AutomationState.CONFIRMING_VOLUME]: 25,  // Same as ZONE_BROKEN (for initial scan skip)
    [AutomationState.VOLUME_CONFIRMED]: 35,
    [AutomationState.WAITING_FVG]: 40,
    [AutomationState.FVG_DETECTED]: 50,
    [AutomationState.CALCULATING_SIZE]: 60,
    [AutomationState.PLACING_ORDER]: 70,
    [AutomationState.ORDER_ACTIVE]: 80,
    [AutomationState.MANAGING_POSITION]: 90,
    [AutomationState.TRADE_COMPLETE]: 100,
    [AutomationState.ERROR]: 0,
  };

  return stateWeights[state] ?? 0;
};

export default function AutomationStatus({
  context,
  stats,
  logs = [],
  enabled,
  dryRunMode = false,
  className = ''
}: AutomationStatusProps) {
  const [elapsedTime, setElapsedTime] = useState<string>('0s');
  const stateConfig = STATE_CONFIG[context.state];
  const StateIcon = stateConfig.icon;
  const progress = getSequenceProgress(context.state, context);

  // Update elapsed time
  // 🚨 PERFORMANCE FIX #3: Update every 5 seconds instead of 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      if (context.lastActionTime) {
        const elapsed = Math.floor((Date.now() - context.lastActionTime) / 1000);
        if (elapsed < 60) {
          setElapsedTime(`${elapsed}s`);
        } else if (elapsed < 3600) {
          setElapsedTime(`${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
        } else {
          setElapsedTime(`${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`);
        }
      }
    }, 5000); // Reduced from 1000ms to 5000ms to prevent screen blanking

    return () => clearInterval(interval);
  }, [context.lastActionTime]);

  // Format timestamp
  const formatTime = (timestamp: number | null): string => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
  };

  return (
    <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-5 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${stateConfig.bgColor} flex items-center justify-center`}>
            <StateIcon className={stateConfig.color} size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Automation Status</h3>
            <p className="text-xs text-gray-400">Real-time state monitoring</p>
          </div>
        </div>

        {/* Enabled Status Indicator */}
        <div className={`px-3 py-1.5 rounded-lg flex items-center gap-2 ${
          enabled
            ? 'bg-green-500/20 border border-green-500/30'
            : 'bg-gray-700/30 border border-gray-600'
        }`}>
          <div className={`w-2 h-2 rounded-full ${enabled ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
          <span className={`font-semibold text-sm ${enabled ? 'text-green-400' : 'text-gray-400'}`}>
            {enabled ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>
      </div>

      {/* Dry Run Mode Warning Banner */}
      {dryRunMode && (
        <div className="mb-5 p-4 rounded-lg bg-orange-500/20 border-2 border-orange-500/50 animate-pulse">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-orange-400 flex-shrink-0" size={24} />
            <div>
              <p className="text-orange-400 font-bold text-sm uppercase tracking-wide">
                DRY RUN MODE ACTIVE
              </p>
              <p className="text-orange-300/80 text-xs mt-1">
                No real orders will be placed. Disable in Automation Config to trade live.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Current State Display */}
      <div className="mb-5 p-4 rounded-lg bg-gray-800/30 border border-gray-700/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <StateIcon className={`${stateConfig.color} animate-pulse`} size={24} />
            <div>
              <h4 className={`font-bold text-base ${stateConfig.color}`}>{stateConfig.label}</h4>
              <p className="text-xs text-gray-400">{stateConfig.description}</p>
            </div>
          </div>
          {context.lastActionTime && (
            <div className="text-right">
              <div className="text-xs text-gray-500">Elapsed</div>
              <div className="text-sm font-semibold text-white">{elapsedTime}</div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Sequence Progress</span>
            <span className="text-xs font-semibold text-white">{progress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${stateConfig.bgColor.replace('/20', '/60')} transition-all duration-500 ease-out`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Context Details */}
      {enabled && (
        <div className="space-y-3 mb-5">
          {/* Direction */}
          {context.direction && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-800/20 border border-gray-700/30">
              <span className="text-sm text-gray-400">Direction</span>
              <span className={`font-semibold text-sm ${
                context.direction === 'bullish' ? 'text-green-400' : 'text-red-400'
              }`}>
                {context.direction === 'bullish' ? '↑ BULLISH' : '↓ BEARISH'}
              </span>
            </div>
          )}

          {/* Zone Break */}
          {context.zoneBreakPrice && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-800/20 border border-gray-700/30">
              <span className="text-sm text-gray-400">Zone Break Price</span>
              <span className="font-semibold text-sm text-white">
                ${context.zoneBreakPrice.toFixed(2)} @ {formatTime(context.zoneBreakTime)}
              </span>
            </div>
          )}

          {/* Volume Confirmation Progress */}
          {context.state === AutomationState.CONFIRMING_VOLUME && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-800/20 border border-gray-700/30">
              <span className="text-sm text-gray-400">Volume Confirmation</span>
              <span className="font-semibold text-sm text-yellow-400">
                Waiting for volume spike...
              </span>
            </div>
          )}

          {/* FVG Detection */}
          {context.detectedFVG && (
            <div className="p-3 rounded-lg bg-gray-800/20 border border-gray-700/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">FVG Detected</span>
                <span className={`font-semibold text-sm ${
                  context.detectedFVG.type === 'bullish' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {context.detectedFVG.type.toUpperCase()}
                </span>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <div>Top: ${context.detectedFVG.top.toFixed(2)}</div>
                <div>Bottom: ${context.detectedFVG.bottom.toFixed(2)}</div>
                <div>Entry: ${context.detectedFVG.entry.toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* Position Calculation */}
          {context.calculatedEntry && (
            <div className="p-3 rounded-lg bg-gray-800/20 border border-gray-700/30">
              <div className="text-sm text-gray-400 mb-2">Calculated Prices</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-gray-500">Entry</div>
                  <div className="text-white font-semibold">${context.calculatedEntry.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Contracts</div>
                  <div className="text-white font-semibold">{context.calculatedContracts}</div>
                </div>
                <div>
                  <div className="text-gray-500">Stop Loss</div>
                  <div className="text-yellow-400 font-semibold">${context.calculatedStopLoss?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Take Profit</div>
                  <div className="text-blue-400 font-semibold">${context.calculatedTakeProfit?.toFixed(2)}</div>
                </div>
                {context.riskRewardRatio && (
                  <div className="col-span-2">
                    <div className="text-gray-500">Risk:Reward Ratio</div>
                    <div className="text-green-400 font-semibold">1:{context.riskRewardRatio}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Active Position */}
          {context.entryPrice && context.state === AutomationState.MANAGING_POSITION && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="text-green-400" size={16} />
                <span className="text-sm font-semibold text-green-400">POSITION ACTIVE</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-gray-500">Entry Price</div>
                  <div className="text-white font-semibold">${context.entryPrice.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Fill Time</div>
                  <div className="text-white font-semibold">{formatTime(context.fillTime)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Current Stop</div>
                  <div className="text-yellow-400 font-semibold">${context.currentStopLoss?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Breakeven</div>
                  <div className={`font-semibold ${context.breakEvenMoved ? 'text-green-400' : 'text-gray-400'}`}>
                    {context.breakEvenMoved ? 'MOVED' : 'PENDING'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {context.error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="text-red-400" size={16} />
                <span className="text-sm font-semibold text-red-400">ERROR</span>
              </div>
              <p className="text-xs text-gray-300">{context.error}</p>
            </div>
          )}
        </div>
      )}

      {/* Statistics Panel */}
      <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/50">
        <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-blue-400" />
          Trade Statistics
        </h4>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded bg-gray-700/30">
            <div className="text-xs text-gray-400">Today's Trades</div>
            <div className="text-lg font-bold text-white">{stats.todayTrades}</div>
          </div>
          <div className="p-2 rounded bg-gray-700/30">
            <div className="text-xs text-gray-400">Today's P&L</div>
            <div className={`text-lg font-bold ${
              stats.todayPnL >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              ${stats.todayPnL.toFixed(2)}
            </div>
          </div>
          <div className="p-2 rounded bg-gray-700/30">
            <div className="text-xs text-gray-400">Total Trades</div>
            <div className="text-lg font-bold text-white">{stats.totalTrades}</div>
          </div>
          <div className="p-2 rounded bg-gray-700/30">
            <div className="text-xs text-gray-400">Win Rate</div>
            <div className="text-lg font-bold text-blue-400">{stats.winRate.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Logs Panel */}
      {logs.length > 0 && (
        <div className="mt-5 p-4 rounded-lg bg-gray-800/30 border border-gray-700/50">
          <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Activity size={16} className="text-blue-400" />
            Recent Activity
          </h4>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {logs.slice(-10).reverse().map((logEntry, idx) => {
              const emoji = logEntry.level === 'error' ? '❌' :
                           logEntry.level === 'success' ? '✅' :
                           logEntry.level === 'warning' ? '⚠️' : '📋';
              const color = logEntry.level === 'error' ? 'text-red-400' :
                           logEntry.level === 'success' ? 'text-green-400' :
                           logEntry.level === 'warning' ? 'text-yellow-400' :
                           'text-gray-400';

              return (
                <div key={idx} className="text-xs p-2 rounded bg-gray-700/20 border border-gray-700/30">
                  <div className="flex items-center gap-2">
                    <span>{emoji}</span>
                    <span className={`${color} font-medium`}>{logEntry.action}</span>
                    <span className="text-gray-500 ml-auto text-[10px]">
                      {new Date(logEntry.timestamp).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
