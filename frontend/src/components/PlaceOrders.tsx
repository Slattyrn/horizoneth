import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { ShoppingCart, TrendingUp, TrendingDown, AlertCircle, CheckCircle, Sparkles } from "lucide-react";
import { useAccount } from '../contexts/AccountContext';
import { useTicker } from '../contexts/TickerContext';
import { isValidTick } from '../utils/snapToTick';

interface PlaceOrdersProps {
  currentPrice?: number | null;
  onOrderPlaced?: (order: OrderData) => void;
  onOrderLinesChange?: (lines: OrderLinesData | null) => void;
  orderLines?: OrderLinesData | null;
  externalSuggestion?: OrderSuggestion | null;
  targetRiskMin?: number;
  targetRiskMax?: number;
  className?: string;
}

export interface OrderLinesData {
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  orderType: 'buy' | 'sell';
  orderEntryType: 'limit' | 'stop-limit' | 'market' | 'stop';
  stopPrice?: number | null;
}

export interface OrderData {
  type: 'buy' | 'sell';
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  contracts: number;
  risk: number;
  profit: number;
}

interface AccountInfo {
  id: number;
  name: string;
  balance: number;
}

export interface OrderSuggestion {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  orderType: 'buy' | 'sell';
}

export interface PlaceOrdersRef {
  fillFromSuggestion: (suggestion: OrderSuggestion) => void;
}

export default function PlaceOrders({
  currentPrice = null,
  onOrderPlaced,
  onOrderLinesChange,
  orderLines: externalOrderLines = null,
  externalSuggestion = null,
  targetRiskMin = 350,
  targetRiskMax = 500,
  className = ""
}: PlaceOrdersProps) {
  // Active ticker drives contract id + tick math. Switching the header toggle
  // flows straight into order placement and validation without a remount.
  const { activeConfig } = useTicker();

  const [contracts, setContracts] = useState<number>(0);
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy');
  const [orderEntryType, setOrderEntryType] = useState<'limit' | 'stop-limit' | 'market' | 'stop'>('limit');
  const [limitPrice, setLimitPrice] = useState<number | null>(null);
  const [stopPrice, setStopPrice] = useState<number | null>(null);
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const [takeProfit, setTakeProfit] = useState<number | null>(null);

  // API state
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isCancelingAll, setIsCancelingAll] = useState(false);
  const [hasActiveOrders, setHasActiveOrders] = useState(false);
  const [orderStatus, setOrderStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });
  const contractId = activeConfig.contract;
  const tickValue = activeConfig.tickValue;
  const tickSize = activeConfig.tickSize;
  const [autoFilledFromFVG, setAutoFilledFromFVG] = useState<boolean>(false);

  // Use account context for selected account
  const { selectedAccount, selectedAccountId } = useAccount();

  // Calculate risk and profit in dollars
  const calculateRiskReward = () => {
    // Determine entry price based on order type
    const entryPrice = orderEntryType === 'market' 
      ? currentPrice 
      : orderEntryType === 'stop' 
        ? stopPrice 
        : limitPrice;
        
    if (!entryPrice || !stopLoss || !takeProfit || contracts === 0) {
      return { risk: 0, profit: 0 };
    }

    // 🚨 FIX #2: Use state variables from backend config (not hardcoded values)
    // tickValue and tickSize are now fetched from backend in fetchConfig()

    if (orderType === 'buy') {
      // Long position
      const riskTicks = Math.abs(entryPrice - stopLoss) / tickSize;
      const profitTicks = Math.abs(takeProfit - entryPrice) / tickSize;
      return {
        risk: riskTicks * tickValue * contracts,
        profit: profitTicks * tickValue * contracts
      };
    } else {
      // Short position
      const riskTicks = Math.abs(stopLoss - entryPrice) / tickSize;
      const profitTicks = Math.abs(entryPrice - takeProfit) / tickSize;
      return {
        risk: riskTicks * tickValue * contracts,
        profit: profitTicks * tickValue * contracts
      };
    }
  };

  const { risk, profit } = calculateRiskReward();
  const riskRewardRatio = risk > 0 ? (profit / risk).toFixed(2) : "0.00";

  // Calculate risk per contract for auto-calculate feature
  const calculateRiskPerContract = () => {
    const entryPrice = orderEntryType === 'market' ? (currentPrice || 0) : (limitPrice || 0);
    if (!stopLoss || entryPrice === 0) return 0;
    
    const distPoints = Math.abs(entryPrice - stopLoss);
    // MES: $5 per point (tick value $1.25 / tick size 0.25)
    const dollarsPerPoint = tickValue / tickSize;
    return distPoints * dollarsPerPoint;
  };

  // Auto-calculate contracts: start from min risk, reduce until under max
  const handleAutoCalculate = () => {
    const riskPerContract = calculateRiskPerContract();
    if (riskPerContract <= 0) return;

    const contracts = Math.max(1, Math.floor(targetRiskMax / riskPerContract));

    setContracts(contracts);

    // Also auto-set take profit for 1:1 RR
    const entryPrice = orderEntryType === 'market' ? (currentPrice || 0) : (limitPrice || 0);
    if (entryPrice && stopLoss) {
      const stopDist = Math.abs(entryPrice - stopLoss);
      if (orderType === 'buy') {
        setTakeProfit(entryPrice + stopDist);
      } else {
        setTakeProfit(entryPrice - stopDist);
      }
    }
  };

  // Fetch config on mount
  useEffect(() => {
    fetchConfig();
    checkActiveOrders();

    // 🚨 CRITICAL PERFORMANCE FIX: Poll for active orders every 10 seconds (was 3s - CAUSING SCREEN BLANKING)
    const interval = setInterval(checkActiveOrders, 10000);
    return () => clearInterval(interval);
  }, []);

  // Re-check active orders when account changes
  useEffect(() => {
    if (selectedAccountId) {
      checkActiveOrders();
    }
  }, [selectedAccountId]);

  // Update chart order lines whenever prices change
  useEffect(() => {
    if (limitPrice || stopLoss || takeProfit || stopPrice) {
      onOrderLinesChange?.({
        limitPrice,
        stopLoss,
        takeProfit,
        orderType,
        orderEntryType,
        stopPrice
      });
    } else {
      onOrderLinesChange?.(null);
    }
  }, [limitPrice, stopLoss, takeProfit, stopPrice, orderType, orderEntryType, onOrderLinesChange]);

  // Sync external order line changes from chart drag back to local state
  // This creates a bidirectional data flow: PlaceOrders <-> App <-> ChartPanel
  useEffect(() => {
    if (!externalOrderLines) return;

    // Update local state when external order lines change (from chart drag)
    // Only update if values actually changed to avoid unnecessary re-renders
    if (externalOrderLines.limitPrice !== limitPrice) {
      setLimitPrice(externalOrderLines.limitPrice);
    }
    if (externalOrderLines.stopLoss !== stopLoss) {
      setStopLoss(externalOrderLines.stopLoss);
    }
    if (externalOrderLines.takeProfit !== takeProfit) {
      setTakeProfit(externalOrderLines.takeProfit);
    }
    if (externalOrderLines.orderType !== orderType) {
      setOrderType(externalOrderLines.orderType);
    }
    if (externalOrderLines.stopPrice !== stopPrice) {
      setStopPrice(externalOrderLines.stopPrice || null);
    }
  }, [externalOrderLines]);

  // Handle external FVG order suggestions
  useEffect(() => {
    if (!externalSuggestion) {
      setAutoFilledFromFVG(false);
      return;
    }

    // Validate suggestion prices (must be valid tick increments)
    const isValidPrice = (price: number) => { const r = price % tickSize; return r < 0.001 || r > (tickSize - 0.001); };

    if (!isValidPrice(externalSuggestion.entry) ||
      !isValidPrice(externalSuggestion.stopLoss) ||
      !isValidPrice(externalSuggestion.takeProfit)) {
      console.warn('Invalid FVG suggestion prices (not valid tick increments)');
      return;
    }

    // Fill order form with suggested prices
    setLimitPrice(externalSuggestion.entry);
    setStopLoss(externalSuggestion.stopLoss);
    setTakeProfit(externalSuggestion.takeProfit);
    setOrderType(externalSuggestion.orderType);
    setOrderEntryType('limit'); // FVG suggestions always use limit orders
    setAutoFilledFromFVG(true);

    console.log('✅ Auto-filled order from FVG suggestion:', externalSuggestion);

    // Clear auto-filled indicator after 5 seconds
    setTimeout(() => setAutoFilledFromFVG(false), 5000);
  }, [externalSuggestion]);

  // Auto-clear status message after 5 seconds
  useEffect(() => {
    if (orderStatus.type) {
      const timer = setTimeout(() => {
        setOrderStatus({ type: null, message: '' });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [orderStatus]);

  // Backend /api/config is no longer load-bearing — contract + tick math come
  // from TickerContext (registry in frontend/src/config/tickers.ts). Kept as a
  // no-op stub in case anything still calls it, but all tick data is sourced
  // from the per-ticker registry which moves when the TickerToggle flips.
  const fetchConfig = async () => {
    // intentionally empty
  };

  const checkActiveOrders = async () => {
    try {
      // Include account_id in the request if available
      const url = selectedAccountId
        ? `/api/orders?account_id=${selectedAccountId}`
        : '/api/orders';

      const response = await fetch(url);
      const orders = await response.json();

      // Check if there are any pending/working orders
      const activeOrders = Array.isArray(orders) && orders.some((order: any) => {
        const status = typeof order.status === 'string'
          ? order.status.toLowerCase()
          : ['pending', 'working'].includes(['pending', 'working', 'filled', 'cancelled', 'rejected'][order.status]);
        return ['pending', 'working'].includes(status);
      });

      setHasActiveOrders(activeOrders);
    } catch (error) {
      console.error('Failed to check active orders:', error);
    }
  };

  const handleCancelAllOrders = async () => {
    if (!window.confirm('Are you sure you want to cancel ALL pending orders?')) {
      return;
    }

    setIsCancelingAll(true);
    setOrderStatus({ type: null, message: '' });

    try {
      const response = await fetch('/api/orders/cancel-all', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to cancel orders');
      }

      if (data.success) {
        setOrderStatus({
          type: 'success',
          message: `Successfully cancelled ${data.cancelledCount || 0} order(s)`,
        });

        // Clear order lines after canceling
        onOrderLinesChange?.(null);

        // Refresh active orders check
        checkActiveOrders();
      }
    } catch (error) {
      console.error('Cancel all orders error:', error);
      setOrderStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to cancel orders',
      });
    } finally {
      setIsCancelingAll(false);
    }
  };

  const handlePlaceOrder = async () => {
    // Validation based on order entry type
    if (contracts === 0) {
      setOrderStatus({
        type: 'error',
        message: 'Contracts must be greater than 0'
      });
      return;
    }

    // Order type specific validation
    if (orderEntryType === 'limit') {
      if (!limitPrice || !stopLoss || !takeProfit) {
        setOrderStatus({
          type: 'error',
          message: 'Limit orders require Limit Price, Stop Loss, and Take Profit'
        });
        return;
      }
    } else if (orderEntryType === 'stop-limit') {
      if (!stopPrice || !limitPrice || !stopLoss || !takeProfit) {
        setOrderStatus({
          type: 'error',
          message: 'Stop Limit orders require Stop Price, Limit Price, Stop Loss, and Take Profit'
        });
        return;
      }
    } else if (orderEntryType === 'stop') {
      if (!stopPrice || !stopLoss || !takeProfit) {
        setOrderStatus({
          type: 'error',
          message: 'Stop Market orders require Stop Price, Stop Loss, and Take Profit'
        });
        return;
      }
    }
    // Market orders only require contracts (SL/TP optional)

    // Validate tick size against the active ticker's grid (MYM: 1.0, MES: 0.25)
    const pricesToValidate = [limitPrice, stopPrice, stopLoss, takeProfit].filter(p => p !== null) as number[];
    if (pricesToValidate.length > 0 && pricesToValidate.some(p => !isValidTick(p, tickSize))) {
      setOrderStatus({
        type: 'error',
        message: `Prices must be in ${tickSize}-point increments (${activeConfig.key})`,
      });
      return;
    }

    setIsPlacingOrder(true);
    setOrderStatus({ type: null, message: '' });

    try {
      // Build API payload based on order entry type
      // CRITICAL: Must use full contract format (CON.F.US.MNQ.H25) not short form (F.US.MNQ)
      // The short form returns error code 8 from ProjectX API
      const payload: any = {
        contractId: contractId, // Use dynamic contract from backend config
        side: orderType,
        orderType: orderEntryType,
        quantity: contracts,
      };

      // Add price fields based on order type
      if (orderEntryType === 'limit') {
        payload.price = limitPrice;
      } else if (orderEntryType === 'stop-limit') {
        payload.stopPrice = stopPrice;
        payload.price = limitPrice;
      } else if (orderEntryType === 'stop') {
        payload.stopPrice = stopPrice;
        // Stop Market orders don't have a limit price - they execute at market when triggered
      }
      // Market orders don't need price

      // Add stop loss and take profit (optional for market orders)
      // Check for both null and undefined, and ensure value is a valid number
      if (stopLoss !== null && stopLoss !== undefined && !isNaN(stopLoss) && stopLoss > 0) {
        payload.stopLoss = stopLoss;
      }
      if (takeProfit !== null && takeProfit !== undefined && !isNaN(takeProfit) && takeProfit > 0) {
        payload.takeProfit = takeProfit;
      }

      // DEBUG: Log the payload being sent
      console.log('📤 Sending order payload:', {
        orderType: orderEntryType,
        side: orderType,
        quantity: contracts,
        price: payload.price,
        stopPrice: payload.stopPrice,
        stopLoss: payload.stopLoss,
        takeProfit: payload.takeProfit,
        contractId: payload.contractId
      });

      // Call real API with account_id query parameter
      const url = selectedAccountId
        ? `/api/orders/place?account_id=${selectedAccountId}`
        : '/api/orders/place';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to place order');
      }

      if (data.success) {
        // DEBUG: Log the response with all order IDs
        console.log('✅ Order placement successful:', {
          entryOrderId: data.orderId,
          stopOrderId: data.stopOrderId,
          tpOrderId: data.tpOrderId,
          message: data.message
        });

        setOrderStatus({
          type: 'success',
          message: `Entry: ${data.orderId}${data.stopOrderId ? ` | SL: ${data.stopOrderId}` : ''}${data.tpOrderId ? ` | TP: ${data.tpOrderId}` : ''}`
        });

        // Call parent callback with order data
        const orderData: OrderData = {
          type: orderType,
          limitPrice,
          stopLoss,
          takeProfit,
          contracts,
          risk,
          profit
        };
        onOrderPlaced?.(orderData);

        // Reset form after successful order
        setTimeout(() => {
          setContracts(0);
          setLimitPrice(null);
          setStopPrice(null);
          setStopLoss(null);
          setTakeProfit(null);
        }, 2000);
      }
    } catch (error) {
      console.error('Order placement error:', error);
      setOrderStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to place order'
      });
    } finally {
      setIsPlacingOrder(false);
    }
  };

  return (
    <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-5 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <ShoppingCart className="text-blue-500" size={22} />
          Place Orders
          {autoFilledFromFVG && (
            <span className="text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-lg flex items-center gap-1 animate-pulse">
              <Sparkles size={12} />
              FVG Auto-Filled
            </span>
          )}
        </h3>
        <div className="text-sm text-gray-400">
          {currentPrice ? `$${currentPrice.toFixed(2)}` : '--'}
        </div>
      </div>

      {/* Account Info */}
      {selectedAccount && (
        <div className="mb-4 bg-gray-800/50 border border-gray-700/50 rounded-lg p-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-400">Account:</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold">{selectedAccount.name}</span>
              {selectedAccount.isPaper && (
                <span className="bg-orange-500/20 text-orange-400 text-xs px-1.5 py-0.5 rounded border border-orange-500/30 uppercase font-bold">
                  Paper
                </span>
              )}
            </div>
          </div>
          <div className="flex justify-between items-center text-sm mt-1">
            <span className="text-gray-400">Balance:</span>
            <span className="text-green-400 font-semibold">
              ${selectedAccount.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      {/* Order Status Message */}
      {orderStatus.type && (
        <div className={`mb-4 p-3 rounded-lg border flex items-start gap-2 ${orderStatus.type === 'success'
          ? 'bg-green-500/10 border-green-500/30 text-green-400'
          : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
          {orderStatus.type === 'success' ? (
            <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          )}
          <span className="text-sm">{orderStatus.message}</span>
        </div>
      )}

      {/* Contract Quantity Selector */}
      <div className="mb-5">
        <label className="text-sm font-medium text-gray-300 mb-2 block flex items-center justify-between">
          <span>Contracts</span>
          <span className="text-blue-500 font-bold text-lg">{contracts}</span>
        </label>
        <input
          type="range"
          min="0"
          max="50"
          step="1"
          value={contracts}
          onChange={(e) => setContracts(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
                   [&::-webkit-slider-thumb]:cursor-pointer hover:[&::-webkit-slider-thumb]:bg-blue-400
                   [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1.5">
          <span>0</span>
          <span>25</span>
          <span>50</span>
        </div>

        {/* Auto-Calculate Position Size */}
        <div className="mt-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-400">Risk Range</label>
            <span className="text-xs font-medium text-green-400">${targetRiskMin} – ${targetRiskMax}</span>
          </div>
          <button
            onClick={handleAutoCalculate}
            disabled={!stopLoss || (!limitPrice && orderEntryType !== 'market')}
            className="w-full py-2 px-3 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium
                     hover:bg-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Auto-Calculate Contracts
          </button>
          {(limitPrice || orderEntryType === 'market') && stopLoss && (
            <div className="mt-2 text-xs text-gray-500">
              Entry: ${(limitPrice || currentPrice || 0).toFixed(2)} | Stop: ${stopLoss.toFixed(2)} | Risk/Contract: ${calculateRiskPerContract().toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {/* Order Entry Type Selector */}
      <div className="mb-4">
        <label className="text-sm font-medium text-gray-300 mb-2 block">
          Order Entry Type
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setOrderEntryType('limit')}
            className={`py-2.5 px-3 rounded-lg font-semibold text-sm transition-all ${orderEntryType === 'limit'
              ? 'bg-blue-500/20 text-blue-400 border-2 border-blue-500/50'
              : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:bg-gray-700/50'
              }`}
          >
            Limit
          </button>
          <button
            onClick={() => setOrderEntryType('stop-limit')}
            className={`py-2.5 px-3 rounded-lg font-semibold text-sm transition-all ${orderEntryType === 'stop-limit'
              ? 'bg-orange-500/20 text-orange-400 border-2 border-orange-500/50'
              : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:bg-gray-700/50'
              }`}
          >
            Stop Limit
          </button>
          <button
            onClick={() => setOrderEntryType('stop')}
            className={`py-2.5 px-3 rounded-lg font-semibold text-sm transition-all ${orderEntryType === 'stop'
              ? 'bg-red-500/20 text-red-400 border-2 border-red-500/50'
              : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:bg-gray-700/50'
              }`}
          >
            Stop Market
          </button>
          <button
            onClick={() => setOrderEntryType('market')}
            className={`py-2.5 px-3 rounded-lg font-semibold text-sm transition-all ${orderEntryType === 'market'
              ? 'bg-purple-500/20 text-purple-400 border-2 border-purple-500/50'
              : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:bg-gray-700/50'
              }`}
          >
            Market
          </button>
        </div>
      </div>

      {/* Order Type Toggle */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <button
          onClick={() => setOrderType('buy')}
          className={`py-3 px-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${orderType === 'buy'
            ? 'bg-green-500/20 text-green-400 border-2 border-green-500/50'
            : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:bg-gray-700/50'
            }`}
        >
          <TrendingUp size={18} />
          Buy
        </button>
        <button
          onClick={() => setOrderType('sell')}
          className={`py-3 px-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${orderType === 'sell'
            ? 'bg-red-500/20 text-red-400 border-2 border-red-500/50'
            : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:bg-gray-700/50'
            }`}
        >
          <TrendingDown size={18} />
          Sell
        </button>
      </div>

      {/* Order Prices */}
      <div className="space-y-3 mb-5">
        {/* Stop Price (Stop Limit and Stop Market orders) */}
        {(orderEntryType === 'stop-limit' || orderEntryType === 'stop') && (
          <div>
            <label className="text-sm font-medium text-gray-300 mb-1.5 block">
              Stop Price (Trigger)
              {orderEntryType === 'stop' && (
                <span className="ml-2 text-xs text-red-400">→ Market Order</span>
              )}
            </label>
            <input
              type="number"
              step="1"
              value={stopPrice !== null ? stopPrice : ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || val === '-') {
                  setStopPrice(null);
                } else {
                  const num = parseFloat(val);
                  if (!isNaN(num)) setStopPrice(num);
                }
              }}
              placeholder={currentPrice ? currentPrice.toFixed(2) : "0.00"}
              className="w-full bg-orange-500/10 border border-orange-500/30 text-white rounded-lg px-3 py-2.5 text-sm font-medium
                       hover:bg-orange-500/20 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
            />
          </div>
        )}

        {/* Limit Price (Limit and Stop Limit orders) */}
        {(orderEntryType === 'limit' || orderEntryType === 'stop-limit') && (
          <div>
            <label className="text-sm font-medium text-gray-300 mb-1.5 block">
              {orderEntryType === 'stop-limit' ? 'Limit Price (Execution)' : 'Limit Price'}
            </label>
            <input
              type="number"
              step="1"
              value={limitPrice !== null ? limitPrice : ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || val === '-') {
                  setLimitPrice(null);
                } else {
                  const num = parseFloat(val);
                  if (!isNaN(num)) setLimitPrice(num);
                }
              }}
              placeholder={currentPrice ? currentPrice.toFixed(2) : "0.00"}
              className="w-full bg-gray-800/70 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm font-medium
                       hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            />
          </div>
        )}

        {/* Market Order Info */}
        {orderEntryType === 'market' && (
          <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded-lg">
            <div className="flex items-start gap-2 text-sm text-purple-300">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>Market order will execute immediately at current market price</span>
            </div>
          </div>
        )}

        {/* Stop Loss */}
        <div>
          <label className="text-sm font-medium text-gray-300 mb-1.5 block flex items-center justify-between">
            <span>Stop Loss (SL){orderEntryType === 'market' && ' - Optional'}</span>
            {stopLoss && limitPrice && orderEntryType !== 'market' && (
              <span className="text-yellow-500 font-semibold text-xs">
                ${Math.abs(stopLoss - limitPrice).toFixed(2)}
              </span>
            )}
          </label>
          <input
            type="number"
            step="1"
            value={stopLoss !== null ? stopLoss : ''}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || val === '-') {
                setStopLoss(null);
              } else {
                const num = parseFloat(val);
                if (!isNaN(num)) setStopLoss(num);
              }
            }}
            placeholder="0.00"
            className="w-full bg-yellow-500/10 border border-yellow-500/30 text-white rounded-lg px-3 py-2.5 text-sm font-medium
                     hover:bg-yellow-500/20 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 transition-all"
          />
        </div>

        {/* Take Profit */}
        <div>
          <label className="text-sm font-medium text-gray-300 mb-1.5 block flex items-center justify-between">
            <span>Take Profit (TP){orderEntryType === 'market' && ' - Optional'}</span>
            {takeProfit && limitPrice && orderEntryType !== 'market' && (
              <span className="text-blue-500 font-semibold text-xs">
                ${Math.abs(takeProfit - limitPrice).toFixed(2)}
              </span>
            )}
          </label>
          <input
            type="number"
            step="1"
            value={takeProfit !== null ? takeProfit : ''}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || val === '-') {
                setTakeProfit(null);
              } else {
                const num = parseFloat(val);
                if (!isNaN(num)) setTakeProfit(num);
              }
            }}
            placeholder="0.00"
            className="w-full bg-blue-500/10 border border-blue-500/30 text-white rounded-lg px-3 py-2.5 text-sm font-medium
                     hover:bg-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
          />
        </div>
      </div>

      {/* Risk/Reward Display */}
      {contracts > 0 && ((limitPrice && stopLoss && takeProfit) || (orderEntryType === 'market' && stopLoss && takeProfit) || (orderEntryType === 'stop' && stopPrice && stopLoss && takeProfit)) && (
        <div className="space-y-3 mb-5">
          {/* Risk */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Risk (SL)</span>
              <span className="text-lg font-bold text-yellow-500">
                ${risk.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Profit */}
          <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Profit (TP)</span>
              <span className="text-lg font-bold text-blue-500">
                ${profit.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Risk/Reward Ratio */}
          <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">R:R Ratio</span>
              <span className="text-lg font-bold text-purple-400">
                1:{riskRewardRatio}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Place Order Button */}
      <button
        onClick={handlePlaceOrder}
        disabled={
          contracts === 0 ||
          isPlacingOrder ||
          (orderEntryType === 'limit' && (!limitPrice || !stopLoss || !takeProfit)) ||
          (orderEntryType === 'stop-limit' && (!stopPrice || !limitPrice || !stopLoss || !takeProfit)) ||
          (orderEntryType === 'stop' && (!stopPrice || !stopLoss || !takeProfit))
        }
        className={`w-full py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${contracts === 0 ||
          isPlacingOrder ||
          (orderEntryType === 'limit' && (!limitPrice || !stopLoss || !takeProfit)) ||
          (orderEntryType === 'stop-limit' && (!stopPrice || !limitPrice || !stopLoss || !takeProfit)) ||
          (orderEntryType === 'stop' && (!stopPrice || !stopLoss || !takeProfit))
          ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
          : orderType === 'buy'
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'bg-red-500 text-white hover:bg-red-600'
          }`}
      >
        {isPlacingOrder ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Placing Order...
          </>
        ) : contracts === 0 ? (
          'Set Contracts'
        ) : (
          `Place ${orderType.toUpperCase()} ${orderEntryType === 'limit' ? 'LIMIT' : orderEntryType === 'stop-limit' ? 'STOP LIMIT' : orderEntryType === 'stop' ? 'STOP MARKET' : 'MARKET'} (${contracts})`
        )}
      </button>

      {/* Cancel All Orders Button */}
      <button
        onClick={handleCancelAllOrders}
        disabled={!hasActiveOrders || isCancelingAll}
        className={`w-full py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 mt-3 ${!hasActiveOrders || isCancelingAll
          ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
          : 'bg-orange-500/20 text-orange-400 border-2 border-orange-500/50 hover:bg-orange-500/30 hover:border-orange-500'
          }`}
      >
        {isCancelingAll ? (
          <>
            <div className="w-4 h-4 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" />
            Canceling Orders...
          </>
        ) : (
          <>
            <AlertCircle size={18} />
            Cancel All Orders
          </>
        )}
      </button>

      {/* Info */}
      <div className="mt-4 text-xs text-gray-400 bg-gray-800/50 p-3 rounded-lg border border-gray-700/50 space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="text-blue-500 mt-0.5">ⓘ</span>
          <div>
            <div className="font-semibold text-gray-300 mb-1">Order Entry Types:</div>
            <div><span className="text-blue-400">Limit:</span> Enter at limit price or better</div>
            <div><span className="text-orange-400">Stop Limit:</span> Triggers at stop price, executes at limit price</div>
            <div><span className="text-purple-400">Market:</span> Executes immediately at current price</div>
          </div>
        </div>
      </div>
    </div>
  );
}
