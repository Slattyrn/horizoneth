// chartBroadcast.ts - Cross-window communication for detachable charts
// Uses BroadcastChannel API to share tick data between windows

type TickData = {
  symbol?: string;
  ticker?: string;
  price?: number;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  timestamp?: number;
  type?: string;
  volume?: number;
  tradeVolume?: number;
  cumulativeVolume?: number;
};

type ChartMessage = {
  type: 'tick' | 'zone_update' | 'sync_request' | 'sync_response' | 'order_request';
  data: any;
  timestamp: number;
};

class ChartBroadcastManager {
  private channel: BroadcastChannel | null = null;
  private handlers: Set<(data: TickData) => void> = new Set();
  private zoneHandlers: Set<(zones: any) => void> = new Set();
  private orderHandlers: Set<(order: any) => void> = new Set();
  private latestZones: any = null;

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('horizon-chart-data');
      this.channel.onmessage = this.handleMessage.bind(this);
      console.log('📡 ChartBroadcast: Channel initialized');
    }
  }

  private handleMessage(event: MessageEvent<ChartMessage>) {
    const { type, data } = event.data;

    switch (type) {
      case 'tick':
        this.handlers.forEach(handler => {
          try {
            handler(data);
          } catch (e) {
            console.error('ChartBroadcast handler error:', e);
          }
        });
        break;

      case 'zone_update':
        this.latestZones = data;
        this.zoneHandlers.forEach(handler => {
          try {
            handler(data);
          } catch (e) {
            console.error('ChartBroadcast zone handler error:', e);
          }
        });
        break;

      case 'sync_request':
        // Child window requesting sync - send latest zones
        if (this.latestZones) {
          this.broadcastZones(this.latestZones);
        }
        break;

      case 'order_request':
        this.orderHandlers.forEach(handler => {
          try {
            handler(data);
          } catch (e) {
            console.error('ChartBroadcast order handler error:', e);
          }
        });
        break;
    }
  }

  // Broadcast tick data to all windows
  broadcastTick(tick: TickData) {
    if (this.channel) {
      this.channel.postMessage({
        type: 'tick',
        data: tick,
        timestamp: Date.now()
      } as ChartMessage);
    }
  }

  // Broadcast zone updates to all windows
  broadcastZones(zones: any) {
    this.latestZones = zones;
    if (this.channel) {
      this.channel.postMessage({
        type: 'zone_update',
        data: zones,
        timestamp: Date.now()
      } as ChartMessage);
    }
  }

  // Request order execution from main window
  sendOrder(order: any) {
    if (this.channel) {
      this.channel.postMessage({
        type: 'order_request',
        data: order,
        timestamp: Date.now()
      } as ChartMessage);
    }
  }

  // Request sync from main window (for popout windows)
  requestSync() {
    if (this.channel) {
      this.channel.postMessage({
        type: 'sync_request',
        data: null,
        timestamp: Date.now()
      } as ChartMessage);
    }
  }

  // Subscribe to tick updates
  onTick(handler: (data: TickData) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  // Subscribe to zone updates
  onZoneUpdate(handler: (zones: any) => void): () => void {
    this.zoneHandlers.add(handler);
    return () => this.zoneHandlers.delete(handler);
  }

  // Subscribe to order requests (Main window only)
  onOrderRequest(handler: (order: any) => void): () => void {
    this.orderHandlers.add(handler);
    return () => this.orderHandlers.delete(handler);
  }

  // Get latest zones
  getLatestZones() {
    return this.latestZones;
  }

  // Cleanup
  destroy() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.handlers.clear();
    this.zoneHandlers.clear();
  }
}

// Singleton instance
export const chartBroadcast = new ChartBroadcastManager();

// Helper to check if we're in a popout window
export function isPopoutWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.search.includes('popout=true');
}

// Helper to get the timeframe from URL params
export function getPopoutTimeframe(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('timeframe');
}

// Helper to open a new popout chart window
export function openPopoutChart(timeframe: string = '5m'): Window | null {
  const width = 800;
  const height = 600;
  const left = window.screenX + 100;
  const top = window.screenY + 100;

  const url = `${window.location.origin}${window.location.pathname}?popout=true&timeframe=${timeframe}`;

  const popup = window.open(
    url,
    `chart_${timeframe}_${Date.now()}`,
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,status=no,menubar=no,toolbar=no`
  );

  return popup;
}
