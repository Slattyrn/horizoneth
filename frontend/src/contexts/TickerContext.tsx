import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { TickerKey, TickerConfig, TICKERS, isTickerKey } from '../config/tickers';

interface TickerContextValue {
  activeTicker: TickerKey;
  activeConfig: TickerConfig;
  setActiveTicker: (ticker: TickerKey) => void;
}

const TickerContext = createContext<TickerContextValue | undefined>(undefined);

const STORAGE_KEY = 'activeTicker';

export function TickerProvider({ children }: { children: ReactNode }) {
  const [activeTicker, setActiveTickerState] = useState<TickerKey>('MGC');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, activeTicker);
    } catch {
      // ignore
    }
  }, [activeTicker]);

  const setActiveTicker = useCallback((ticker: TickerKey) => {
    setActiveTickerState(ticker);
  }, []);

  const value: TickerContextValue = {
    activeTicker,
    activeConfig: TICKERS[activeTicker],
    setActiveTicker,
  };

  return <TickerContext.Provider value={value}>{children}</TickerContext.Provider>;
}

export function useTicker(): TickerContextValue {
  const ctx = useContext(TickerContext);
  if (!ctx) throw new Error('useTicker must be used within <TickerProvider>');
  return ctx;
}
