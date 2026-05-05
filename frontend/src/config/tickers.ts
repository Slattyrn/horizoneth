export type TickerKey = 'ES' | 'MNQ';

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
  MNQ: {
    key: 'MNQ',
    contract: 'CON.F.US.MNQ.M26',
    displayName: 'Micro E-mini Nasdaq 100',
    exchange: 'CME',
    tickSize: 0.25,
    tickValue: 0.50,
    priceDecimals: 2,
    dollarsPerPoint: 2.0,
  },
};

export const TICKER_KEYS: TickerKey[] = ['ES', 'MNQ'];

export function getTickerConfig(key: TickerKey): TickerConfig {
  return TICKERS[key];
}

export function isTickerKey(value: unknown): value is TickerKey {
  return value === 'ES' || value === 'MNQ';
}
