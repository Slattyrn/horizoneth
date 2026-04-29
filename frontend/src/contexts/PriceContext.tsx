// FIXED: Was using useRef which never triggers re-renders — consumers always got null
import { createContext, useContext, useState, useCallback, useRef } from 'react';

interface PriceContextType {
  currentPrice: number | null;
  setPrice: (price: number) => void;
  getPriceRef: () => number | null;
}

const PriceContext = createContext<PriceContextType | null>(null);

export function PriceProvider({ children }: { children: React.ReactNode }) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const priceRef = useRef<number | null>(null);

  const setPrice = useCallback((price: number) => {
    priceRef.current = price;
    setCurrentPrice(price);
  }, []);

  const getPriceRef = useCallback(() => priceRef.current, []);

  return (
    <PriceContext.Provider value={{ currentPrice, setPrice, getPriceRef }}>
      {children}
    </PriceContext.Provider>
  );
}

export function usePrice() {
  const context = useContext(PriceContext);
  if (!context) {
    throw new Error('usePrice must be used within PriceProvider');
  }
  return context;
}

// Hook to get price ref directly without re-renders
export function usePriceRef() {
  const context = useContext(PriceContext);
  if (!context) {
    throw new Error('usePriceRef must be used within PriceProvider');
  }
  // FIXED: Return getPriceRef which reads from ref (no re-render on every tick)
  return context.getPriceRef;
}
