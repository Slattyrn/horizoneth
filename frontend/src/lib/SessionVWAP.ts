// VWAP Calculation Logic - Centralized
// Handles session resets and cumulative volume

export interface VWAPCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  vwap?: number;
}

export const calculateVWAP = (data: VWAPCandle[]): VWAPCandle[] => {
  let cumPV = 0;
  let cumV = 0;
  let lastSessionDate = '';

  return data.map((d) => {
    // Session resets at 6pm ET (18:00 NY time)
    // We use a simple approximation: if hour >= 18, it's the "next" trading day session
    // This groups 18:00-23:59 (Day T) and 00:00-17:59 (Day T+1) into the same session.
    
    const candleDate = new Date(d.time * 1000);
    // Use UTC to avoid browser locale issues, convert to ET mathematically if needed
    // ET is UTC-5 (Standard) or UTC-4 (DST). 
    // 18:00 ET is 22:00/23:00 UTC.
    // Let's stick to the existing logic using toLocaleString with timezone for accuracy
    const nyTime = new Date(candleDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nyTime.getHours();
    
    // Create a unique session key (YYYY-MM-DD of the *trading session*)
    // If hour >= 18, it belongs to the *next* day's session logic, but for grouping
    // we just need a unique key that changes at 18:00.
    // Using the date string:
    // - Before 18:00: belongs to "yesterday's" start? No.
    // - 18:00 today starts "today's" session (which runs into tomorrow).
    
    const dateStr = nyTime.toDateString();
    const sessionKey = hour >= 18 ? dateStr : new Date(nyTime.getTime() - 86400000).toDateString();

    if (lastSessionDate !== '' && sessionKey !== lastSessionDate) {
      cumPV = 0;
      cumV = 0;
    }
    lastSessionDate = sessionKey;

    const avg = (d.high + d.low + d.close) / 3;
    const vol = d.volume || 0;
    
    cumPV += avg * vol;
    cumV += vol;

    const vwapValue = cumV === 0 ? d.close : cumPV / cumV;

    return { ...d, vwap: vwapValue };
  });
};
