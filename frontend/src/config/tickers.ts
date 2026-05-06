export type TickerKey = 'GC';

export interface TickerConfig {
  key: TickerKey;
  contract: string;
  displayName: string;
  exchange: string;
  tickSize: number;
  tickValue: number;
  priceDecimals: number;
  dollarsPerPoint: number;
}

export const TICKERS: Record<TickerKey, TickerConfig> = {
  GC: {
    key: 'GC',
    contract: 'CON.F.US.GC.M26',
    displayName: 'Gold',
    exchange: 'COMEX',
    tickSize: 0.10,
    tickValue: 10.00,
    priceDecimals: 1,
    dollarsPerPoint: 100.0,
  },
};

export const TICKER_KEYS: TickerKey[] = ['GC'];

export function getTickerConfig(key: TickerKey): TickerConfig {
  return TICKERS[key];
}

export function isTickerKey(value: unknown): value is TickerKey {
  return value === 'GC';
}
