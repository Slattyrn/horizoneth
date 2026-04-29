import { useRef, useEffect, useState } from 'react';
import { useTicker } from '../contexts/TickerContext';
import { TICKER_KEYS, TICKERS, TickerKey } from '../config/tickers';

// Single-ticker terminal — nothing greyed out.
const GREYED_OUT: ReadonlySet<TickerKey> = new Set([]);

interface TickerToggleProps {
  onBeforeSwitch?: (from: TickerKey, to: TickerKey) => void;
  disabled?: boolean;
  className?: string;
}

// Segmented control with an absolutely-positioned "glider" that slides under the
// active ticker. The glider re-measures its target on every render so font-size
// changes or container reflows don't leave it stranded.
export default function TickerToggle({ onBeforeSwitch, disabled, className = '' }: TickerToggleProps) {
  const { activeTicker, setActiveTicker } = useTicker();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Partial<Record<TickerKey, HTMLButtonElement | null>>>({});
  const [gliderStyle, setGliderStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useEffect(() => {
    const btn = buttonRefs.current[activeTicker];
    const container = containerRef.current;
    if (!btn || !container) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setGliderStyle({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  }, [activeTicker]);

  return (
    <div
      ref={containerRef}
      className={`
        relative flex items-center gap-0 p-1
        bg-black/40 rounded-lg border border-white/10
        backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]
        ${className}
      `}
      title={disabled ? 'Ticker locked — disable automation to switch' : 'Switch active ticker'}
    >
      {/* Sliding glider backdrop for the active button */}
      <div
        className="absolute top-1 bottom-1 rounded-md bg-gradient-to-b from-blue-500/90 to-blue-600/90 shadow-[0_0_12px_rgba(59,130,246,0.5)] transition-all duration-300 ease-[cubic-bezier(0.4,0.0,0.2,1)] pointer-events-none"
        style={{
          left: `${gliderStyle.left}px`,
          width: `${gliderStyle.width}px`,
          opacity: gliderStyle.width > 0 ? 1 : 0,
        }}
      />

      {TICKER_KEYS.map((key) => {
        const isActive = key === activeTicker;
        const isGreyedOut = GREYED_OUT.has(key);
        const isDisabled = disabled || isGreyedOut;
        const cfg = TICKERS[key];
        return (
          <button
            key={key}
            ref={(el) => { buttonRefs.current[key] = el; }}
            disabled={isDisabled}
            onClick={() => {
              if (isActive || isDisabled) return;
              onBeforeSwitch?.(activeTicker, key);
              setActiveTicker(key);
            }}
            className={`
              relative z-10 px-3 py-1.5 text-[11px] font-mono font-bold tracking-wider
              rounded-md transition-colors duration-200 ease-out select-none
              ${isActive && !isGreyedOut
                ? 'text-white'
                : 'text-gray-500'}
              ${isGreyedOut
                ? 'opacity-25 cursor-not-allowed grayscale'
                : disabled && !isActive
                  ? 'opacity-40 cursor-not-allowed'
                  : isActive
                    ? 'cursor-default'
                    : 'hover:text-gray-200 cursor-pointer'}
            `}
            title={isGreyedOut ? `${key} — disabled` : `${key} · ${cfg.displayName} (${cfg.exchange}) · tick ${cfg.tickSize} / $${cfg.tickValue}`}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
