import { useEffect, useRef, useState, useCallback } from "react";
import { chartBroadcast, getPopoutTimeframe } from "../lib/chartBroadcast";
import CandlestickChart, { CandleData, ZoneLine } from "./CandlestickChart";

// FIXED: Replaced broken FinancialChart (prop mismatch) with CandlestickChart

type Timeframe = '1m' | '2m' | '3m' | '5m' | '10m' | '30m';

const timeframes: Timeframe[] = ['1m', '2m', '3m', '5m', '10m', '30m'];

const getTimeframeDuration = (tf: Timeframe): number => {
  switch (tf) {
    case '1m': return 60;
    case '2m': return 120;
    case '3m': return 180;
    case '5m': return 300;
    case '10m': return 600;
    case '30m': return 1800;
    default: return 300;
  }
};

export default function PopoutChart() {
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const urlTf = getPopoutTimeframe();
    return (timeframes.includes(urlTf as Timeframe) ? urlTf : '5m') as Timeframe;
  });
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [zones, setZones] = useState<any>({});

  const candlesRef = useRef<CandleData[]>([]);
  const currentPriceRef = useRef<number>(0);
  const tickBuffer = useRef<any[]>([]);
  const lastRenderTime = useRef<number>(0);

  useEffect(() => {
    document.title = `Chart ${timeframe.toUpperCase()} - Horizon Alpha`;
  }, [timeframe]);

  const getCandleStartTime = useCallback((timestamp: number, tf: Timeframe) => {
    const duration = getTimeframeDuration(tf);
    return Math.floor(timestamp / duration) * duration;
  }, []);

  const processTick = useCallback((tick: any) => {
    tickBuffer.current.push(tick);
  }, []);

  // Render loop
  useEffect(() => {
    let animationFrameId: number;

    const renderLoop = () => {
      const now = Date.now();
      if (now - lastRenderTime.current > 50) {
        if (tickBuffer.current.length > 0) {
          const buffer = [...tickBuffer.current];
          tickBuffer.current = [];

          let latestPrice = currentPriceRef.current;
          let updatedCandles = [...candlesRef.current];

          buffer.forEach(tick => {
            const price = tick.price || tick.lastPrice;
            if (!price || isNaN(price)) return;
            latestPrice = price;

            let timestamp = tick.timestamp;
            if (typeof timestamp === 'string') {
              timestamp = Math.floor(new Date(timestamp).getTime() / 1000);
            } else if (timestamp > 10 ** 12) {
              timestamp = Math.floor(timestamp / 1000);
            }

            const candleTime = getCandleStartTime(timestamp, timeframe);
            const lastCandle = updatedCandles[updatedCandles.length - 1];

            let tickVol = 0;
            if (tick.type === 'trade') tickVol = Number(tick.tradeVolume || tick.size || tick.qty || 0);
            else if (tick.tradeVolume) tickVol = Number(tick.tradeVolume);
            if (isNaN(tickVol)) tickVol = 0;

            if (lastCandle && lastCandle.time === candleTime) {
              lastCandle.high = Math.max(lastCandle.high, price);
              lastCandle.low = Math.min(lastCandle.low, price);
              lastCandle.close = price;
              lastCandle.volume = (lastCandle.volume || 0) + tickVol;
            } else {
              updatedCandles.push({
                time: candleTime, open: price, high: price, low: price, close: price, volume: tickVol
              });
              if (updatedCandles.length > 500) updatedCandles = updatedCandles.slice(-500);
            }
          });

          currentPriceRef.current = latestPrice;
          candlesRef.current = updatedCandles;
          setCandles(updatedCandles);
          setCurrentPrice(latestPrice);
          lastRenderTime.current = now;
        }
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [timeframe, getCandleStartTime]);

  // Subscribe to tick data via BroadcastChannel
  useEffect(() => {
    chartBroadcast.requestSync();
    const unsubTick = chartBroadcast.onTick(processTick);
    const unsubZones = chartBroadcast.onZoneUpdate((newZones) => setZones(newZones));
    const initialZones = chartBroadcast.getLatestZones();
    if (initialZones) setZones(initialZones);
    return () => { unsubTick(); unsubZones(); };
  }, [processTick]);

  // Reset candles on timeframe change
  useEffect(() => {
    setCandles([]);
    candlesRef.current = [];
    tickBuffer.current = [];
  }, [timeframe]);

  // Convert zones to ZoneLine format
  const zoneLines: ZoneLine[] = [];
  if (zones.upperZone) zoneLines.push({ price: zones.upperZone, color: '#ef4444', label: 'R1' });
  if (zones.lowerZone) zoneLines.push({ price: zones.lowerZone, color: '#22c55e', label: 'S1' });
  if (zones.upperZoneR2) zoneLines.push({ price: zones.upperZoneR2, color: '#f97316', label: 'R2' });
  if (zones.lowerZoneS2) zoneLines.push({ price: zones.lowerZoneS2, color: '#06b6d4', label: 'S2' });
  if (zones.openPrice) zoneLines.push({ price: zones.openPrice, color: '#ffffff', label: 'Open' });

  return (
    <div className="h-screen w-screen bg-[#0a0a0f] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900/80 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">ES</span>
          <span className={`text-lg font-bold ${currentPrice > 0 ? 'text-green-400' : 'text-white'}`}>
            ${currentPrice.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                timeframe === tf
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart - FIXED: Using CandlestickChart instead of broken FinancialChart */}
      <div className="flex-1 relative">
        <CandlestickChart
          candles={candles}
          currentPrice={currentPrice}
          zones={zoneLines}
          overlays={[]}
        />
      </div>

      {/* Footer */}
      <div className="px-3 py-1 bg-gray-900/80 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
        <span>{candles.length} candles</span>
        <span>Timeframe: {timeframe}</span>
      </div>
    </div>
  );
}
