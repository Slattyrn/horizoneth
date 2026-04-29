export function snapToTick(price: number, tickSize: number): number {
  if (!isFinite(price)) return price;
  return parseFloat((Math.round(price / tickSize) * tickSize).toFixed(4));
}

export function snapToTickOrUndefined(
  price: number | null | undefined,
  tickSize: number
): number | undefined {
  if (price === null || price === undefined || !isFinite(price)) return undefined;
  return snapToTick(price, tickSize);
}

export function isValidTick(price: number, tickSize: number): boolean {
  if (!isFinite(price) || tickSize <= 0) return false;
  const ticks = price / tickSize;
  const remainder = Math.abs(ticks - Math.round(ticks));
  return remainder < 0.01;
}

export function formatPrice(price: number, priceDecimals: number): string {
  if (!isFinite(price)) return '—';
  return price.toFixed(priceDecimals);
}
