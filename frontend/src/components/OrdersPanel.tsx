import { useState, useEffect, useMemo } from 'react';
import { ShoppingCart, Target, Shield, XCircle, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';

// ProjectX Order Types
const ORDER_TYPE = {
  LIMIT: 1,      // Take Profit
  MARKET: 2,     // Entry
  STOP: 3,       // Stop Loss (Stop-Market)
  STOP_LIMIT: 4, // Stop-Limit
  TRAILING: 5    // Trailing Stop
} as const;

// ProjectX Order Sides
const ORDER_SIDE = {
  BUY: 0,
  SELL: 1
} as const;

interface Order {
  id?: number;
  orderId?: number;
  contractId?: string;
  side?: number;
  type?: number;
  limitPrice?: number;
  stopPrice?: number;
  size?: number;
  filledSize?: number;
  status?: number | string;
  averageFilledPrice?: number;
}

interface Position {
  id?: number;
  contractId?: string;
  type?: number; // 0=Long, 1=Short
  size?: number;
  averagePrice?: number;
  timestamp?: string;
}

interface OrdersPanelProps {
  className?: string;
  automationOrders?: Map<string, {
    entry: number;
    stopLoss: number;
    takeProfit: number;
    side: 'buy' | 'sell';
    quantity: number;
  }>;
}

// Group orders by position (contract)
interface PositionGroup {
  contractId: string;
  position: Position | null;
  entryPrice: number;
  side: 'long' | 'short';
  size: number;
  stopOrders: Order[];
  limitOrders: Order[];
  workingOrders: Order[];
}

export default function OrdersPanel({ className = '', automationOrders }: OrdersPanelProps) {
  const { selectedAccountId, selectedAccount } = useAccount();

  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cancelingOrderId, setCancelingOrderId] = useState<number | null>(null);

  useEffect(() => {
    console.log('📦 OrdersPanel MOUNTED');
    return () => {
      console.log('📦 OrdersPanel UNMOUNTED');
    };
  }, []);

  useEffect(() => {
    fetchAll();

    // Refresh every 5 seconds for real-time updates
    const interval = setInterval(() => {
      fetchAll(true);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      fetchAll();
    }
  }, [selectedAccountId]);

  const fetchAll = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setIsRefreshing(true);
    await Promise.all([fetchOrders(), fetchPositions()]);
    setIsLoading(false);
    setIsRefreshing(false);
  };

  const fetchOrders = async () => {
    try {
      const url = selectedAccountId
        ? `/api/orders?account_id=${selectedAccountId}`
        : '/api/orders';

      const response = await fetch(url);
      const data = await response.json();

      if (Array.isArray(data)) {
        console.log('📋 Orders fetched:', data.length, data);
        setOrders(data);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const fetchPositions = async () => {
    try {
      const url = selectedAccountId
        ? `/api/positions?account_id=${selectedAccountId}`
        : '/api/positions';
      const response = await fetch(url);

      if (!response.ok) {
        console.error('Position fetch failed:', response.status);
        setPositions([]);
        return;
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        console.log('📊 Positions fetched:', data.length, data);
        setPositions(data);
      } else {
        setPositions([]);
      }
    } catch (error) {
      console.error('Error fetching positions:', error);
      setPositions([]);
    }
  };

  // Group positions with their associated orders
  const positionGroups = useMemo(() => {
    const groups: PositionGroup[] = [];

    // First, add all active positions
    positions.forEach(pos => {
      const contractId = pos.contractId || '';
      const isLong = pos.type === 0;

      // Find associated orders for this position (same contract, opposite side for SL/TP)
      const relatedOrders = orders.filter(o => {
        const orderContract = o.contractId || '';
        // Match orders for the same contract
        return orderContract === contractId ||
          orderContract.includes('MGC') && contractId.includes('MGC') ||
          orderContract.includes('ES') && contractId.includes('ES') ||
          orderContract.includes('MYM') && contractId.includes('MYM') ||
          orderContract.includes('YM') && contractId.includes('YM');
      });

      // Stop orders (Stop-Market, Stop-Limit) - for protection
      const stopOrders = relatedOrders.filter(o =>
        o.type === ORDER_TYPE.STOP || o.type === ORDER_TYPE.STOP_LIMIT || o.type === ORDER_TYPE.TRAILING
      );

      // Limit orders - for Take Profit
      const limitOrders = relatedOrders.filter(o =>
        o.type === ORDER_TYPE.LIMIT
      );

      // Other working orders
      const workingOrders = relatedOrders.filter(o =>
        o.type === ORDER_TYPE.MARKET && (o.status === 0 || o.status === 1)
      );

      groups.push({
        contractId,
        position: pos,
        entryPrice: pos.averagePrice || 0,
        side: isLong ? 'long' : 'short',
        size: Math.abs(pos.size || 0),
        stopOrders,
        limitOrders,
        workingOrders
      });
    });

    // If no positions but have orders, show orphan orders grouped by contract
    if (positions.length === 0 && orders.length > 0) {
      const ordersByContract = new Map<string, Order[]>();
      orders.forEach(o => {
        const key = o.contractId || 'unknown';
        if (!ordersByContract.has(key)) {
          ordersByContract.set(key, []);
        }
        ordersByContract.get(key)!.push(o);
      });

      ordersByContract.forEach((contractOrders, contractId) => {
        groups.push({
          contractId,
          position: null,
          entryPrice: 0,
          side: 'long',
          size: 0,
          stopOrders: contractOrders.filter(o =>
            o.type === ORDER_TYPE.STOP || o.type === ORDER_TYPE.STOP_LIMIT
          ),
          limitOrders: contractOrders.filter(o =>
            o.type === ORDER_TYPE.LIMIT
          ),
          workingOrders: contractOrders.filter(o =>
            o.type === ORDER_TYPE.MARKET
          )
        });
      });
    }

    return groups;
  }, [orders, positions]);

  const handleCancelOrder = async (orderId: number | string) => {
    if (!window.confirm(`Cancel order ${orderId}?`)) {
      return;
    }

    setCancelingOrderId(Number(orderId));

    try {
      const response = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to cancel order');
      }

      if (data.success) {
        await fetchAll();
      }
    } catch (error) {
      console.error('Cancel order error:', error);
      alert(error instanceof Error ? error.message : 'Failed to cancel order');
    } finally {
      setCancelingOrderId(null);
    }
  };

  const formatPrice = (price: number | undefined) => {
    if (price === undefined || price === null) return '-';
    return `$${price.toFixed(2)}`;
  };

  const getOrderTypeLabel = (type: number | undefined) => {
    switch (type) {
      case ORDER_TYPE.LIMIT: return 'LIMIT';
      case ORDER_TYPE.MARKET: return 'MARKET';
      case ORDER_TYPE.STOP: return 'STOP';
      case ORDER_TYPE.STOP_LIMIT: return 'STOP-LMT';
      case ORDER_TYPE.TRAILING: return 'TRAIL';
      default: return 'UNKNOWN';
    }
  };

  const getShortSymbol = (contractId: string) => {
    if (contractId.includes('MGC')) return 'MGC';
    if (contractId.includes('MYM')) return 'MYM';
    if (contractId.includes('YM')) return 'YM';
    if (contractId.includes('ES')) return 'ES';
    if (contractId.includes('NQ')) return 'NQ';
    return contractId.split('.').pop() || contractId;
  };

  return (
    <div className={`bg-trading-bg border-l border-trading-neutral/30 p-3 overflow-y-auto ${className} relative grayscale opacity-50 pointer-events-none`}>
      {/* DISABLED OVERLAY */}
      <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
        <div className="bg-gray-900/90 border border-white/10 px-3 py-1.5 rounded-lg shadow-2xl">
          <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest text-center block">Positions API Disabled</span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-trading-text flex items-center gap-2">
          <ShoppingCart className="w-4 h-4" />
          Positions & Orders
        </h3>
        <button
          onClick={() => fetchAll()}
          disabled={isRefreshing}
          className="text-xs text-trading-neutral hover:text-trading-text transition-colors px-2 py-0.5 rounded hover:bg-gray-800/50 flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Account Indicator */}
      {selectedAccount && (
        <div className="mb-3 bg-gray-800/50 border border-gray-700/50 rounded px-2 py-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Account:</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold">{selectedAccount.name}</span>
              {selectedAccount.isPaper && (
                <span className="bg-orange-500/20 text-orange-400 text-[10px] px-1 py-0 rounded border border-orange-500/30 uppercase font-bold">
                  Paper
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <div className="text-sm text-trading-neutral">Loading...</div>
        </div>
      ) : positionGroups.length === 0 && orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-trading-neutral">
          <ShoppingCart className="w-8 h-8 mb-2 opacity-50" />
          <div className="text-xs">No positions or orders</div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Position Groups */}
          {positionGroups.map((group, idx) => (
            <div key={group.contractId + idx} className="bg-gray-800/30 rounded-lg border border-gray-700/50 overflow-hidden">
              {/* Position Header */}
              {group.position && (
                <div className={`p-2 border-b border-gray-700/50 ${
                  group.side === 'long' ? 'bg-green-900/20' : 'bg-red-900/20'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {group.side === 'long' ? (
                        <TrendingUp className="w-4 h-4 text-green-400" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-400" />
                      )}
                      <span className="font-bold text-white">
                        {getShortSymbol(group.contractId)}
                      </span>
                      <span className={`text-xs font-semibold ${
                        group.side === 'long' ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {group.side.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">Size</div>
                      <div className="text-sm font-bold text-white">{group.size}</div>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <div>
                      <span className="text-xs text-gray-400">Entry: </span>
                      <span className="text-sm font-semibold text-white">
                        {formatPrice(group.entryPrice)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* No Position Header */}
              {!group.position && (
                <div className="p-2 border-b border-gray-700/50 bg-gray-800/50">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-gray-400" />
                    <span className="font-medium text-gray-300">
                      {getShortSymbol(group.contractId)}
                    </span>
                    <span className="text-xs text-gray-500">No Position</span>
                  </div>
                </div>
              )}

              {/* Orders Section */}
              <div className="p-2 space-y-2">
                {/* Stop Loss Orders */}
                {group.stopOrders.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <Shield className="w-3 h-3 text-red-400" />
                      <span className="text-[10px] font-semibold text-red-400 uppercase">
                        Stop Loss ({group.stopOrders.length})
                      </span>
                    </div>
                    {group.stopOrders.map((order) => (
                      <div
                        key={order.id || order.orderId}
                        className="flex items-center justify-between bg-red-900/10 rounded px-2 py-1 border border-red-900/30"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400">
                            {getOrderTypeLabel(order.type)}
                          </span>
                          <span className="text-xs font-bold text-red-400">
                            {formatPrice(order.stopPrice || order.limitPrice)}
                          </span>
                          <span className="text-[10px] text-gray-500">x{order.size}</span>
                        </div>
                        <button
                          onClick={() => handleCancelOrder(order.id || order.orderId || 0)}
                          disabled={cancelingOrderId === (order.id || order.orderId)}
                          className="p-0.5 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition-colors"
                          title="Cancel Order"
                        >
                          {cancelingOrderId === (order.id || order.orderId) ? (
                            <div className="w-3 h-3 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                          ) : (
                            <XCircle size={12} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Take Profit Orders */}
                {group.limitOrders.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <Target className="w-3 h-3 text-green-400" />
                      <span className="text-[10px] font-semibold text-green-400 uppercase">
                        Take Profit ({group.limitOrders.length})
                      </span>
                    </div>
                    {group.limitOrders.map((order) => (
                      <div
                        key={order.id || order.orderId}
                        className="flex items-center justify-between bg-green-900/10 rounded px-2 py-1 border border-green-900/30"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400">
                            {getOrderTypeLabel(order.type)}
                          </span>
                          <span className="text-xs font-bold text-green-400">
                            {formatPrice(order.limitPrice)}
                          </span>
                          <span className="text-[10px] text-gray-500">x{order.size}</span>
                        </div>
                        <button
                          onClick={() => handleCancelOrder(order.id || order.orderId || 0)}
                          disabled={cancelingOrderId === (order.id || order.orderId)}
                          className="p-0.5 rounded hover:bg-green-500/20 text-green-400/60 hover:text-green-400 transition-colors"
                          title="Cancel Order"
                        >
                          {cancelingOrderId === (order.id || order.orderId) ? (
                            <div className="w-3 h-3 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                          ) : (
                            <XCircle size={12} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Working/Pending Orders */}
                {group.workingOrders.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <ShoppingCart className="w-3 h-3 text-yellow-400" />
                      <span className="text-[10px] font-semibold text-yellow-400 uppercase">
                        Working ({group.workingOrders.length})
                      </span>
                    </div>
                    {group.workingOrders.map((order) => (
                      <div
                        key={order.id || order.orderId}
                        className="flex items-center justify-between bg-yellow-900/10 rounded px-2 py-1 border border-yellow-900/30"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400">
                            {getOrderTypeLabel(order.type)}
                          </span>
                          <span className={`text-[10px] ${
                            order.side === ORDER_SIDE.BUY ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {order.side === ORDER_SIDE.BUY ? 'BUY' : 'SELL'}
                          </span>
                          <span className="text-xs font-bold text-yellow-400">
                            {formatPrice(order.limitPrice || order.stopPrice)}
                          </span>
                          <span className="text-[10px] text-gray-500">x{order.size}</span>
                        </div>
                        <button
                          onClick={() => handleCancelOrder(order.id || order.orderId || 0)}
                          disabled={cancelingOrderId === (order.id || order.orderId)}
                          className="p-0.5 rounded hover:bg-yellow-500/20 text-yellow-400/60 hover:text-yellow-400 transition-colors"
                          title="Cancel Order"
                        >
                          {cancelingOrderId === (order.id || order.orderId) ? (
                            <div className="w-3 h-3 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
                          ) : (
                            <XCircle size={12} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* No orders message */}
                {group.stopOrders.length === 0 && group.limitOrders.length === 0 && group.workingOrders.length === 0 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    No associated orders
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Orphan orders without position groups */}
          {positionGroups.length === 0 && orders.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold text-gray-500 uppercase">
                Open Orders ({orders.length})
              </h4>
              {orders.map((order) => (
                <div
                  key={order.id || order.orderId}
                  className="bg-gray-800/30 rounded p-2 border border-gray-700/50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">
                        {getShortSymbol(order.contractId || '')}
                      </span>
                      <span className={`text-xs ${
                        order.side === ORDER_SIDE.BUY ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {order.side === ORDER_SIDE.BUY ? 'BUY' : 'SELL'}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {getOrderTypeLabel(order.type)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleCancelOrder(order.id || order.orderId || 0)}
                      disabled={cancelingOrderId === (order.id || order.orderId)}
                      className="p-1 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition-colors"
                      title="Cancel Order"
                    >
                      {cancelingOrderId === (order.id || order.orderId) ? (
                        <div className="w-3 h-3 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                      ) : (
                        <XCircle size={14} />
                      )}
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs">
                    <span className="text-gray-400">
                      Price: <span className="text-white">{formatPrice(order.limitPrice || order.stopPrice)}</span>
                    </span>
                    <span className="text-gray-400">
                      Size: <span className="text-white">{order.size}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
