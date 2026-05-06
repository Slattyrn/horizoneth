// lib/ws.ts - Simple shared WebSocket singleton with proper ping/pong
let ws: WebSocket | null = null;
type MessageHandler = (data: any) => void;
type ReconnectHandler = () => void;
const handlers = new Set<MessageHandler>();
const reconnectHandlers = new Set<ReconnectHandler>(); // 🚨 FIX: Callbacks for reconnection events
let reconnectAttempts = 0;
const maxReconnectAttempts = Infinity; // 🚨 FIX: Never give up reconnecting (hands-off trading requirement)
let pingInterval: number | null = null;
let reconnectTimeout: number | null = null;
let wasDisconnected = false; // Track if we were previously disconnected

// 🚨 CRITICAL: Validate tick data to prevent NaN propagation and crashes
function validateTickData(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }

  // Validate timestamp (must be valid number or string that converts to valid date)
  if (data.timestamp !== undefined && data.timestamp !== null) {
    let timestamp: number;
    if (typeof data.timestamp === 'string') {
      // 🔧 FIX: Handle both numeric strings and ISO date strings
      if (data.timestamp.includes('T') || data.timestamp.includes('-')) {
        // ISO date string - parse as Date
        timestamp = new Date(data.timestamp).getTime() / 1000;
      } else {
        // Numeric string
        timestamp = parseFloat(data.timestamp);
      }
    } else {
      timestamp = data.timestamp;
    }
    if (isNaN(timestamp) || timestamp <= 0) {
      console.error("❌ Invalid timestamp:", data.timestamp);
      return false;
    }
  }

  // Validate price fields (must be valid numbers if present)
  const priceFields = ['price', 'bid', 'ask', 'last', 'open', 'high', 'low', 'close'];
  for (const field of priceFields) {
    if (data[field] !== undefined && data[field] !== null) {
      const value = typeof data[field] === 'string' ? parseFloat(data[field]) : data[field];
      if (isNaN(value) || value < 0) {
        console.error(`❌ Invalid ${field}:`, data[field]);
        return false;
      }
    }
  }

  // Validate volume fields (must be valid non-negative number if present)
  const volumeFields = ['volume', 'tradeVolume', 'cumulativeVolume'];
  for (const field of volumeFields) {
    if (data[field] !== undefined && data[field] !== null) {
      const volume = typeof data[field] === 'string' ? parseFloat(data[field]) : data[field];
      if (isNaN(volume) || volume < 0) {
        console.error(`❌ Invalid ${field}:`, data[field]);
        return false;
      }
    }
  }

  // All validations passed
  return true;
}

export function getSocket(): WebSocket {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return ws;
  }

  const wsUrl = `ws://${window.location.host}/ws/live`;

  console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("✅ WebSocket connected");

    // 🚨 FIX: Detect reconnection after disconnection (internet recovery)
    const isReconnection = wasDisconnected;
    reconnectAttempts = 0; // Reset counter on successful connection
    wasDisconnected = false;

    // Clear any pending reconnection timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    // Start sending pings every 30 seconds to keep connection alive
    if (pingInterval) {
      clearInterval(pingInterval);
    }
    pingInterval = window.setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send("ping");
        console.log("📤 Sent ping");
      }
    }, 30000);

    // 🚨 FIX: Trigger reconnection callbacks to sync position state
    if (isReconnection) {
      console.log('🔄 WebSocket RECONNECTED - triggering position sync callbacks');
      reconnectHandlers.forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.error("Reconnect handler error:", err);
        }
      });
    }
  };

  ws.onmessage = (e) => {
    // Handle pong responses
    if (e.data === "pong") {
      console.log("📥 Received pong");
      return;
    }

    try {
      const data = JSON.parse(e.data);

      // 🚨 CRITICAL: Validate tick data to prevent NaN propagation
      if (!validateTickData(data)) {
        console.error("❌ Invalid tick data received:", data);
        return; // Skip broadcasting invalid data
      }

      // console.log("📊 Received data:", JSON.stringify(data, null, 2));

      // Broadcast to all handlers
      handlers.forEach((fn) => {
        try {
          fn(data);
        } catch (err) {
          console.error("Handler error:", err);
        }
      });
    } catch (err) {
      console.error("Bad tick data:", err, e.data);
    }
  };

  ws.onerror = (error) => {
    console.error("❌ WebSocket error:", error);
  };

  ws.onclose = (event) => {
    console.log(`🔌 WebSocket closed: ${event.code} ${event.reason}`);
    ws = null;
    wasDisconnected = true; // Mark as disconnected for reconnection detection

    // Clear ping interval
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }

    // 🚨 FIX: Infinite reconnection with exponential backoff (hands-off trading requirement)
    // Cap delay at 30 seconds but never give up
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts, 5)), 30000); // Max 30s delay
    console.log(`🔄 Reconnecting in ${delay}ms... (attempt ${reconnectAttempts})`);
    reconnectTimeout = window.setTimeout(() => getSocket(), delay);
  };

  return ws;
}

export function subscribe(handler: MessageHandler) {
  handlers.add(handler);
  getSocket(); // Ensure socket exists
  return () => handlers.delete(handler);
}

// 🚨 FIX: Subscribe to reconnection events for position sync
export function onReconnect(handler: ReconnectHandler) {
  reconnectHandlers.add(handler);
  return () => reconnectHandlers.delete(handler);
}

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

// 🚨 FIX: Detect when computer wakes from sleep and force reconnection
// Reset reconnection attempts when page becomes visible (user returns or computer wakes)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('👁️ Page visible - checking WebSocket connection');

      // Reset reconnection counter (fresh start after wake)
      reconnectAttempts = 0;

      // If WebSocket is not connected, force reconnection immediately
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log('🔄 Forcing reconnection after page visibility change');
        getSocket();
      }
    }
  });
}