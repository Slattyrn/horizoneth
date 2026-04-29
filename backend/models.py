from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class TickData(BaseModel):
    """Real-time tick data from SignalR"""
    symbol: str
    timestamp: datetime
    price: float
    volume: Optional[int] = 0
    bid: Optional[float] = None
    ask: Optional[float] = None
    bid_size: Optional[int] = None
    ask_size: Optional[int] = None


class CandleData(BaseModel):
    """Candlestick data"""
    time: int  # Unix timestamp
    open: float
    high: float
    low: float
    close: float
    volume: int


class AccountInfo(BaseModel):
    """Account information"""
    account_id: str
    balance: float
    equity: float
    pnl: float
    margin_available: float
    margin_used: float


class OrderRequest(BaseModel):
    """Order placement request"""
    contractId: str  # Full contract format: CON.F.US.MES.Z25
    side: str  # "buy" or "sell"
    quantity: int
    orderType: str  # "market", "limit", "stop", "stop-limit"
    price: Optional[float] = None  # Limit price for limit/stop-limit orders
    stopPrice: Optional[float] = None  # Stop price for stop/stop-limit orders
    stopLoss: Optional[float] = None  # Stop loss bracket price
    takeProfit: Optional[float] = None  # Take profit bracket price
    accountId: Optional[int] = None  # Account ID (auto-detected if not provided)
    customTag: Optional[str] = None  # Custom tag for duplicate prevention


class OrderResponse(BaseModel):
    """Order response"""
    order_id: str
    symbol: str
    side: str
    quantity: int
    status: str
    filled_quantity: int
    average_price: Optional[float] = None


class ConnectionStatus(BaseModel):
    """Connection status"""
    connected: bool
    signalr_connected: bool
    last_heartbeat: datetime
    reconnect_attempts: int
    message: str


class HistoryRequest(BaseModel):
    """Historical data request"""
    symbol: str
    interval: str  # "1", "5", "15", "60", "D"
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    limit: Optional[int] = 1000
