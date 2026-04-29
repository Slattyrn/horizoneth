import asyncio
import json
import logging
import os
import time
from dotenv import load_dotenv
from signalrcore.hub_connection_builder import HubConnectionBuilder

# --------------------------------------------------------------------
# Logging setup
# --------------------------------------------------------------------
logger = logging.getLogger("signalr_manager")

# --------------------------------------------------------------------
# Load environment
# --------------------------------------------------------------------
load_dotenv()

PROJECTX_SIGNALR_URL = os.getenv("PROJECTX_SIGNALR_URL", "wss://rtc.topstepx.com/hubs/market")
PROJECTX_TOKEN = os.getenv("PROJECTX_TOKEN")
DEFAULT_CONTRACT = os.getenv("DEFAULT_CONTRACT", "CON.F.US.MGC.M26")
YM_CONTRACT = os.getenv("YM_CONTRACT", "CON.F.US.YM.M26")

# MGC-only subscription — Horizon Eth terminal.
ACTIVE_CONTRACTS = [
    os.getenv("MGC_CONTRACT", "CON.F.US.MGC.M26"),
]

# --------------------------------------------------------------------
# SignalR Manager - ORIGINAL WORKING VERSION
# --------------------------------------------------------------------
class SignalRManager:
    """Handles the live SignalR connection to TopstepX Market Hub."""

    def __init__(self):
        self._hub = None
        self._connected = False
        self._loop = None
        self._contracts = list(ACTIVE_CONTRACTS)  # MYM + MES dual subscription
        self._reconnect_attempts = 0
        self._max_reconnect_attempts = 999  # Effectively infinite
        self._is_reconnecting = False
        self._auth_token = None
        self._broadcast_callback = None
        self._tick_count = 0
        self._last_tick = None  # {ticker, price, timestamp} — for /api/debug/signalr-status

    def set_broadcast_callback(self, callback):
        """Set the callback function to broadcast ticks to frontend."""
        self._broadcast_callback = callback

    def connect(self, token: str = None):
        """Initialize and connect to the SignalR hub - SYNCHRONOUS VERSION."""
        # Use provided token or fall back to env
        auth_token = token or PROJECTX_TOKEN

        if not auth_token:
            logger.error("❌ Missing PROJECTX_TOKEN in .env")
            return

        # Store token for reconnection
        self._auth_token = auth_token

        logger.info(f"Connecting to hub: {PROJECTX_SIGNALR_URL}")

        # Build connection - USE ACCESS TOKEN IN URL
        # ⚡ AGGRESSIVE KEEP-ALIVE: 5-second ping to prevent timeout after 9 hours
        self._connection = HubConnectionBuilder() \
            .with_url(
                f"{PROJECTX_SIGNALR_URL}?access_token={auth_token}",
                options={
                    "skip_negotiation": True,
                    "transport": "websockets"
                }
            ) \
            .with_automatic_reconnect({
                "type": "raw",
                "keep_alive_interval": 5,  # Changed from 10 to 5 seconds
                "reconnect_interval": 5,
                "max_attempts": self._max_reconnect_attempts
            }) \
            .build()

        self._hub = self._connection
        self._hub.on_open(self._on_open)
        self._hub.on_close(self._on_close)
        self._hub.on_error(self._on_error)

        # Register event handlers
        self._hub.on("GatewayQuote", self._on_quote)
        self._hub.on("GatewayTrade", self._on_trade)
        self._hub.on("GatewayDepth", self._on_depth)

        # START CONNECTION - SYNCHRONOUS
        try:
            self._hub.start()
            time.sleep(2)  # wait for the socket to fully start
            self._connected = True
            self._reconnect_attempts = 0

            # Subscribe to contract after connection
            self._subscribe()
        except Exception as e:
            logger.error(f"❌ Connection failed: {e}")
            self._attempt_reconnect()

    def _subscribe(self):
        """Subscribe to market data streams for all ACTIVE_CONTRACTS (MYM + MES) - SYNCHRONOUS VERSION."""
        if not self._hub:
            logger.error("Hub not initialized")
            return

        try:
            for contract in self._contracts:
                logger.info(f"📡 Subscribing to {contract}...")

                self._hub.send("SubscribeContractQuotes", [contract])
                logger.info(f"✅ Subscribed to {contract} quotes")

                self._hub.send("SubscribeContractTrades", [contract])
                logger.info(f"✅ Subscribed to {contract} trades")

                self._hub.send("SubscribeContractMarketDepth", [contract])
                logger.info(f"✅ Subscribed to {contract} depth")

        except Exception as e:
            logger.error(f"❌ Subscription failed: {e}")

    def disconnect(self):
        """Disconnect from the SignalR hub - SYNCHRONOUS VERSION."""
        if self._hub:
            try:
                for contract in self._contracts:
                    self._hub.send("UnsubscribeContractQuotes", [contract])
                    self._hub.send("UnsubscribeContractTrades", [contract])
                    self._hub.send("UnsubscribeContractMarketDepth", [contract])
                self._hub.stop()
                logger.info("🔌 Disconnected from SignalR hub")
            except Exception as e:
                logger.warning(f"Disconnect failed: {e}")

    def reconnect_with_new_token(self, new_token: str):
        """Disconnect and reconnect with a fresh token."""
        logger.info("🔄 Reconnecting SignalR with fresh token...")
        self.disconnect()
        time.sleep(2)  # Brief pause before reconnecting
        self.connect(new_token)
        logger.info("✅ SignalR reconnected with fresh token")

    # ---------------------------------------------------------------
    # Public status methods
    # ---------------------------------------------------------------
    def is_connected(self) -> bool:
        """Return whether SignalR is currently connected."""
        return self._connected

    # ---------------------------------------------------------------
    # Connection event handlers
    # ---------------------------------------------------------------
    def _on_open(self):
        """Handle connection opened event."""
        self._connected = True
        self._reconnect_attempts = 0
        logger.info("✅ SignalR connection established!")

    def _on_close(self):
        """Handle connection closed event."""
        self._connected = False
        logger.warning("⚠️ SignalR connection closed")

        # Attempt manual reconnection if not already reconnecting
        if not self._is_reconnecting:
            logger.info("🔄 Initiating manual reconnection...")
            self._attempt_reconnect()

    def _on_error(self, error):
        """Handle connection errors."""
        logger.error(f"❌ SignalR error: {error}")

        # If we get a connection closed error, attempt reconnect
        if "closed" in str(error).lower() and not self._is_reconnecting:
            logger.info("🔄 Connection error detected, reconnecting...")
            self._attempt_reconnect()

    def _attempt_reconnect(self):
        """Manually attempt to reconnect to SignalR with infinite retries."""
        if self._is_reconnecting:
            logger.info("⏸️ Reconnection already in progress, skipping...")
            return

        self._is_reconnecting = True
        self._reconnect_attempts += 1

        # 🚨 INFINITE RECONNECTION: Never give up (hands-off trading requirement)
        # Removed max attempts check - will retry forever until successful

        try:
            logger.info(f"🔄 Manual reconnection attempt #{self._reconnect_attempts}...")

            # Wait before reconnecting (exponential backoff, max 60s)
            wait_time = min(60, 5 * min(self._reconnect_attempts, 12))  # Cap at 60s
            logger.info(f"⏳ Waiting {wait_time}s before reconnect...")
            time.sleep(wait_time)

            # Disconnect cleanly
            if self._hub:
                try:
                    self._hub.stop()
                except:
                    pass

            # Reconnect using stored token
            time.sleep(2)
            self.connect(self._auth_token)

            logger.info("✅ Manual reconnection successful!")
            self._reconnect_attempts = 0  # Reset counter on success
            self._is_reconnecting = False

        except Exception as e:
            logger.error(f"❌ Manual reconnection failed: {e}")
            self._is_reconnecting = False
            # Health monitor will trigger retry on next check (30s interval)

    # ---------------------------------------------------------------
    # Quote handler - GatewayQuote
    # ---------------------------------------------------------------
    def _on_quote(self, args):
        """Handle GatewayQuote events."""
        try:
            # Handle different argument formats.
            # SignalR GatewayQuote typically sends [contractId, quoteData] so args[0]
            # is the contract string (e.g. "CON.F.US.MYM.M26") and args[1] is the dict.
            if isinstance(args, list):
                if len(args) == 0:
                    return
                # Keep the contract string as a fallback for ticker detection — the
                # quote data dict may omit the symbol field on some event types.
                contract_hint = str(args[0]) if not isinstance(args[0], dict) else ""
                quote = args[1] if len(args) > 1 else args[0]
            else:
                quote = args
                contract_hint = ""

            if not isinstance(quote, dict):
                return

            # Normalize timestamp to Unix seconds (UTC) - FIXED: Force UTC interpretation
            raw_timestamp = quote.get("timestamp") or quote.get("lastUpdated")
            if isinstance(raw_timestamp, str):
                from datetime import datetime, timezone
                try:
                    # Parse ISO8601 string and FORCE UTC timezone
                    if raw_timestamp.endswith('Z'):
                        # "2025-11-05T14:00:00Z" → UTC
                        dt = datetime.strptime(raw_timestamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                    elif '+' in raw_timestamp or raw_timestamp.count('-') > 2:
                        # "2025-11-05T14:00:00+00:00" → parse with timezone
                        dt = datetime.fromisoformat(raw_timestamp)
                        # Convert to UTC explicitly
                        dt = dt.astimezone(timezone.utc)
                    else:
                        # No timezone info → assume UTC
                        dt = datetime.fromisoformat(raw_timestamp).replace(tzinfo=timezone.utc)

                    # Convert to Unix timestamp (always in UTC)
                    normalized_timestamp = int(dt.timestamp())
                except Exception as e:
                    logger.warning(f"Failed to parse timestamp '{raw_timestamp}': {e}")
                    normalized_timestamp = int(datetime.now(timezone.utc).timestamp())
            elif isinstance(raw_timestamp, (int, float)):
                # Already Unix timestamp
                if raw_timestamp > 10**10:
                    normalized_timestamp = int(raw_timestamp // 1000)  # Milliseconds → seconds
                else:
                    normalized_timestamp = int(raw_timestamp)
            else:
                from datetime import datetime, timezone
                normalized_timestamp = int(datetime.now(timezone.utc).timestamp())

            # Determine ticker from symbol. Use contract_hint (args[0]) as the
            # authoritative source because we know exactly what we subscribed to.
            # The quote data dict may omit the symbol field on some event subtypes.
            symbol = quote.get("symbol") or quote.get("symbolName") or contract_hint or ""
            if "MYM" in symbol:
                ticker = "MYM"  # Micro Dow Jones
            elif "MES" in symbol:
                ticker = "MES"  # Micro E-mini S&P 500
            elif "MNQ" in symbol:
                ticker = "MNQ"  # Micro E-mini Nasdaq-100
            elif "MGC" in symbol:
                ticker = "MGC"  # Micro Gold (CME)
            elif "YM" in symbol:
                ticker = "YM"   # Mini Dow Jones (CBOT)
            else:
                # No recognisable ticker — log once and skip so we never broadcast
                # a "MGC" tick that would be silently dropped by the frontend.
                logger.warning(f"⚠️ Unknown symbol in quote args: {args!r:.200} — skipping")
                return

            # Price: try lastPrice first (standard GatewayQuote field), then fall back
            # to 'last' in case the API uses a different field name.
            price = quote.get("lastPrice") or quote.get("last") or quote.get("close") or quote.get("price")

            # Map to frontend format
            tick = {
                "symbol": quote.get("symbol"),
                "symbolName": quote.get("symbolName"),
                "ticker": ticker,  # Add ticker identifier (MYM active; MGC/MNQ/MES/YM detected if subscribed)
                "price": price,
                "lastPrice": price,
                "bid": quote.get("bestBid"),
                "ask": quote.get("bestAsk"),
                "change": quote.get("change"),
                "changePercent": quote.get("changePercent"),
                "open": quote.get("open"),
                "high": quote.get("high"),
                "low": quote.get("low"),
                "cumulativeVolume": quote.get("volume"),  # RESTORED: Cumulative daily volume for delta calculation
                "timestamp": normalized_timestamp,
                "type": "quote"
            }

            self._tick_count += 1
            self._last_tick = {"ticker": ticker, "price": price, "timestamp": normalized_timestamp}
            if self._tick_count % 50 == 1:
                logger.info(f"💹 Tick #{self._tick_count}: {ticker} @ {price}")

            # Use event loop to broadcast
            if self._loop and not self._loop.is_closed():
                asyncio.run_coroutine_threadsafe(self.broadcast_quote(tick), self._loop)
            else:
                logger.warning("⚠️ Event loop not available for broadcast")

        except Exception as e:
            logger.error(f"Quote handling failed: {e}", exc_info=True)

    def _on_trade(self, args):
        """Handle GatewayTrade events - CRITICAL for accurate volume."""
        try:
            if isinstance(args, list):
                if len(args) == 0:
                    return
                contract_hint = str(args[0]) if not isinstance(args[0], dict) else ""
                trade = args[1] if len(args) > 1 else args[0]
            else:
                trade = args
                contract_hint = ""

            if not isinstance(trade, dict):
                return

            # Extract trade volume (size of this individual trade)
            trade_volume = trade.get("volume") or 0
            trade_price = trade.get("price")

            # Normalize timestamp to Unix seconds (UTC) - SAME AS QUOTES
            raw_timestamp = trade.get("timestamp")
            if isinstance(raw_timestamp, str):
                from datetime import datetime, timezone
                try:
                    # Parse ISO8601 string and FORCE UTC timezone
                    if raw_timestamp.endswith('Z'):
                        dt = datetime.strptime(raw_timestamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                    elif '+' in raw_timestamp or raw_timestamp.count('-') > 2:
                        dt = datetime.fromisoformat(raw_timestamp)
                        dt = dt.astimezone(timezone.utc)
                    else:
                        dt = datetime.fromisoformat(raw_timestamp).replace(tzinfo=timezone.utc)
                    normalized_timestamp = int(dt.timestamp())
                except Exception as e:
                    logger.warning(f"Failed to parse trade timestamp '{raw_timestamp}': {e}")
                    normalized_timestamp = int(datetime.now(timezone.utc).timestamp())
            elif isinstance(raw_timestamp, (int, float)):
                if raw_timestamp > 10**10:
                    normalized_timestamp = int(raw_timestamp // 1000)  # Milliseconds → seconds
                else:
                    normalized_timestamp = int(raw_timestamp)
            else:
                from datetime import datetime, timezone
                normalized_timestamp = int(datetime.now(timezone.utc).timestamp())

            # Determine ticker from symbol — use contract_hint (args[0]) as fallback.
            symbol = trade.get("symbol") or contract_hint or ""
            if "MYM" in symbol:
                ticker = "MYM"  # Micro Dow Jones
            elif "MES" in symbol:
                ticker = "MES"  # Micro E-mini S&P 500
            elif "MNQ" in symbol:
                ticker = "MNQ"  # Micro E-mini Nasdaq-100
            elif "MGC" in symbol:
                ticker = "MGC"  # Micro Gold (CME)
            elif "YM" in symbol:
                ticker = "YM"   # Mini Dow Jones (CBOT)
            else:
                logger.warning(f"⚠️ Unknown symbol in trade args: {args!r:.200} — skipping")
                return

            logger.debug(f"💰 TRADE ({ticker}): {trade_volume} contracts @ ${trade_price}")

            tick = {
                "symbolId": trade.get("symbolId"),
                "symbol": trade.get("symbol"),
                "ticker": ticker,  # Add ticker identifier (MYM active; MGC/MNQ/MES/YM detected if subscribed)
                "price": trade_price,
                "tradeVolume": trade_volume,  # Individual trade size (e.g., 5, 10, 50 contracts)
                "type": "trade",
                "timestamp": normalized_timestamp  # FIXED: Now properly normalized to Unix seconds
            }

            if self._loop and not self._loop.is_closed():
                asyncio.run_coroutine_threadsafe(self.broadcast_quote(tick), self._loop)

        except Exception as e:
            logger.error(f"Trade handling failed: {e}")

    def _on_depth(self, args):
        """Handle GatewayDepth events."""
        try:
            logger.debug(f"📈 Depth received: {args}")
            # Depth handling logic here if needed
        except Exception as e:
            logger.error(f"Depth handling failed: {e}")

    # ---------------------------------------------------------------
    # Broadcast quotes to frontend
    # ---------------------------------------------------------------
    async def broadcast_quote(self, tick):
        """Send parsed tick data to all connected frontend clients."""
        try:
            if self._broadcast_callback:
                if asyncio.iscoroutinefunction(self._broadcast_callback):
                    await self._broadcast_callback(tick)
                else:
                    self._broadcast_callback(tick)
            else:
                logger.warning("⚠️ No broadcast callback set for SignalRManager")

        except Exception as e:
            logger.error(f"Broadcast error: {e}")
