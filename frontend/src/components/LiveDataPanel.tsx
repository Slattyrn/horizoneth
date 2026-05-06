import React, { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff } from "lucide-react";
import { subscribe } from "../lib/ws";
import { useTicker } from "../contexts/TickerContext";
import { TickerKey } from "../config/tickers";

interface LiveData {
  symbol?: string;
  symbolName?: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  timestamp?: string;
  type?: string;
}

export default function LiveDataPanel({
  className = "",
  selectedTicker: selectedTickerProp,
}: {
  className?: string;
  /** Optional override. When omitted the panel follows the global TickerContext. */
  selectedTicker?: TickerKey | 'YM' | 'ES' | 'GC';
}) {
  const { activeTicker, activeConfig } = useTicker();
  const selectedTicker = selectedTickerProp ?? activeTicker;
  const [liveData, setLiveData] = useState<LiveData>({
    price: null,
    bid: null,
    ask: null,
    volume: null,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
  });
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [tickCount, setTickCount] = useState(0);

  // Component lifecycle logging
  useEffect(() => {
    console.log('📡 LiveDataPanel MOUNTED');
    return () => {
      console.log('📡 LiveDataPanel UNMOUNTED');
    };
  }, []);

  useEffect(() => {
    setIsConnected(true);

    const unsubscribe = subscribe((data: any) => {
      // 🚨 FILTER: Only process ticks for selected ticker (MES or ES)
      if (data.ticker && data.ticker !== selectedTicker) {
        return; // Skip ticks from other ticker
      }

      console.log("📊 LiveDataPanel received:", data); // DEBUG
      setTickCount(prev => prev + 1);
      setLastUpdate(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }));

      // Handle different data types from backend
      if (data.type === 'quote' || !data.type) {
        setLiveData((prev) => ({
          symbol: data.symbol || prev.symbol,
          symbolName: data.symbolName || prev.symbolName,
          price: data.lastPrice ?? data.price ?? prev.price,
          bid: data.bestBid ?? data.bid ?? prev.bid,
          ask: data.bestAsk ?? data.ask ?? prev.ask,
          volume: data.volume ?? prev.volume,
          change: data.change ?? prev.change,
          changePercent: data.changePercent ?? prev.changePercent,
          open: data.open ?? prev.open,
          high: data.high ?? prev.high,
          low: data.low ?? prev.low,
          timestamp: data.timestamp,
          type: data.type,
        }));
      } else if (data.type === 'trade') {
        // Update price from trade data
        setLiveData((prev) => ({
          ...prev,
          price: data.price ?? prev.price,
          volume: data.volume ?? prev.volume,
          timestamp: data.timestamp,
        }));
      }

      // Expose live data to window for Telegram commands
      (window as any).__liveMarketData = {
        price: data.lastPrice ?? data.price ?? null,
        bid: data.bestBid ?? data.bid ?? null,
        ask: data.bestAsk ?? data.ask ?? null,
        open: data.open ?? null,
        high: data.high ?? null,
        low: data.low ?? null,
        change: data.change ?? null,
        changePercent: data.changePercent ?? null,
        volume: data.volume ?? null,
        symbol: data.symbol ?? null,
        lastUpdate: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })
      };
    });

    return () => {
      unsubscribe();
      setIsConnected(false);
    };
  }, [selectedTicker]);

  const spread = liveData.bid && liveData.ask ? liveData.ask - liveData.bid : null;
  const isPositive = (liveData.change || 0) >= 0;

  return (
    <div className={`p-7 rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="text-blue-500" size={24} />
            Live Market Data
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {selectedTicker} - {
              selectedTicker === 'GC' ? 'Gold (COMEX)'
              : selectedTicker === activeTicker ? `${activeConfig.displayName} (${activeConfig.exchange})`
              : selectedTicker === 'MYM' ? 'Micro Dow Jones (CBOT)'
              : selectedTicker === 'ES' ? 'E-mini S&P 500 (CME)'
              : selectedTicker
            }
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${
            isConnected ? 'bg-green-500/10' : 'bg-red-500/10'
          }`}>
            {isConnected ? (
              <>
                <Wifi className="text-green-500" size={18} />
                <span className="text-sm font-semibold text-green-500">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="text-red-500" size={18} />
                <span className="text-sm font-semibold text-red-500">Offline</span>
              </>
            )}
          </div>
          <span className="text-sm text-gray-600">{tickCount} ticks</span>
        </div>
      </div>

      {/* Main Price Display */}
      <div className="mb-7 p-5 rounded-lg bg-gray-800/50 border border-gray-700">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm text-gray-500 mb-2">Last Price</div>
            <div className={`text-5xl font-bold ${
              isPositive ? "text-trading-bullish" : "text-trading-bearish"
            }`}>
              {liveData.price ? `$${liveData.price.toFixed(2)}` : "--"}
            </div>
          </div>
          {liveData.change !== null && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-lg ${
              isPositive ? 'bg-green-500/10' : 'bg-red-500/10'
            }`}>
              {isPositive ? (
                <TrendingUp className="text-trading-bullish" size={24} />
              ) : (
                <TrendingDown className="text-trading-bearish" size={24} />
              )}
              <div className="text-right">
                <div className={`text-base font-bold ${
                  isPositive ? "text-trading-bullish" : "text-trading-bearish"
                }`}>
                  {isPositive ? '+' : ''}{liveData.change?.toFixed(2) ?? "--"}
                </div>
                <div className={`text-sm ${
                  isPositive ? "text-trading-bullish" : "text-trading-bearish"
                }`}>
                  ({isPositive ? '+' : ''}{liveData.changePercent?.toFixed(2) ?? "--"}%)
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bid/Ask Spread */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
          <div className="text-sm text-gray-500 mb-2">Bid</div>
          <div className="text-2xl font-bold text-green-500">
            {liveData.bid ? `$${liveData.bid.toFixed(2)}` : "--"}
          </div>
        </div>
        <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
          <div className="text-sm text-gray-500 mb-2">Ask</div>
          <div className="text-2xl font-bold text-red-500">
            {liveData.ask ? `$${liveData.ask.toFixed(2)}` : "--"}
          </div>
        </div>
      </div>

      {spread !== null && (
        <div className="mb-5 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-center">
          <span className="text-sm text-gray-500">Spread: </span>
          <span className="text-base font-semibold text-blue-400">
            ${spread.toFixed(2)}
          </span>
        </div>
      )}

      {/* Additional Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
          <div className="text-sm text-gray-500 mb-2">Open</div>
          <div className="text-base font-semibold text-white">
            {liveData.open ? `$${liveData.open.toFixed(2)}` : "--"}
          </div>
        </div>
        <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
          <div className="text-sm text-gray-500 mb-2">High</div>
          <div className="text-base font-semibold text-trading-bullish">
            {liveData.high ? `$${liveData.high.toFixed(2)}` : "--"}
          </div>
        </div>
        <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
          <div className="text-sm text-gray-500 mb-2">Low</div>
          <div className="text-base font-semibold text-trading-bearish">
            {liveData.low ? `$${liveData.low.toFixed(2)}` : "--"}
          </div>
        </div>
        <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
          <div className="text-sm text-gray-500 mb-2">Volume</div>
          <div className="text-base font-semibold text-white">
            {liveData.volume?.toLocaleString() ?? "--"}
          </div>
        </div>
      </div>

      {/* Last Update Time */}
      {lastUpdate && (
        <div className="mt-5 text-center text-sm text-gray-600">
          Last update: {lastUpdate}
        </div>
      )}
    </div>
  );
}