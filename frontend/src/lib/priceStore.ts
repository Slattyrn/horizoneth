// Global price store using module-level ref
// This avoids React re-renders while providing live price access

export const priceStore = {
  current: null as number | null,
  listeners: new Set<() => void>(),
  
  setPrice(price: number) {
    this.current = price;
    // Notify listeners without causing React re-renders
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (e) {
        console.error('Price listener error:', e);
      }
    });
  },
  
  getPrice(): number | null {
    return this.current;
  },
  
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
};

// Hook for components that need price updates but don't want re-renders
export function usePriceStore() {
  return priceStore;
}
