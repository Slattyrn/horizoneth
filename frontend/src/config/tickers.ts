export type TickerKey = 'MGC';

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
  MGC: {
    key: 'MGC',
    contract: 'CON.F.US.MGC.M26',
    displayName: 'Micro Gold',
    exchange: 'CME',
    tickSize: 0.10,
    tickValue: 1.00,
    priceDecimals: 1,
    dollarsPerPoint: 10.0,
  },
};

export const TICKER_KEYS: TickerKey[] = ['MGC'];

export function getTickerConfig(key: TickerKey): TickerConfig {
  return TICKERS[key];
}

export function isTickerKey(value: unknown): value is TickerKey {
  return value === 'MGC';
}
