import { useState, useEffect, useRef } from 'react';
import { Play, Square, Activity, CheckCircle2, Clock, AlertTriangle, XCircle, Target, TrendingUp, TrendingDown, Minus, Zap, Moon, Loader2 } from 'lucide-react';
import { useTicker } from '../contexts/TickerContext';

/**
 * Automation Control Panel
 * Wave Reclaim Engine dashboard — polls window.__waveEngine every 2 s.
 */

interface AutomationControlPanelProps {
  automationEnabled: boolean;
  onAutomationToggle: (enabled: boolean) => void;
  enabledEdges: { wave: boolean; manual: boolean };
  onEdgesChange?: (edges: { wave: boolean; manual: boolean }) => void;
  onCancelAllOrders?: () => void;
  testMode?: boolean;
  onTestModeChange?: (v: boolean) => void;
  className?: string;
}

interface WaveSnapshot {
  state: string;
  stateLabel: string;
  side: number;
  logs: string[];
  lastEntry: number;
  lastSL: number;
  lastTP: number;
  doneSess: boolean;
  dailyPnL: number;
  dailyPnLSource: 'broker' | 'hypothetical';
  dailyLockReason: string;
}

const STATE_LABELS: Record<string, string> = {
  IDLE: 'Scanning for setup',
  PB_WAIT: 'Pullback staged — awaiting reclaim',
  IN_TRADE: 'Position active',
  DONE: 'Session complete — engine locked',
};

function getSessionStatus(testMode: boolean): { label: string; color: string } {
  if (testMode) return { label: 'TEST MODE', color: 'text-amber-300' };
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins < 9 * 60 + 25) return { label: 'PRE-MARKET', color: 'text-gray-500' };
  if (mins < 9 * 60 + 30) return { label: 'SCANNING', color: 'text-amber-300' };
  if (mins < 16 * 60 + 30) return { label: 'LIVE', color: 'text-emerald-300' };
  return { label: 'CLOSED', color: 'text-gray-500' };
}

function getStateVisual(state: string): { icon: JSX.Element; dot: string; label: string } {
  switch (state) {
    case 'IDLE':
      return { icon: <Clock className="w-4 h-4" />, dot: 'bg-gray-400', label: 'text-gray-300' };
    case 'PB_WAIT':
      return { icon: <Target className="w-4 h-4" />, dot: 'bg-orange-400 animate-pulse', label: 'text-orange-200' };
    case 'IN_TRADE':
      return { icon: <Zap className="w-4 h-4" />, dot: 'bg-emerald-400 animate-pulse', label: 'text-emerald-200' };
    case 'DONE':
      return { icon: <CheckCircle2 className="w-4 h-4" />, dot: 'bg-gray-500', label: 'text-gray-400' };
    default:
      return { icon: <AlertTriangle className="w-4 h-4" />, dot: 'bg-yellow-400', label: 'text-yellow-200' };
  }
}

function getSideDisplay(side: number): { label: string; icon: JSX.Element; color: string; bg: string } {
  if (side === 1) return { label: 'LONG',  icon: <TrendingUp className="w-3.5 h-3.5" />,   color: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/30' };
  if (side === -1) return { label: 'SHORT', icon: <TrendingDown className="w-3.5 h-3.5" />, color: 'text-red-300',     bg: 'bg-red-500/10 border-red-500/30' };
  return { label: '—', icon: <Minus className="w-3.5 h-3.5" />, color: 'text-gray-500', bg: 'bg-white/[0.03] border-white/5' };
}

function classifyLog(log: string): string {
  if (log.includes('ENTRY') || log.includes('TP HIT') || log.includes('confirmed') || log.includes('RECLAIM')) return 'text-emerald-300';
  if (log.includes('RESET') || log.includes('timeout') || log.includes('flip') || log.includes('cancel') || log.includes('staged')) return 'text-amber-300';
  if (log.includes('SL HIT') || log.includes('ERROR')) return 'text-red-300';
  return 'text-gray-400';
}

export default function AutomationControlPanel({
  automationEnabled,
  onAutomationToggle,
  enabledEdges,
  onEdgesChange,
  onCancelAllOrders,
  testMode = false,
  onTestModeChange,
  className = '',
}: AutomationControlPanelProps) {
  const { activeConfig } = useTicker();
  const priceDecimals = activeConfig.priceDecimals;

  const [snap, setSnap] = useState<WaveSnapshot>({
    state: 'IDLE', stateLabel: 'Scanning for setup', side: 0, logs: [],
    lastEntry: 0, lastSL: 0, lastTP: 0, doneSess: false,
    dailyPnL: 0, dailyPnLSource: 'hypothetical', dailyLockReason: '',
  });
  const [session, setSession] = useState(() => getSessionStatus(testMode));
  const [canceling, setCanceling] = useState(false);
  const logScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = () => {
      try {
        const we = (window as any).__waveEngine;
        if (we) {
          const nextLogs = Array.isArray(we.logs) ? we.logs.slice(-50) : null;
          setSnap(prev => ({
            state: we.state ?? 'IDLE',
            stateLabel: we.stateLabel ?? prev.stateLabel,
            side: we.side ?? 0,
            // Preserve the previous logs array if the engine briefly exposes none
            // (e.g. during a hot-reload of the engine effect) — keeps the panel
            // visible instead of flashing empty.
            logs: nextLogs && nextLogs.length > 0 ? nextLogs : prev.logs,
            lastEntry: we.lastEntry ?? 0,
            lastSL: we.lastSL ?? 0,
            lastTP: we.lastTP ?? 0,
            doneSess: we.doneSess ?? false,
            dailyPnL: we.dailyPnL ?? 0,
            dailyPnLSource: we.dailyPnLSource ?? 'hypothetical',
            dailyLockReason: we.dailyLockReason ?? '',
          }));
        }
      } catch { /* skip */ }
      setSession(getSessionStatus(testMode));
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [testMode]);

  // Sticky-bottom scroll: only auto-scroll when the user is already pinned to the
  // bottom. If they've scrolled up to read history, leave the scroll position alone.
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [snap.logs]);

  const displayState = snap.doneSess && snap.state !== 'IN_TRADE' ? 'DONE' : snap.state;
  const stateVisual = getStateVisual(displayState);
  const sideInfo = getSideDisplay(snap.state === 'IDLE' || snap.state === 'DONE' ? 0 : snap.side);
  const showLevels = ['PB_WAIT', 'IN_TRADE'].includes(snap.state) && snap.lastEntry > 0;

  return (
    <div
      className={`rounded-2xl overflow-hidden ${className}`}
      style={{
        background: 'linear-gradient(180deg, rgba(18,21,26,0.95) 0%, rgba(12,14,18,0.95) 100%)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Activity size={18} className={automationEnabled ? 'text-emerald-300' : 'text-gray-500'} />
            {automationEnabled && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            )}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-white tracking-tight leading-tight">Automation</div>
            <div className="text-[10px] text-gray-500 font-mono tracking-wider uppercase leading-tight">Wave Reclaim</div>
          </div>
        </div>
        <div className={`text-[10px] font-mono font-semibold tracking-wider px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05] ${session.color}`}>
          {session.label}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-3">
        {/* Primary START / STOP */}
        <button
          onClick={() => {
            const next = !automationEnabled;
            if (next && onEdgesChange && !enabledEdges.wave) {
              onEdgesChange({ ...enabledEdges, wave: true });
            }
            onAutomationToggle(next);
          }}
          className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 tracking-wide group"
          style={
            automationEnabled
              ? {
                  background: 'linear-gradient(180deg, #dc2626 0%, #991b1b 100%)',
                  boxShadow: '0 4px 14px rgba(220,38,38,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
                  color: 'white',
                }
              : {
                  background: 'linear-gradient(180deg, #10b981 0%, #059669 100%)',
                  boxShadow: '0 4px 14px rgba(16,185,129,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
                  color: 'white',
                }
          }
        >
          {automationEnabled ? (
            <><Square size={14} fill="currentColor" className="transition-transform group-active:scale-90" /> STOP AUTOMATION</>
          ) : (
            <><Play size={14} fill="currentColor" className="transition-transform group-active:scale-90" /> START AUTOMATION</>
          )}
        </button>

        {/* Toggles */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onEdgesChange && onEdgesChange({ ...enabledEdges, wave: !enabledEdges.wave })}
            className={`h-9 rounded-lg text-[11px] font-semibold tracking-wide border transition-all flex items-center justify-center gap-1.5 ${
              enabledEdges.wave
                ? 'bg-cyan-500/[0.08] border-cyan-400/30 text-cyan-200 hover:bg-cyan-500/[0.12]'
                : 'bg-white/[0.02] border-white/[0.06] text-gray-500 hover:text-gray-300 hover:border-white/10'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${enabledEdges.wave ? 'bg-cyan-300 shadow-[0_0_6px_rgba(103,232,249,0.8)] animate-pulse' : 'bg-gray-600'}`} />
            WAVE {enabledEdges.wave ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => onTestModeChange && onTestModeChange(!testMode)}
            className={`h-9 rounded-lg text-[11px] font-semibold tracking-wide border transition-all flex items-center justify-center gap-1.5 ${
              testMode
                ? 'bg-amber-500/[0.08] border-amber-400/30 text-amber-200 hover:bg-amber-500/[0.12]'
                : 'bg-white/[0.02] border-white/[0.06] text-gray-500 hover:text-gray-300 hover:border-white/10'
            }`}
          >
            {testMode ? <Moon size={11} /> : <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />}
            TEST MODE {testMode ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Cancel all */}
        {onCancelAllOrders && (
          <button
            onClick={async () => {
              if (!window.confirm('Cancel all pending orders?')) return;
              setCanceling(true);
              try { await onCancelAllOrders(); } finally { setCanceling(false); }
            }}
            disabled={canceling}
            className="w-full h-9 rounded-lg text-[11px] font-semibold tracking-wide flex items-center justify-center gap-1.5 bg-white/[0.02] hover:bg-orange-500/[0.08] text-gray-500 hover:text-orange-300 border border-white/[0.06] hover:border-orange-400/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {canceling ? (
              <><Loader2 size={12} className="animate-spin" /> CANCELING…</>
            ) : (
              <><XCircle size={12} /> CANCEL ALL ORDERS</>
            )}
          </button>
        )}

        {/* Engine live state */}
        {automationEnabled && enabledEdges.wave && (
          <div className="pt-1 space-y-2">
            {/* State row */}
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${stateVisual.dot}`} />
                <div className="min-w-0">
                  <div className="text-[9px] font-mono tracking-widest text-gray-500 uppercase leading-tight">State</div>
                  <div className={`text-xs font-medium truncate leading-tight mt-0.5 ${stateVisual.label}`}>
                    {snap.state === displayState ? snap.stateLabel : (STATE_LABELS[displayState] ?? displayState)}
                  </div>
                </div>
              </div>
              <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md border ${sideInfo.bg} ${sideInfo.color}`}>
                {sideInfo.icon}
                {sideInfo.label}
              </div>
            </div>

            {/* Levels */}
            {showLevels && (
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'Entry', value: snap.lastEntry, color: 'text-white',         accent: 'text-gray-500' },
                  { label: 'SL',    value: snap.lastSL,    color: 'text-red-200',       accent: 'text-red-400/80' },
                  { label: 'TP',    value: snap.lastTP,    color: 'text-emerald-200',   accent: 'text-emerald-400/80' },
                ].map(l => (
                  <div key={l.label} className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-2 py-2 text-center">
                    <div className={`text-[9px] font-mono uppercase tracking-widest ${l.accent}`}>{l.label}</div>
                    <div className={`text-[13px] font-mono font-semibold mt-0.5 ${l.color}`}>{l.value.toFixed(priceDecimals)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Daily P&L */}
            <div className="rounded-xl bg-white/[0.025] border border-white/[0.05] p-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono tracking-widest text-gray-500 uppercase">Daily P&L</span>
                  <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded tracking-widest ${
                    snap.dailyPnLSource === 'broker'
                      ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                      : 'bg-white/[0.04] text-gray-500 border border-white/[0.06]'
                  }`}>
                    {snap.dailyPnLSource === 'broker' ? 'LIVE' : 'HYP'}
                  </span>
                </div>
                <div className={`text-base font-mono font-bold tracking-tight ${snap.dailyPnL >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {snap.dailyPnL >= 0 ? '+' : ''}${snap.dailyPnL.toFixed(2)}
                </div>
              </div>
              {/* Limit bar */}
              <div className="relative h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                {(() => {
                  const stopVal = 550;
                  const targetVal = 400;
                  const total = stopVal + targetVal;
                  const midPct = (stopVal / total) * 100;
                  const pnl = snap.dailyPnL;
                  const clampedPnl = Math.max(-stopVal, Math.min(targetVal, pnl));
                  const pct = midPct + (clampedPnl / total) * 100;
                  const barColor = pnl >= 0 ? 'bg-emerald-400' : 'bg-red-400';
                  const left = pnl >= 0 ? midPct : pct;
                  const width = Math.abs(pct - midPct);
                  return (
                    <>
                      <div className="absolute top-0 bottom-0 w-px bg-gray-500/60" style={{ left: `${midPct}%` }} />
                      <div className={`absolute top-0 bottom-0 ${barColor} rounded-full transition-all duration-300`} style={{ left: `${left}%`, width: `${width}%` }} />
                    </>
                  );
                })()}
              </div>
              <div className="flex justify-between text-[9px] font-mono mt-1.5 tracking-wider">
                <span className="text-red-400/70">-$550</span>
                <span className="text-gray-600">$0</span>
                <span className="text-emerald-400/70">+$400</span>
              </div>
              {snap.doneSess && snap.dailyLockReason && (
                <div className="mt-2.5 text-[10px] text-amber-300 font-medium text-center tracking-wide">
                  {snap.dailyLockReason}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Logs */}
        {automationEnabled && (
          <div className="pt-1">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[9px] font-mono tracking-widest text-gray-500 uppercase">Execution Log</span>
              <span className="text-[9px] text-gray-600 font-mono">({snap.logs.length})</span>
            </div>
            <div
              ref={logScrollRef}
              className="rounded-lg bg-black/40 border border-white/[0.04] p-2.5 max-h-48 overflow-y-auto"
            >
              {snap.logs.length === 0 ? (
                <div className="font-mono text-[10.5px] leading-snug text-gray-600 italic">
                  Waiting for first engine log…
                </div>
              ) : (
                <div className="space-y-0.5 font-mono text-[10.5px] leading-snug">
                  {snap.logs.map((log, i) => (
                    // Composite key: content is stable across polls so React reuses
                    // the same DOM node for the same log line (kills the flicker);
                    // index suffix disambiguates if two identical lines ever emit.
                    <div key={`${log}|${i}`} className={classifyLog(log)}>{log}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!automationEnabled && (
          <div className="rounded-xl bg-white/[0.015] border border-dashed border-white/[0.08] p-5 text-center">
            <div className="text-xs text-gray-500 leading-relaxed">
              Press <span className="font-semibold text-emerald-300">START AUTOMATION</span> to begin scanning.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
