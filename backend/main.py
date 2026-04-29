import asyncio
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Optional, List, Union

# ✅ all FastAPI imports must come before you declare connected_frontends
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from projectx_client import ProjectXClient
from signalr_manager import SignalRManager
from historical_export import export_historical_data as _export_historical_data

# --------------------------------------------------------------------
# Logging setup
# --------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("main")

# --------------------------------------------------------------------
# Load environment
# --------------------------------------------------------------------
load_dotenv(Path(__file__).resolve().parent / ".env")

PROJECTX_API_BASE = os.getenv("PROJECTX_API_BASE", "https://api.topstepx.com")
USERNAME = os.getenv("PROJECTX_USERNAME")
API_KEY = os.getenv("PROJECTX_API_KEY")
TOKEN = os.getenv("PROJECTX_TOKEN")
DEFAULT_CONTRACT = os.getenv("DEFAULT_CONTRACT", "CON.F.US.MGC.M26")

# --------------------------------------------------------------------
# App setup
# --------------------------------------------------------------------
app = FastAPI(title="Horizon Eth Terminal")
connected_frontends: list[WebSocket] = []

# In-memory cache for historical bars
# Key: f"{symbol}:{interval}" -> Value: list of bars
historical_bars_cache = {}

# In-memory cache for account data to avoid rate limiting
# Stores: 'account_list' -> (response_data, timestamp)
#         'default_account_id' -> (account_id, timestamp)
account_id_cache = {}
ACCOUNT_CACHE_TTL = 60  # seconds

# Orders cache: 'orders_{account_id}' -> (orders_data, timestamp)
orders_cache = {}
ORDERS_CACHE_TTL = 1  # seconds - poll once per second max

# --------------------------------------------------------------------
# SQLite Database for Candle Storage (Local Database)
# --------------------------------------------------------------------
DB_PATH = Path(__file__).resolve().parent / "candles.db"

def init_candle_db():
    """Initialize SQLite database for candle storage."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create candles table with unique constraint on symbol + timeframe + timestamp
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS candles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, timeframe, timestamp)
        )
    ''')

    # Create index for fast lookups
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_candles_lookup
        ON candles(symbol, timeframe, timestamp)
    ''')

    conn.commit()
    conn.close()
    logger.info(f"📦 Candle database initialized at {DB_PATH}")

# Initialize database on module load
init_candle_db()


# Allow CORS for all origins (for development purposes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------
# Global clients
# --------------------------------------------------------------------
projectx_client: ProjectXClient | None = None
signalr_manager: SignalRManager | None = None
http_client = httpx.AsyncClient(base_url=PROJECTX_API_BASE, timeout=30.0)

# --------------------------------------------------------------------
# Utility: Rate limit tracking and exponential backoff
# --------------------------------------------------------------------
last_rate_limit_time = None
consecutive_rate_limits = 0

async def make_api_call_with_retry(
    method: str,
    endpoint: str,
    headers: dict,
    json_data: dict = None,
    max_retries: int = 3
) -> httpx.Response:
    """
    Make an API call with exponential backoff for 429 rate limit errors.

    Args:
        method: HTTP method (GET, POST, etc.)
        endpoint: API endpoint path
        headers: Request headers
        json_data: Optional JSON payload
        max_retries: Maximum number of retry attempts

    Returns:
        httpx.Response object

    Raises:
        HTTPException: If all retries fail or non-429 error occurs
    """
    global last_rate_limit_time, consecutive_rate_limits

    for attempt in range(max_retries):
        try:
            # Make the API call
            if method.upper() == "POST":
                resp = await http_client.post(endpoint, json=json_data, headers=headers)
            elif method.upper() == "GET":
                resp = await http_client.get(endpoint, headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")

            # Check for rate limit error
            if resp.status_code == 429:
                consecutive_rate_limits += 1
                last_rate_limit_time = time.time()

                # Calculate exponential backoff: 1s, 2s, 4s, 8s...
                wait_time = min(2 ** attempt, 30)  # Cap at 30 seconds

                logger.warning(
                    f"⚠️ Rate limit hit (attempt {attempt + 1}/{max_retries}). "
                    f"Consecutive limits: {consecutive_rate_limits}. "
                    f"Waiting {wait_time}s before retry..."
                )

                if attempt < max_retries - 1:
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    # Final attempt failed
                    logger.error(f"❌ Rate limit persists after {max_retries} attempts. Giving up.")
                    raise HTTPException(
                        status_code=429,
                        detail=f"ProjectX API rate limit exceeded. Please try again in {wait_time}s."
                    )

            # Success - reset rate limit tracking
            if resp.status_code == 200:
                if consecutive_rate_limits > 0:
                    logger.info(f"✅ API call succeeded after {consecutive_rate_limits} previous rate limits")
                consecutive_rate_limits = 0
                last_rate_limit_time = None

            return resp

        except httpx.HTTPError as e:
            logger.error(f"HTTP error on attempt {attempt + 1}: {str(e)}")
            if attempt == max_retries - 1:
                raise HTTPException(status_code=500, detail=f"API request failed: {str(e)}")
            await asyncio.sleep(2 ** attempt)

    # Should never reach here, but just in case
    raise HTTPException(status_code=500, detail="API request failed after all retries")

# --------------------------------------------------------------------
# Utility: Token handling - STABLE VERSION
# --------------------------------------------------------------------
_token_timestamp: float = 0
TOKEN_REFRESH_INTERVAL = 23 * 3600  # 23 hours

async def get_auth_token() -> str:
    """Get or refresh ProjectX auth token (23-hour lifecycle)."""
    global TOKEN, _token_timestamp

    # Check if token is still valid (< 23 hours old)
    token_age = time.time() - _token_timestamp if _token_timestamp > 0 else float('inf')

    if TOKEN and token_age < TOKEN_REFRESH_INTERVAL:
        return TOKEN

    # Fetch new token
    if _token_timestamp > 0:
        logger.info(f"🔄 Token expired (age: {int(token_age / 3600)}h), refreshing...")
    else:
        logger.info("🔑 Fetching initial ProjectX token...")

    payload = {"userName": USERNAME, "apiKey": API_KEY}
    resp = await http_client.post("/api/Auth/loginKey", json=payload)
    data = resp.json()

    if not data.get("success"):
        logger.error(f"❌ Auth failed: {data}")
        raise HTTPException(status_code=401, detail="Authentication failed")

    TOKEN = data["token"]
    _token_timestamp = time.time()
    logger.info(f"✅ Token fetched successfully (valid for 23 hours)")

    return TOKEN

# --------------------------------------------------------------------
# WebSocket Endpoint - BULLETPROOF VERSION
# --------------------------------------------------------------------
@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """Frontend connects here to receive real-time quotes."""
    await websocket.accept()
    connected_frontends.append(websocket)
    logger.info(f"✅ Frontend connected to /ws/live (total: {len(connected_frontends)})")

    try:
        # Keep connection alive indefinitely
        while True:
            # Wait for any message from client (this keeps the connection open)
            message = await websocket.receive_text()

            # Respond to pings
            if message == "ping":
                await websocket.send_text("pong")
                logger.debug("Received ping, sent pong")
                
    except WebSocketDisconnect:
        logger.info("Client disconnected normally")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        # Always clean up
        try:
            if websocket in connected_frontends:
                connected_frontends.remove(websocket)
            logger.info(f"🔌 Frontend disconnected from /ws/live (remaining: {len(connected_frontends)})")
        except Exception as cleanup_error:
            logger.error(f"Cleanup error: {cleanup_error}")

# --------------------------------------------------------------------
# Lifespan (startup / shutdown)
# --------------------------------------------------------------------
async def proactive_token_refresh():
    """Background task to refresh token every 22 hours (before 23-hour expiration)."""
    global signalr_manager

    while True:
        try:
            # Wait 22 hours before refreshing token
            await asyncio.sleep(22 * 3600)  # 22 hours in seconds

            logger.info("🔄 Proactive token refresh starting (22-hour cycle)...")

            # Fetch fresh token
            fresh_token = await get_auth_token()

            # Reconnect SignalR with new token
            if signalr_manager:
                logger.info("♻️ Reconnecting SignalR with fresh token...")
                await asyncio.to_thread(signalr_manager.reconnect_with_new_token, fresh_token)
                logger.info("✅ Proactive token refresh complete - connection renewed")

        except Exception as e:
            logger.error(f"Proactive token refresh error: {e}")
            # Don't crash - will retry in next cycle

async def monitor_signalr_health():
    """Background task to monitor SignalR connection health and reconnect if needed.

    Runs indefinitely with 30-second checks. Will keep attempting reconnection
    forever until successful (hands-off trading requirement).
    """
    global signalr_manager

    while True:
        try:
            await asyncio.sleep(30)  # Check every 30 seconds (faster monitoring)

            if signalr_manager and not signalr_manager._connected:
                logger.warning("⚠️ SignalR disconnected detected by health monitor")

                # Attempt reconnection in background thread (INFINITE RETRIES)
                if not signalr_manager._is_reconnecting:
                    logger.info("🔄 Health monitor triggering reconnection...")
                    fresh_token = await get_auth_token()
                    await asyncio.to_thread(signalr_manager.reconnect_with_new_token, fresh_token)
                else:
                    logger.info("⏸️ Reconnection already in progress, health monitor waiting...")

        except Exception as e:
            logger.error(f"❌ Health monitor error: {e}")
            # Health monitor NEVER crashes - continues monitoring even after errors
            continue

@app.on_event("startup")
async def startup_event():
    logger.info("Starting Horizon Alpha Terminal backend...")

    # Initialize Project X REST client
    global projectx_client
    projectx_client = ProjectXClient()
    await projectx_client.login_with_key()
    logger.info("Project X authentication successful")

    # Initialize and connect SignalR with the current event loop
    global signalr_manager
    loop = asyncio.get_running_loop()
    signalr_manager = SignalRManager()
    signalr_manager._loop = loop  # Explicitly set the loop
    
    # Define broadcast callback
    async def broadcast_to_frontends(data):
        """Callback for SignalRManager to broadcast data to frontends."""
        dead_clients = []
        # Create a copy of the list to avoid modification during iteration
        current_clients = list(connected_frontends)

        if not current_clients:
            return

        # logger.debug(f"📡 Broadcasting to {len(current_clients)} clients") # specific log for debugging 
        
        for ws in current_clients:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.error(f"Failed to send to client: {e}")
                dead_clients.append(ws)
        
        # Cleanup dead connections
        for ws in dead_clients:
            if ws in connected_frontends:
                connected_frontends.remove(ws)

    signalr_manager.set_broadcast_callback(broadcast_to_frontends)

    logger.info(f"Set event loop for SignalR: {loop}")

    # Get fresh token and connect
    fresh_token = await get_auth_token()
    await asyncio.to_thread(signalr_manager.connect, fresh_token)
    logger.info("SignalR connection established")

    # 🚨 VALIDATE CONTRACT CONFIGURATION
    logger.info(f"📋 Dual-ticker mode: MYM + MES")
    logger.info(f"📊 MYM (Micro Dow - CBOT)  | tick 1.00 | $0.50/tick | $0.50/pt")
    logger.info(f"📊 MES (Micro E-mini S&P 500 - CME) | tick 0.25 | $1.25/tick | $5.00/pt")
    logger.info(f"📅 Contract Month: M26 (June 2026)")

    # Verify contract is subscribed in SignalR
    if signalr_manager and signalr_manager._contracts:
        subscribed_contracts = ', '.join(signalr_manager._contracts)
        logger.info(f"✅ SignalR subscribed to: {subscribed_contracts}")
        if DEFAULT_CONTRACT not in signalr_manager._contracts:
            logger.warning(f"⚠️ DEFAULT_CONTRACT ({DEFAULT_CONTRACT}) not in SignalR subscriptions!")
    else:
        logger.warning("⚠️ SignalR manager has no active contract subscriptions")

    # Start connection health monitor (every 30 seconds)
    asyncio.create_task(monitor_signalr_health())
    logger.info("🏥 Health monitor started (30-second intervals)")

    # Start proactive token refresh (every 22 hours)
    asyncio.create_task(proactive_token_refresh())
    logger.info("♻️ Proactive token refresh started (22-hour cycle)")

    logger.info("Backend initialization complete - 24/7 operation ready.")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down backend...")
    try:
        if signalr_manager:
            await asyncio.to_thread(signalr_manager.disconnect)
    except Exception:
        pass
    try:
        if projectx_client:
            await projectx_client.close()
    except Exception:
        pass
    await http_client.aclose()
    logger.info("Shutdown complete.")

# --------------------------------------------------------------------
# REAL PROJECT X API ROUTES
# --------------------------------------------------------------------

@app.post("/api/signalr/reconnect")
async def reconnect_signalr():
    """Force SignalR to reconnect - useful after pulling historical data."""
    global signalr_manager
    try:
        if signalr_manager:
            logger.info("🔄 Forcing SignalR reconnection...")
            fresh_token = await get_auth_token()
            await asyncio.to_thread(signalr_manager.reconnect_with_new_token, fresh_token)
            logger.info("✅ SignalR reconnected successfully")
            return {"success": True, "message": "SignalR reconnected"}
        else:
            return {"success": False, "message": "SignalR manager not initialized"}
    except Exception as e:
        logger.error(f"❌ SignalR reconnection failed: {e}")
        return {"success": False, "message": str(e)}

@app.get("/api/config")
async def get_config():
    """Return backend configuration for frontend.

    Tick values are returned for BOTH active tickers. Frontend reads per-ticker
    config from its own registry (frontend/src/config/tickers.ts) — these
    values are mirrored here for backend-side sanity checks only.
    """
    return {
        "defaultContract": DEFAULT_CONTRACT,
        "apiBase": PROJECTX_API_BASE,
        "tickers": {
            "MYM": {"contract": "CON.F.US.MYM.M26", "tickSize": 1.0, "tickValue": 0.50},
            "MES": {"contract": "CON.F.US.MES.M26", "tickSize": 0.25, "tickValue": 1.25},
        },
        # Legacy fields kept for any consumer still reading the flat shape.
        # MYM values chosen as safe default (integer tick grid rejects nothing from MES's 0.25 grid).
        "tickValue": 0.50,
        "tickSize": 1.0,
    }

@app.get("/api/account")
async def get_account():
    """
    Fetch all active accounts for the authenticated user.

    Note: Results are cached for 60 seconds to avoid ProjectX rate limiting.

    Returns:
        {
            "success": bool,
            "accounts": [
                {
                    "id": int,
                    "name": str,
                    "balance": float,
                    "isPaper": bool,
                    "accountNumber": str,
                    "equity": float,
                    "buyingPower": float
                },
                ...
            ]
        }
    """
    # Check cache first (with TTL)
    cache_key = 'account_list'

    if cache_key in account_id_cache:
        cached_data, cached_time = account_id_cache[cache_key]
        if time.time() - cached_time < ACCOUNT_CACHE_TTL:
            logger.info(f"📦 Returning CACHED account list ({len(cached_data.get('accounts', []))} accounts, age: {int(time.time() - cached_time)}s)")
            return cached_data
        else:
            logger.info(f"⏰ Account list cache expired (age: {int(time.time() - cached_time)}s)")
            del account_id_cache[cache_key]

    # Cache miss or expired - fetch from API
    token = await get_auth_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"onlyActiveAccounts": True}

    resp = await make_api_call_with_retry("POST", "/api/Account/search", headers, payload)

    # Check response status
    if resp.status_code != 200:
        logger.error(f"ProjectX API returned {resp.status_code}: {resp.text}")
        raise HTTPException(status_code=resp.status_code, detail="Failed to fetch accounts from ProjectX")

    # Safely parse JSON
    try:
        data = resp.json()
    except Exception as e:
        logger.error(f"Failed to parse JSON response: {resp.text[:200]}")
        raise HTTPException(status_code=500, detail=f"Invalid response from ProjectX API: {str(e)}")

    if not data.get("success"):
        logger.error(f"Account fetch failed: {data}")
        raise HTTPException(status_code=400, detail=data)

    raw_accounts = data.get("accounts", [])

    # Transform accounts to frontend-friendly format with metadata
    transformed_accounts = []
    for acc in raw_accounts:
        # Detect if paper trading account based on name or account type
        account_name = acc.get("name") or acc.get("accountNumber") or "Trading Account"
        is_paper = (
            "paper" in account_name.lower() or
            "demo" in account_name.lower() or
            "sim" in account_name.lower() or
            "prac" in account_name.lower() or
            acc.get("accountType", "").lower() in ["paper", "demo", "simulated", "practice"]
        )

        transformed_accounts.append({
            "id": acc.get("id"),
            "name": account_name,
            "balance": acc.get("balance") or acc.get("netLiquidation") or 0,
            "isPaper": is_paper,
            "accountNumber": acc.get("accountNumber", "N/A"),
            "equity": acc.get("equity") or acc.get("netLiquidation") or 0,
            "buyingPower": acc.get("buyingPower", 0),
            "unrealizedPnl": acc.get("unrealizedPnl", 0),
            "realizedPnl": acc.get("realizedPnl", 0),
            "marginUsed": acc.get("marginUsed", 0)
        })

    logger.info(f"✅ Retrieved {len(transformed_accounts)} accounts (Paper: {sum(1 for a in transformed_accounts if a['isPaper'])}, Live: {sum(1 for a in transformed_accounts if not a['isPaper'])})")

    # Cache the response AND the default account ID
    response_data = {
        "success": True,
        "accounts": transformed_accounts
    }
    account_id_cache['account_list'] = (response_data, time.time())
    logger.info(f"💾 Cached account list for {ACCOUNT_CACHE_TTL} seconds")

    # Also cache the first account ID as default to prevent redundant API calls
    if transformed_accounts:
        default_id = transformed_accounts[0]['id']
        account_id_cache['default_account_id'] = (default_id, time.time())
        logger.info(f"💾 Cached default account ID: {default_id}")

    return response_data

@app.get("/api/positions")
async def get_positions(account_id: Optional[int] = None):
    """
    DISABLED: Fetch current positions.
    Returns empty list to 'grey out' this feature.
    """
    logger.info(f"📊 Positions API called (DISABLED) for account {account_id}")
    return []

@app.get("/api/positions/monitor")
async def monitor_positions(account_id: Optional[int] = None):
    """
    DISABLED: Monitor open positions.
    Returns disabled status to 'grey out' this feature.
    """
    return {"success": False, "positions": [], "accountId": account_id, "status": "disabled"}

@app.get("/api/orders")
async def search_orders(request: dict):
    """
    Direct proxy to ProjectX /api/Order/search endpoint - 100% match to ProjectX API.

    Request Body (matches ProjectX exactly):
        {
            "accountId": int (required),
            "startTimestamp": datetime string (required, ISO 8601 format),
            "endTimestamp": datetime string (optional, ISO 8601 format)
        }

    Returns: Raw ProjectX response
        {
            "orders": [{
                "id": int,
                "accountId": int,
                "contractId": string,
                "status": int (1=NEW, 2=PARTIALLY_FILLED, 3=FILLED, 4=CANCELLED, 5=REJECTED),
                "type": int (1=LIMIT, 2=MARKET, 4=STOP),
                "side": int (0=BUY, 1=SELL),
                "size": int,
                "fillVolume": int,
                "filledPrice": float,
                "customTag": string (optional)
            }],
            "success": bool
        }
    """
    token = await get_auth_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    logger.info(f"🔍 Searching orders for account {request.get('accountId')} (ProjectX /api/Order/search)")

    # Forward request directly to ProjectX - no modifications
    resp = await make_api_call_with_retry(
        "POST",
        "/api/Order/search",
        headers,
        request
    )

    if resp.status_code != 200:
        logger.error(f"❌ Order search failed: {resp.status_code} - {resp.text}")
        raise HTTPException(status_code=resp.status_code, detail=f"ProjectX API error: {resp.text}")

    data = resp.json()

    # Log result count
    order_count = len(data.get("orders", []))
    logger.info(f"✅ Found {order_count} orders")

    # Return raw ProjectX response (no modifications)
    return data

# REMOVED: Legacy /api/orders/monitor endpoint - no longer needed
# Use /api/orders (searchOpen) for checking open orders instead

@app.get("/api/history/bars")
async def get_historical_bars(
    symbol: str = DEFAULT_CONTRACT,
    interval: int = 5,
    limit: int = 10000
):
    """
    Fetch historical bar data with gap-filling logic.
    
    Strategy:
    1. Get ALL accumulated bars from SQLite (can exceed API limits over time)
    2. Find the most recent timestamp in SQLite
    3. Fetch from API to fill gaps between last stored bar and now
    4. Merge, deduplicate, store new bars
    5. Return complete dataset for chart display
    """
    from datetime import datetime, timezone, timedelta
    
    try:
        # Get timeframe string
        tf_str = f"{interval}m"
        if interval == 60:
            tf_str = "60m"
        elif interval == 240:
            tf_str = "240m"
        elif interval >= 1440:
            tf_str = "D"
        
        interval_seconds = interval * 60
        
        # ===== STEP 1: Get ALL bars from SQLite =====
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT timestamp, open, high, low, close, volume
            FROM candles
            WHERE symbol = ? AND timeframe = ?
            ORDER BY timestamp ASC
        ''', (symbol, tf_str))
        
        rows = cursor.fetchall()
        conn.close()
        
        # Build a map of existing bars (keyed by timestamp)
        bars_map = {}
        latest_stored_ts = 0
        
        for row in rows:
            ts = row[0]
            # Handle both ISO string and integer timestamps
            if isinstance(ts, str):
                try:
                    ts = int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp())
                except:
                    continue
            bars_map[ts] = {
                "t": ts,
                "o": row[1],
                "h": row[2],
                "l": row[3],
                "c": row[4],
                "v": row[5] or 0
            }
            if ts > latest_stored_ts:
                latest_stored_ts = ts
        
        logger.info(f"📦 SQLite has {len(bars_map)} stored bars for {symbol} {tf_str}")
        
        # ===== STEP 2: Determine if we need to fetch from API =====
        now_ts = int(datetime.now(timezone.utc).timestamp())
        gap_seconds = now_ts - latest_stored_ts if latest_stored_ts > 0 else float('inf')
        gap_bars = gap_seconds // interval_seconds
        
        # Fetch from API if:
        # - No data in SQLite (cold start)
        # - Gap is more than 2 bars (need to fill)
        should_fetch = len(bars_map) == 0 or gap_bars > 2
        
        if should_fetch:
            logger.info(f"🔄 Gap detected: {gap_bars} bars missing. Fetching from API...")
            
            token = await get_auth_token()
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
            
            # Calculate fetch window
            end_time = datetime.now(timezone.utc)
            if latest_stored_ts > 0:
                # Fetch from last stored bar to now (with small overlap)
                start_time = datetime.fromtimestamp(latest_stored_ts - interval_seconds * 5, tz=timezone.utc)
            else:
                # Cold start: fetch as much as API allows (7 days)
                start_time = end_time - timedelta(days=7)
            
            # Get account ID (cached path)
            account_id = None
            if 'default_account_id' in account_id_cache:
                account_id = account_id_cache['default_account_id']
            else:
                try:
                    account_resp = await http_client.post(
                        "/api/Account/search",
                        json={"onlyActiveAccounts": True},
                        headers=headers
                    )
                    account_data = account_resp.json()
                    if account_data.get("success") and account_data.get("accounts"):
                        account_id = account_data["accounts"][0]["id"]
                        account_id_cache['default_account_id'] = account_id
                except Exception as e:
                    logger.warning(f"Could not fetch account ID: {e}")
            
            payload = {
                "contractId": symbol,
                "startTime": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "endTime": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "unit": 2,
                "unitNumber": interval,
                "limit": min(limit, 10000),
                "live": False,
                "includePartialBar": True  # Include current bar for live feel
            }
            
            if account_id is not None:
                payload["accountId"] = account_id
            
            try:
                resp = await http_client.post("/api/History/retrieveBars", json=payload, headers=headers)
                
                if resp.status_code == 200:
                    data = resp.json()
                    api_bars = data.get("bars", data) if isinstance(data, dict) else data
                    
                    if isinstance(api_bars, list):
                        new_bars_count = 0
                        
                        for bar in api_bars:
                            ts = bar.get("timestamp") or bar.get("t")
                            if not ts:
                                continue
                            
                            # Convert ISO string to integer timestamp if needed
                            if isinstance(ts, str):
                                try:
                                    ts = int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp())
                                except:
                                    continue
                            
                            # Add to map (overwrites older data with fresher data)
                            if ts not in bars_map:
                                new_bars_count += 1
                            
                            bars_map[ts] = {
                                "t": ts,
                                "o": bar.get("open") or bar.get("o"),
                                "h": bar.get("high") or bar.get("h"),
                                "l": bar.get("low") or bar.get("l"),
                                "c": bar.get("close") or bar.get("c"),
                                "v": bar.get("volume") or bar.get("v") or 0
                            }
                        
                        logger.info(f"✅ Merged {new_bars_count} new bars from API (total: {len(bars_map)})")
                        
                        # ===== STEP 3: Store ALL bars back to SQLite =====
                        conn = sqlite3.connect(DB_PATH)
                        cursor = conn.cursor()
                        
                        stored_count = 0
                        for ts, bar in bars_map.items():
                            try:
                                cursor.execute('''
                                    INSERT OR REPLACE INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                ''', (symbol, tf_str, ts, bar["o"], bar["h"], bar["l"], bar["c"], bar["v"]))
                                stored_count += 1
                            except:
                                pass
                        
                        conn.commit()
                        conn.close()
                        logger.info(f"💾 Synced {stored_count} candles to database")
                else:
                    logger.warning(f"API returned {resp.status_code}, using cached data only")
                    
            except Exception as e:
                logger.warning(f"API fetch failed: {e}, using cached data only")
        else:
            logger.info(f"✅ SQLite data is fresh (gap: {gap_bars} bars)")
        
        # ===== STEP 4: Build final sorted response =====
        sorted_bars = sorted(bars_map.values(), key=lambda x: x["t"])
        
        # Apply limit (return most recent N bars)
        if len(sorted_bars) > limit:
            sorted_bars = sorted_bars[-limit:]
        
        logger.info(f"📊 Returning {len(sorted_bars)} bars for chart display")
        return sorted_bars

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch historical bars: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")





@app.get("/api/history/daily")
async def get_daily_ohlc(symbol: str = DEFAULT_CONTRACT):
    """
    Fetch today's daily OHLC data (Open, High, Low, Close) from ProjectX API.

    Args:
        symbol: Contract ID (e.g., CON.F.US.MES.Z25)

    Returns:
        Single bar with today's OHLC data: {t: ISO8601, o: float, h: float, l: float, c: float, v: int}
    """
    try:
        token = await get_auth_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        from datetime import datetime, timezone, timedelta

        # Get today's data (from midnight to now in UTC)
        now = datetime.now(timezone.utc)
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)

        logger.info(f"📊 Fetching daily OHLC for {symbol}")

        # Get account ID
        account_id = None
        try:
            account_resp = await http_client.post(
                "/api/Account/search",
                json={"onlyActiveAccounts": True},
                headers=headers
            )
            account_data = account_resp.json()
            if account_data.get("success") and account_data.get("accounts"):
                account_id = account_data["accounts"][0]["id"]
        except Exception as e:
            logger.warning(f"Could not fetch account ID: {e}")

        # Fetch daily bar (unit=4 means Day, unitNumber=1 means 1-day bars)
        payload = {
            "contractId": symbol,
            "startTime": start_of_day.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "unit": 4,  # 4 = Day
            "unitNumber": 1,  # 1-day bars
            "limit": 1,  # Just need today
            "live": True,  # Include current partial bar
            "includePartialBar": True
        }

        if account_id is not None:
            payload["accountId"] = account_id

        resp = await http_client.post("/api/History/retrieveBars", json=payload, headers=headers)

        if resp.status_code != 200:
            logger.error(f"Daily OHLC API returned {resp.status_code}: {resp.text}")
            raise HTTPException(status_code=resp.status_code, detail=f"ProjectX API error: {resp.text}")

        data = resp.json()
        bars = data.get("bars", data) if isinstance(data, dict) else data

        if not isinstance(bars, list) or len(bars) == 0:
            logger.warning("No daily bar data returned")
            return {"error": "No data available"}

        # Return the most recent daily bar
        daily_bar = bars[-1]

        # Transform to frontend format
        transformed_bar = {
            "t": daily_bar.get("timestamp") or daily_bar.get("t"),
            "o": daily_bar.get("open") or daily_bar.get("o"),
            "h": daily_bar.get("high") or daily_bar.get("h"),
            "l": daily_bar.get("low") or daily_bar.get("l"),
            "c": daily_bar.get("close") or daily_bar.get("c"),
            "v": daily_bar.get("volume") or daily_bar.get("v", 0)
        }

        logger.info(f"✅ Daily OHLC: Open=${transformed_bar['o']:.2f}")
        return transformed_bar

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching daily OHLC: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/levels/pdh-pdl")
async def get_pdh_pdl_levels(symbol: str = DEFAULT_CONTRACT):
    """
    Session-based levels using 5-min bars:
      PSH/PSL = Previous session high/low (yesterday 18:00 → today 16:30 EST)
      ONH/ONL = Overnight high/low (current session 18:00 → 09:30 EST pre-market)
    Returns: {psh, psl, onh, onl} — all floats.
    """
    from datetime import datetime, timezone, timedelta
    from zoneinfo import ZoneInfo

    try:
        token = await get_auth_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        et = ZoneInfo("America/New_York")
        now_et = datetime.now(et)

        # Determine session boundaries in ET
        today = now_et.date()

        # Current session start: if before 18:00 today → yesterday 18:00
        # If after 18:00 today → today 18:00
        if now_et.hour < 18:
            current_session_start = datetime(today.year, today.month, today.day, 18, 0, tzinfo=et) - timedelta(days=1)
        else:
            current_session_start = datetime(today.year, today.month, today.day, 18, 0, tzinfo=et)

        # Previous session: one day before current session.
        # Walk back through non-trading windows so Mon/Sun queries correctly
        # resolve to the Friday session instead of the weekend void.
        #   Fri 18:00 → Sat 18:00  — market closed (Fri 17:00 close)
        #   Sat 18:00 → Sun 18:00  — weekend
        # Sunday 18:00 start is valid (it's Monday's session opening).
        prev_session_start = current_session_start - timedelta(days=1)
        prev_session_end = current_session_start
        while prev_session_start.weekday() in (4, 5):  # Fri=4, Sat=5
            prev_session_start -= timedelta(days=1)
            prev_session_end -= timedelta(days=1)

        # Overnight cutoff: 09:30 ET on the morning after session start
        overnight_end_date = (current_session_start + timedelta(days=1)).date() if now_et.hour >= 18 else today
        overnight_end = datetime(overnight_end_date.year, overnight_end_date.month, overnight_end_date.day, 9, 30, tzinfo=et)

        # Convert to UTC for API
        fetch_start = prev_session_start.astimezone(timezone.utc)
        fetch_end = now_et.astimezone(timezone.utc)

        logger.info(f"📊 PDH/PDL session bounds (ET): prev={prev_session_start} → {prev_session_end}, overnight={current_session_start} → {overnight_end}")

        # Get account ID
        account_id = None
        try:
            account_resp = await http_client.post(
                "/api/Account/search",
                json={"onlyActiveAccounts": True},
                headers=headers
            )
            account_data = account_resp.json()
            if account_data.get("success") and account_data.get("accounts"):
                account_id = account_data["accounts"][0]["id"]
        except Exception as e:
            logger.warning(f"Could not fetch account ID for PDH/PDL: {e}")

        # Fetch 5-min bars covering both sessions (~48 hours)
        payload = {
            "contractId": symbol,
            "startTime": fetch_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime": fetch_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "unit": 2,        # Minute
            "unitNumber": 5,  # 5-min bars
            "limit": 10000,
            "live": False,
            "includePartialBar": False
        }
        if account_id is not None:
            payload["accountId"] = account_id

        resp = await http_client.post("/api/History/retrieveBars", json=payload, headers=headers)

        if resp.status_code != 200:
            logger.error(f"PDH/PDL bars API returned {resp.status_code}: {resp.text}")
            raise HTTPException(status_code=resp.status_code, detail="API error fetching bars")

        data = resp.json()
        bars = data.get("bars", data) if isinstance(data, dict) else data

        if not isinstance(bars, list) or len(bars) == 0:
            raise HTTPException(status_code=404, detail="No bar data available")

        # Parse bars and bucket by session
        prev_session_start_ts = prev_session_start.timestamp()
        prev_session_end_ts = prev_session_end.timestamp()
        current_session_start_ts = current_session_start.timestamp()
        overnight_end_ts = overnight_end.timestamp()

        psh, psl = None, None
        onh, onl = None, None

        for bar in bars:
            ts = bar.get("timestamp") or bar.get("t")
            if not ts:
                continue
            if isinstance(ts, str):
                try:
                    ts = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
                except:
                    continue

            h = bar.get("high") or bar.get("h")
            l = bar.get("low") or bar.get("l")
            if h is None or l is None:
                continue

            # Previous session bars
            if prev_session_start_ts <= ts < prev_session_end_ts:
                psh = max(psh, h) if psh is not None else h
                psl = min(psl, l) if psl is not None else l

            # Overnight bars (current session before 09:30)
            if current_session_start_ts <= ts < overnight_end_ts:
                onh = max(onh, h) if onh is not None else h
                onl = min(onl, l) if onl is not None else l

        result = {}
        if psh is not None:
            result["psh"] = psh
        if psl is not None:
            result["psl"] = psl
        if onh is not None:
            result["onh"] = onh
        if onl is not None:
            result["onl"] = onl

        if not result:
            raise HTTPException(status_code=404, detail="No level data in session range")

        logger.info(f"📊 Levels: PSH={psh} PSL={psl} ONH={onh} ONL={onl}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching PDH/PDL levels: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --------------------------------------------------------------------
# CANDLE DATABASE ENDPOINTS
# --------------------------------------------------------------------

class TickData(BaseModel):
    price: float
    volume: Optional[int] = 0
    timestamp: Optional[str] = None

@app.post("/api/candles/tick")
async def add_tick_data(tick: TickData, symbol: str = DEFAULT_CONTRACT, interval: int = 5):
    """
    Add tick data to build live candles in the database.
    Frontend calls this to store real-time data.
    """
    try:
        from datetime import datetime, timezone
        
        # Calculate candle timestamp based on interval
        now = datetime.now(timezone.utc)
        seconds = interval * 60
        candle_timestamp = int(now.timestamp() / seconds) * seconds
        
        # Get timeframe string
        tf_str = f"{interval}m"
        
        # Store in SQLite
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Try to get existing candle
        cursor.execute('''
            SELECT id, open, high, low, close, volume
            FROM candles
            WHERE symbol = ? AND timeframe = ? AND timestamp = ?
        ''', (symbol, tf_str, candle_timestamp))
        
        row = cursor.fetchone()
        
        if row:
            # Update existing candle
            open_price = row[1]
            high = max(row[2], tick.price)
            low = min(row[3], tick.price)
            close = tick.price
            volume = row[5] + tick.volume
            
            cursor.execute('''
                UPDATE candles
                SET high = ?, low = ?, close = ?, volume = ?
                WHERE id = ?
            ''', (high, low, close, volume, row[0]))
        else:
            # Create new candle
            cursor.execute('''
                INSERT INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (symbol, tf_str, candle_timestamp, tick.price, tick.price, tick.price, tick.price, tick.volume))
        
        conn.commit()
        conn.close()
        
        return {"status": "ok", "candle_timestamp": candle_timestamp}
        
    except Exception as e:
        logger.error(f"Error adding tick data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/candles")
async def get_candles(symbol: str = DEFAULT_CONTRACT, interval: int = 5, limit: int = 1000):
    """
    Get candles from SQLite database.
    """
    try:
        tf_str = f"{interval}m"
        
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT timestamp, open, high, low, close, volume
            FROM candles
            WHERE symbol = ? AND timeframe = ?
            ORDER BY timestamp DESC
            LIMIT ?
        ''', (symbol, tf_str, limit))
        
        rows = cursor.fetchall()
        conn.close()
        
        from datetime import datetime, timezone

        bars = []
        for row in reversed(rows):
            ts = row[0]
            # Normalize ISO strings and millisecond timestamps
            if isinstance(ts, str):
                try:
                    ts = int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp())
                except Exception:
                    try:
                        ts = int(float(ts))
                    except Exception:
                        continue
            if isinstance(ts, (float,)) or (isinstance(ts, int) and ts > 1_000_000_000_000):
                ts = int(ts // 1000)

            bars.append({
                "t": ts,
                "o": row[1],
                "h": row[2],
                "l": row[3],
                "c": row[4],
                "v": row[5]
            })
        
        return bars
        
    except Exception as e:
        logger.error(f"Error getting candles: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --------------------------------------------------------------------
# ORDER PLACEMENT ENDPOINT - REAL PROJECTX INTEGRATION
# --------------------------------------------------------------------

class OrderRequest(BaseModel):
    """
    Order placement request matching ProjectX API schema.

    MES Contract Specs:
    - Contract: CON.F.US.MES.Z25 (MUST use full format, not F.US.MES)
    - Tick size: 0.25 points
    - Tick value: $0.50 per tick (Micro E-mini Nasdaq-100 - MNQ)

    CRITICAL: ProjectX API requires full contract format (e.g., CON.F.US.MNQ.H25).
    Short form (F.US.MES) will return error code 8 (invalid contract).
    """
    accountId: Optional[int] = Field(None, description="Account ID (auto-detected if not provided)")
    contractId: str = Field(
        default=DEFAULT_CONTRACT,
        description="Contract ID in full format (e.g., CON.F.US.MNQ.H25)"
    )
    side: str = Field(..., description="Order side: 'buy' or 'sell'")
    orderType: str = Field(default="limit", description="Order type: 'limit', 'market', 'stop', 'stop-limit'")
    price: Optional[float] = Field(None, description="Limit price (required for limit and stop-limit orders)")
    stopPrice: Optional[float] = Field(None, description="Stop price (required for stop and stop-limit orders)")
    quantity: int = Field(..., description="Number of contracts", gt=0)
    customTag: Optional[str] = Field(None, description="Custom order tag (must be unique)")

@app.post("/api/orders/place")
async def place_order(order: OrderRequest, account_id: Optional[int] = None):
    """
    Place a real order via ProjectX API.

    Args:
        order: OrderRequest with all order parameters
        account_id: Account ID to place order on (query parameter). If not provided, uses order.accountId or auto-detects.

    Returns:
        {
            "success": bool,
            "orderId": int,
            "message": str,
            "order": {...}
        }

    Error Handling:
        - 400: Invalid order parameters
        - 401: Authentication failure
        - 403: Insufficient margin or account restrictions
        - 500: ProjectX API error
    """
    try:
        # DEBUG: Log incoming order request
        logger.info(f"📥 RECEIVED ORDER REQUEST: {order.dict()}")
        
        # 1. Get authentication token
        token = await get_auth_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # 2. Get account ID from query parameter, order body, or auto-detect
        # Priority: query parameter > order.accountId > auto-detect
        if account_id is None:
            account_id = order.accountId

        if not account_id:
            # Check cache first to avoid rate limiting
            if 'default_account_id' in account_id_cache:
                # 🚨 BACKEND FIX #2: Validate cached account is still active
                cached_id = account_id_cache['default_account_id']
                try:
                    validate_resp = await http_client.post(
                        "/api/Account/search",
                        json={"onlyActiveAccounts": True},
                        headers=headers
                    )
                    validate_data = validate_resp.json()
                    if validate_data.get("success") and validate_data.get("accounts"):
                        account_ids = [acc["id"] for acc in validate_data["accounts"]]
                        if cached_id in account_ids:
                            account_id = cached_id
                            logger.info(f"📦 Using VALIDATED cached account ID: {account_id}")
                        else:
                            logger.warning(f"⚠️ Cached account {cached_id} no longer active, refreshing...")
                            del account_id_cache['default_account_id']  # Invalidate cache
                            account_id = validate_data["accounts"][0]["id"]
                            account_id_cache['default_account_id'] = account_id
                            logger.info(f"✅ Switched to new active account ID: {account_id}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to validate cached account: {e}, using cached value")
                    account_id = cached_id  # Fall back to cached value
            else:
                logger.info("🔍 Auto-detecting account ID...")
                account_resp = await http_client.post(
                    "/api/Account/search",
                    json={"onlyActiveAccounts": True},
                    headers=headers
                )
                account_data = account_resp.json()

                if not account_data.get("success") or not account_data.get("accounts"):
                    raise HTTPException(status_code=404, detail="No active accounts found")

                account_id = account_data["accounts"][0]["id"]
                account_id_cache['default_account_id'] = account_id  # Cache it
                logger.info(f"✅ Auto-detected account ID: {account_id} (cached for future requests)")
        else:
            logger.info(f"✅ Using specified account ID: {account_id}")

        # 3. Validate order parameters
        order_type_lower = order.orderType.lower()

        if order_type_lower == "limit" and order.price is None:
            raise HTTPException(status_code=400, detail="Limit orders require a price")

        if order_type_lower == "stop-limit":
            if order.price is None:
                raise HTTPException(status_code=400, detail="Stop-limit orders require a limit price")
            if order.stopPrice is None:
                raise HTTPException(status_code=400, detail="Stop-limit orders require a stop price")

        if order_type_lower == "stop" and order.stopPrice is None:
            raise HTTPException(status_code=400, detail="Stop orders require a stop price")

        # Validate tick size — tick size per contract family
        #   MGC (Micro Gold):   0.10 tick
        #   MYM / YM (Dow):     1.00 tick
        #   MES / ES (S&P):     0.25 tick
        #   MNQ / NQ (Nasdaq):  0.25 tick
        contract_id_upper = (order.contractId or "").upper()
        if "MGC" in contract_id_upper:
            tick_size = 0.10
        elif "MES" in contract_id_upper or "MNQ" in contract_id_upper or "NQ" in contract_id_upper or ("ES" in contract_id_upper and "MES" not in contract_id_upper):
            tick_size = 0.25
        else:
            # Dow family (YM / MYM) and default
            tick_size = 1.0

        logger.info(f"🎯 [TICK-CHECK v2] contractId={order.contractId!r} → tick_size={tick_size}")

        prices_to_validate = []
        if order.price is not None:
            prices_to_validate.append(("price", order.price))
        if order.stopPrice is not None:
            prices_to_validate.append(("stopPrice", order.stopPrice))

        for field_name, price_value in prices_to_validate:
            # Check that price is an integer multiple of tick_size (with float tolerance)
            ticks = price_value / tick_size
            remainder = abs(ticks - round(ticks))
            if remainder > 0.01:  # Allow small floating point drift
                raise HTTPException(
                    status_code=400,
                    detail=f"{field_name} must be in {tick_size}-point increments (tick_size={tick_size}, contractId={order.contractId}). Got: {price_value}"
                )

        # 4. Map order parameters to ProjectX API format
        # ProjectX enums: type (1=Limit, 2=Market, 4=Stop), side (0=Bid/buy, 1=Ask/sell)
        # Note: Stop-limit orders use type=4 (Stop) with BOTH stopPrice and limitPrice
        order_type_map = {"limit": 1, "market": 2, "stop": 4, "stop-limit": 4}
        side_map = {"buy": 0, "sell": 1}

        projectx_type = order_type_map.get(order_type_lower)
        if projectx_type is None:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid order type: {order.orderType}. Must be 'limit', 'market', 'stop', or 'stop-limit'"
            )

        projectx_side = side_map.get(order.side.lower())
        if projectx_side is None:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid side: {order.side}. Must be 'buy' or 'sell'"
            )

        # 5. Build ProjectX payload
        payload = {
            "accountId": account_id,
            "contractId": order.contractId,
            "type": projectx_type,
            "side": projectx_side,
            "size": order.quantity,
        }

        # Add price fields based on order type
        # Limit orders: only limitPrice
        # Market orders: no prices
        # Stop orders: only stopPrice
        # Stop-Limit orders: both stopPrice and limitPrice
        if order_type_lower in ["limit", "stop-limit"] and order.price is not None:
            payload["limitPrice"] = order.price

        if order_type_lower in ["stop", "stop-limit"] and order.stopPrice is not None:
            payload["stopPrice"] = order.stopPrice

        # 🚨 CRITICAL: TopstepX does NOT support OCO brackets
        # DO NOT add stopLossBracket or takeProfitBracket to payload
        # These will be placed as separate orders in 3-order pipeline below

        if order.customTag:
            payload["customTag"] = order.customTag

        # Log order details
        order_desc = f"{order.side.upper()} {order_type_lower.upper()} order: {order.quantity} {order.contractId}"
        if order_type_lower == "stop-limit":
            order_desc += f" @ Stop: {order.stopPrice}, Limit: {order.price}"
        elif order_type_lower == "limit":
            order_desc += f" @ {order.price}"
        elif order_type_lower == "stop":
            order_desc += f" @ Stop: {order.stopPrice}"
        else:  # market
            order_desc += " @ MARKET"

        logger.info(f"🚀 Placing {order_desc}")
        logger.info(f"📋 Payload: {payload}")

        # 6. Call ProjectX Order Placement API
        resp = await http_client.post("/api/Order/place", json=payload, headers=headers)

        if resp.status_code != 200:
            error_text = resp.text
            logger.error(f"❌ Order placement failed: {resp.status_code} - {error_text}")
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"ProjectX API error: {error_text}"
            )

        data = resp.json()
        
        # DEBUG: Log the response from ProjectX
        logger.info(f"📤 ProjectX Response: {data}")

        # 7. Check response for errors
        if not data.get("success", False):
            error_code = data.get("errorCode", "unknown")
            error_msg = data.get("errorMessage", "Unknown error")
            logger.error(f"❌ Order rejected: [{error_code}] {error_msg}")
            raise HTTPException(status_code=400, detail=f"Order rejected: {error_msg}")

        order_id = data.get("orderId")

        logger.info(f"✅ Order placed successfully! Order ID: {order_id} (Type: {order_type_lower.upper()})")

        # Invalidate orders cache for this account so next fetch gets fresh data
        cache_key = f"orders_{account_id}"
        if cache_key in orders_cache:
            del orders_cache[cache_key]
            logger.info(f"🗑️ Invalidated orders cache for account {account_id}")

        # Return success response — single order only, no bracket pipeline
        return {
            "success": True,
            "orderId": order_id,
            "message": f"{order.side.upper()} {order_type_lower.upper()} order placed: {order.quantity} {order.contractId}",
            "order": {
                "orderId": order_id,
                "accountId": account_id,
                "contractId": order.contractId,
                "side": order.side,
                "type": order.orderType,
                "price": order.price,
                "stopPrice": order.stopPrice,
                "quantity": order.quantity,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Order placement failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

@app.delete("/api/orders/cancel-all")
async def cancel_all_orders():
    """
    Cancel all pending/working orders for the active account.

    Returns:
        {
            "success": bool,
            "cancelledCount": int,
            "message": str,
            "errors": List[str]  # Any individual order cancellation failures
        }

    Error Handling:
        - 404: No active accounts found
        - 500: ProjectX API error or internal error
    """
    try:
        # 1. Get authentication token
        token = await get_auth_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # 2. Get account ID
        logger.info("🔍 Fetching account for cancel-all operation...")
        account_resp = await http_client.post(
            "/api/Account/search",
            json={"onlyActiveAccounts": True},
            headers=headers
        )
        account_data = account_resp.json()

        if not account_data.get("success") or not account_data.get("accounts"):
            raise HTTPException(status_code=404, detail="No active accounts found")

        account_id = account_data["accounts"][0]["id"]
        logger.info(f"✅ Using account ID: {account_id}")

        # 3. Get all open orders
        logger.info("📋 Fetching open orders...")
        orders_resp = await http_client.post(
            "/api/Order/searchOpen",
            json={"accountId": account_id},
            headers=headers
        )
        orders_data = orders_resp.json()

        if not orders_data.get("success"):
            error_msg = orders_data.get("message", "Failed to fetch orders")
            logger.error(f"❌ Order fetch failed: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        orders = orders_data.get("orders", [])

        if not orders:
            logger.info("ℹ️ No open orders to cancel")
            return {
                "success": True,
                "cancelledCount": 0,
                "message": "No open orders to cancel",
                "errors": []
            }

        logger.info(f"📋 Found {len(orders)} open orders to cancel")

        # 4. Cancel all orders using ProjectX /api/Order/cancelAll endpoint
        # This is more efficient than canceling orders one by one
        logger.info("🚫 Canceling all orders via ProjectX API...")
        cancel_resp = await http_client.post(
            "/api/Order/cancelAll",
            json={"accountId": account_id},
            headers=headers
        )

        if cancel_resp.status_code != 200:
            error_text = cancel_resp.text
            logger.error(f"❌ Cancel-all failed: {cancel_resp.status_code} - {error_text}")
            raise HTTPException(
                status_code=cancel_resp.status_code,
                detail=f"ProjectX API error: {error_text}"
            )

        cancel_data = cancel_resp.json()

        if not cancel_data.get("success", False):
            error_msg = cancel_data.get("message", "Cancel operation failed")
            logger.error(f"❌ Cancel-all rejected: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        # Count successfully cancelled orders
        cancelled_count = len(orders)  # All orders should be cancelled
        logger.info(f"✅ Successfully cancelled {cancelled_count} order(s)")

        # Invalidate orders cache for this account
        cache_key = f"orders_{account_id}"
        if cache_key in orders_cache:
            del orders_cache[cache_key]
            logger.info(f"🗑️ Invalidated orders cache for account {account_id}")

        return {
            "success": True,
            "cancelledCount": cancelled_count,
            "message": f"Successfully cancelled {cancelled_count} order(s)",
            "errors": []
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Cancel-all operation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

@app.delete("/api/orders/{order_id}/cancel")
async def cancel_order(order_id: int):
    """
    Cancel a specific order by ID.

    Args:
        order_id: ProjectX order ID

    Returns:
        {
            "success": bool,
            "orderId": int,
            "message": str
        }

    Error Handling:
        - 404: Order not found or account not found
        - 400: Order cannot be cancelled (already filled/cancelled)
        - 500: ProjectX API error or internal error
    """
    try:
        # 1. Get authentication token
        token = await get_auth_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # 2. Get account ID (required by ProjectX cancel API)
        logger.info(f"🔍 Fetching account for order {order_id} cancellation...")
        account_resp = await http_client.post(
            "/api/Account/search",
            json={"onlyActiveAccounts": True},
            headers=headers
        )
        account_data = account_resp.json()

        if not account_data.get("success") or not account_data.get("accounts"):
            raise HTTPException(status_code=404, detail="No active accounts found")

        account_id = account_data["accounts"][0]["id"]

        # 3. Cancel the order using ProjectX API
        logger.info(f"🚫 Canceling order {order_id}...")
        cancel_payload = {
            "accountId": account_id,
            "orderId": order_id
        }

        cancel_resp = await http_client.post(
            "/api/Order/cancel",
            json=cancel_payload,
            headers=headers
        )

        if cancel_resp.status_code != 200:
            error_text = cancel_resp.text
            logger.error(f"❌ Order cancel failed: {cancel_resp.status_code} - {error_text}")
            raise HTTPException(
                status_code=cancel_resp.status_code,
                detail=f"ProjectX API error: {error_text}"
            )

        cancel_data = cancel_resp.json()

        if not cancel_data.get("success", False):
            error_msg = cancel_data.get("message", "Cancel operation failed")
            logger.error(f"❌ Order cancel rejected: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        logger.info(f"✅ Order {order_id} cancelled successfully")

        # Invalidate orders cache for this account
        cache_key = f"orders_{account_id}"
        if cache_key in orders_cache:
            del orders_cache[cache_key]
            logger.info(f"🗑️ Invalidated orders cache for account {account_id}")

        return {
            "success": True,
            "orderId": order_id,
            "message": f"Order {order_id} cancelled successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Order cancel failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

# --------------------------------------------------------------------
# HISTORICAL DATA EXPORT ENDPOINT - ES/NQ for Sierra Chart
# --------------------------------------------------------------------

@app.get("/api/history/export/{symbol}")
async def export_historical_data_endpoint(
    symbol: str,
    days: int = 365,  # Default to 1 year, can request more
    interval: int = 5  # 5-minute bars
):
    """
    Export historical bar data for ES or NQ futures in Sierra Chart compatible CSV format.

    Args:
        symbol: 'ES' or 'NQ' (will map to full contract ID)
        days: Number of days to fetch (default 365, max ~730 depending on API limits)
        interval: Bar interval in minutes (default: 5)

    Returns:
        CSV text with columns: DateTime, Open, High, Low, Close, Volume
        DateTime format: YYYY-MM-DD HH:MM:SS (Sierra Chart compatible)
    """
    return await _export_historical_data(symbol, days, interval, http_client, get_auth_token)

# --------------------------------------------------------------------
# CANDLE DATABASE ENDPOINTS - Local Storage for Building Your Database
# --------------------------------------------------------------------

class CandleData(BaseModel):
    """Single candle data model."""
    # Accept either integer unix seconds or ISO timestamp strings and coerce on save
    timestamp: Union[int, str]
    open: float
    high: float
    low: float
    close: float
    volume: int = 0

class CandleBatch(BaseModel):
    """Batch of candles to save."""
    symbol: str = Field(default="MNQ", description="Symbol (MNQ, MES, ES, NQ)")
    timeframe: str = Field(default="5m", description="Timeframe (1m, 5m, 15m, etc.)")
    candles: List[CandleData]

@app.post("/api/candles/save")
async def save_candles(batch: CandleBatch):
    """
    Save a batch of candles to the local SQLite database.
    Uses INSERT OR REPLACE to update existing candles (based on symbol + timeframe + timestamp).

    Args:
        batch: CandleBatch with symbol, timeframe, and list of candles

    Returns:
        {
            "success": bool,
            "saved": int (number of candles saved),
            "symbol": str,
            "timeframe": str
        }
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        saved_count = 0
        from datetime import datetime, timezone

        for candle in batch.candles:
            ts = candle.timestamp
            # Coerce ISO strings to unix seconds
            if isinstance(ts, str):
                try:
                    ts = int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp())
                except Exception:
                    # Try to parse numeric-like strings
                    try:
                        ts = int(float(ts))
                    except Exception:
                        # Skip invalid timestamp
                        continue

            # Handle milliseconds timestamps
            if isinstance(ts, (float,)) or (isinstance(ts, int) and ts > 1_000_000_000_000):
                ts = int(ts // 1000)

            cursor.execute('''
                INSERT OR REPLACE INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                batch.symbol,
                batch.timeframe,
                ts,
                candle.open,
                candle.high,
                candle.low,
                candle.close,
                candle.volume
            ))
            saved_count += 1

        conn.commit()

        # Get total count for this symbol/timeframe
        cursor.execute('''
            SELECT COUNT(*) FROM candles WHERE symbol = ? AND timeframe = ?
        ''', (batch.symbol, batch.timeframe))
        total_count = cursor.fetchone()[0]

        conn.close()

        logger.info(f"💾 Saved {saved_count} {batch.timeframe} candles for {batch.symbol} (total: {total_count})")

        return {
            "success": True,
            "saved": saved_count,
            "total": total_count,
            "symbol": batch.symbol,
            "timeframe": batch.timeframe
        }

    except Exception as e:
        logger.error(f"❌ Failed to save candles: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/candles/load")
async def load_candles(
    symbol: str = "MNQ",
    timeframe: str = "5m",
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
    limit: int = 5000
):
    """
    Load candles from the local SQLite database.

    Args:
        symbol: Symbol to load (default: MNQ)
        timeframe: Timeframe to load (default: 5m)
        start_time: Optional start timestamp (Unix seconds)
        end_time: Optional end timestamp (Unix seconds)
        limit: Max candles to return (default: 5000)

    Returns:
        List of candles in format: [{t, o, h, l, c, v}, ...]
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        query = "SELECT timestamp, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ?"
        params = [symbol, timeframe]

        if start_time:
            query += " AND timestamp >= ?"
            params.append(start_time)

        if end_time:
            query += " AND timestamp <= ?"
            params.append(end_time)

        query += " ORDER BY timestamp ASC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        from datetime import datetime, timezone

        candles = []
        for row in rows:
            ts = row[0]
            if isinstance(ts, str):
                try:
                    ts = int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp())
                except Exception:
                    try:
                        ts = int(float(ts))
                    except Exception:
                        continue
            if isinstance(ts, (float,)) or (isinstance(ts, int) and ts > 1_000_000_000_000):
                ts = int(ts // 1000)

            candles.append({"t": ts, "o": row[1], "h": row[2], "l": row[3], "c": row[4], "v": row[5]})

        logger.info(f"📦 Loaded {len(candles)} {timeframe} candles for {symbol}")

        return candles

    except Exception as e:
        logger.error(f"❌ Failed to load candles: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/candles/stats")
async def get_candle_stats():
    """
    Get statistics about stored candles in the database.

    Returns:
        {
            "total_candles": int,
            "by_symbol": {symbol: count, ...},
            "by_timeframe": {timeframe: count, ...},
            "date_range": {symbol: {oldest, newest}, ...}
        }
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # Total count
        cursor.execute("SELECT COUNT(*) FROM candles")
        total = cursor.fetchone()[0]

        # By symbol
        cursor.execute("SELECT symbol, COUNT(*) FROM candles GROUP BY symbol")
        by_symbol = {row[0]: row[1] for row in cursor.fetchall()}

        # By timeframe
        cursor.execute("SELECT timeframe, COUNT(*) FROM candles GROUP BY timeframe")
        by_timeframe = {row[0]: row[1] for row in cursor.fetchall()}

        # Date range per symbol
        cursor.execute("""
            SELECT symbol, MIN(timestamp), MAX(timestamp)
            FROM candles
            GROUP BY symbol
        """)
        date_range = {}
        for row in cursor.fetchall():
            from datetime import datetime, timezone
            oldest = datetime.fromtimestamp(row[1], tz=timezone.utc).isoformat() if row[1] else None
            newest = datetime.fromtimestamp(row[2], tz=timezone.utc).isoformat() if row[2] else None
            date_range[row[0]] = {"oldest": oldest, "newest": newest}

        conn.close()

        return {
            "total_candles": total,
            "by_symbol": by_symbol,
            "by_timeframe": by_timeframe,
            "date_range": date_range
        }

    except Exception as e:
        logger.error(f"❌ Failed to get candle stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/debug/candles-sample")
async def debug_candles_sample(symbol: str = DEFAULT_CONTRACT, timeframe: str = "5m", limit: int = 10):
    """Return raw DB rows and normalized preview for debugging timestamp formats."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''SELECT id, symbol, timeframe, timestamp, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY timestamp DESC LIMIT ?''', (symbol, timeframe, limit))
        rows = cursor.fetchall()
        conn.close()

        from datetime import datetime

        items = []
        for r in rows:
            raw_ts = r[3]
            normalized = None
            ts_type = type(raw_ts).__name__
            try:
                if isinstance(raw_ts, int):
                    normalized = raw_ts if raw_ts < 1_000_000_000_000 else int(raw_ts // 1000)
                elif isinstance(raw_ts, float):
                    normalized = int(raw_ts // 1000) if raw_ts > 1_000_000_000_000 else int(raw_ts)
                elif isinstance(raw_ts, str):
                    try:
                        normalized = int(datetime.fromisoformat(raw_ts.replace('Z', '+00:00')).timestamp())
                        ts_type = 'iso_string'
                    except Exception:
                        try:
                            v = float(raw_ts)
                            normalized = int(v // 1000) if v > 1_000_000_000_000 else int(v)
                            ts_type = 'numeric_string'
                        except Exception:
                            normalized = None
                else:
                    normalized = None
            except Exception:
                normalized = None

            items.append({
                'id': r[0],
                'symbol': r[1],
                'timeframe': r[2],
                'raw_timestamp': raw_ts,
                'timestamp_type': ts_type,
                'normalized_timestamp': normalized,
                'iso': datetime.fromtimestamp(normalized).isoformat() if normalized else None,
                'open': r[4], 'high': r[5], 'low': r[6], 'close': r[7], 'volume': r[8]
            })

        return { 'count': len(items), 'items': items }

    except Exception as e:
        logger.error(f"Debug endpoint failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        logger.error(f"❌ Failed to get candle stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
