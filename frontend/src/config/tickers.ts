export type TickerKey = 'ES';

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
  ES: {
    key: 'ES',
    contract: 'CON.F.US.EP.M26',
    displayName: 'E-mini S&P 500',
    exchange: 'CME',
    tickSize: 0.25,
    tickValue: 12.50,
    priceDecimals: 2,
    dollarsPerPoint: 50.0,
  },
};

export const TICKER_KEYS: TickerKey[] = ['ES'];

export function getTickerConfig(key: TickerKey): TickerConfig {
  return TICKERS[key];
}

export function isTickerKey(value: unknown): value is TickerKey {
  return value === 'ES';
}
