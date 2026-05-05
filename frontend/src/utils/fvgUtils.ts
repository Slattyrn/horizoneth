import { CandleData } from '../hooks/useAutomation';

export interface FVGResult {
  stopLevel: number; // middle candle extreme ± 1 tick (the stop anchor)
  barIndex: number;  // index of c0 (newest candle of the triplet) in the candles array
  min: number;       // gap bottom: bull = c2.high, bear = c0.high
  max: number;       // gap top:   bull = c0.low,  bear = c2.low
}

/**
 * Scans the last `lookback` closed candles (excluding the live forming candle)
 * and returns an FVG matching `direction` according to `mode`:
 *
 *   'recent'  — most recent unmitigated FVG where stopLevel is on the correct
 *               side of anchorPrice. Skips FVGs whose stop has already crossed
 *               through current price (would be invalid before the trade even opens).
 *               Pass anchorPrice = currentPrice.
 *
 *   'nearest' — unmitigated FVG whose gap range (min..max) is nearest to or
 *               contains anchorPrice. Ignores recency; picks the structurally
 *               closest FVG to the intended entry. Pass anchorPrice = limitPrice.
 *
 * FVG detection (ported from LuxAlgo Pine Script):
 *   Bull FVG: candles[i].low > candles[i-2].high && candles[i-1].close > candles[i-2].high
 *   Bear FVG: candles[i].high < candles[i-2].low && candles[i-1].close < candles[i-2].low
 *
 * Mitigation:
 *   Bull: any subsequent close < fvg gap bottom (c2.high)
 *   Bear: any subsequent close > fvg gap top   (c2.low)
 *
 * Stop level: middle candle (c1) extreme ± 1 tick
 *   Bull: c1.low  - tickSize
 *   Bear: c1.high + tickSize
 *
 * @param candles      Oldest-first array. candles[length-1] is live/forming — excluded.
 * @param direction    'bull' for long entries, 'bear' for short entries.
 * @param lookback     Max closed candles to scan (default 100).
 * @param tickSize     Instrument tick size (default 0.25).
 * @param anchorPrice  Reference price: currentPrice for 'recent', limitPrice for 'nearest'.
 * @param mode         'recent' returns newest valid FVG; 'nearest' returns closest to anchorPrice.
 */
export function getMostRecentFVG(
  candles: CandleData[],
  direction: 'bull' | 'bear',
  lookback = 100,
  tickSize = 0.25,
  anchorPrice = 0,
  mode: 'recent' | 'nearest' = 'recent'
): FVGResult | null {
  const n = candles.length;
  const lastClosed = n - 2; // most recent *closed* candle index
  if (lastClosed < 2) return null;

  const scanStart = lastClosed;
  const scanEnd = Math.max(2, lastClosed - lookback + 1);

  // 'nearest' mode: collect best candidate across full scan
  let bestNearest: FVGResult | null = null;
  let bestDist = Infinity;

  for (let i = scanStart; i >= scanEnd; i--) {
    const c0 = candles[i];     // newest of triplet (pine [0])
    const c1 = candles[i - 1]; // middle candle     (pine [1])
    const c2 = candles[i - 2]; // oldest of triplet (pine [2])

    let isFVG = false;
    let fvgMin = 0; // gap bottom: bull = c2.high, bear = c0.high
    let fvgMax = 0; // gap top:   bull = c0.low,  bear = c2.low

    if (direction === 'bull') {
      isFVG = c0.low > c2.high && c1.close > c2.high;
      if (isFVG) { fvgMin = c2.high; fvgMax = c0.low; }
    } else {
      isFVG = c0.high < c2.low && c1.close < c2.low;
      if (isFVG) { fvgMin = c0.high; fvgMax = c2.low; }
    }

    if (!isFVG) continue;

    // Mitigation check
    let mitigated = false;
    for (let j = i + 1; j <= lastClosed; j++) {
      if (direction === 'bull' && candles[j].close < fvgMin) { mitigated = true; break; }
      if (direction === 'bear' && candles[j].close > fvgMax) { mitigated = true; break; }
    }
    if (mitigated) continue;

    const stopLevel = direction === 'bull'
      ? c1.low  - tickSize  // long stop below middle candle low
      : c1.high + tickSize; // short stop above middle candle high

    const result: FVGResult = { stopLevel, barIndex: i, min: fvgMin, max: fvgMax };

    if (mode === 'recent') {
      // Skip FVGs whose stop has already crossed through current price —
      // that stop would be invalid the moment the order opens.
      if (anchorPrice > 0) {
        const stopPastPrice = direction === 'bull'
          ? stopLevel >= anchorPrice  // long stop at/above market = already through price
          : stopLevel <= anchorPrice; // short stop at/below market = already through price
        if (stopPastPrice) continue;
      }
      return result; // first (newest) valid FVG
    } else {
      // 'nearest': distance from anchorPrice to FVG gap range (0 if price is inside gap)
      const dist = anchorPrice < fvgMin
        ? fvgMin - anchorPrice
        : anchorPrice > fvgMax
          ? anchorPrice - fvgMax
          : 0;
      if (dist < bestDist) { bestDist = dist; bestNearest = result; }
    }
  }

  return mode === 'nearest' ? bestNearest : null;
}
