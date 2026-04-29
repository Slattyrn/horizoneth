/**
 * Telegram Bot Notification Service
 *
 * Setup Instructions:
 * 1. Open Telegram and search for @BotFather
 * 2. Send /newbot and follow the prompts to create your bot
 * 3. Copy the bot token (looks like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
 * 4. Start a chat with your new bot
 * 5. Get your chat ID:
 *    - Send a message to your bot
 *    - Visit: https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
 *    - Find your chat.id in the response
 * 6. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID below or in environment
 */

// Configuration - Default credentials (can be overridden via localStorage)
const TELEGRAM_CONFIG = {
  botToken: localStorage.getItem('telegram_bot_token') || '8238377468:AAGR3MMJ3vRNhLHAC2P5y6z_yOKxl8Mo5wg',
  chatId: localStorage.getItem('telegram_chat_id') || '5726916807',
  enabled: localStorage.getItem('telegram_enabled') !== 'false', // Enabled by default
};

// Message types with emojis
const MESSAGE_TYPES = {
  zoneTap: '🎯',
  orderPlaced: '📝',
  orderFilled: '✅',
  stopHit: '🛑',
  tpHit: '💰',
  breakeven: '🔄',
  warning: '⚠️',
  info: 'ℹ️',
  overnight: '🌙',
};

type MessageType = keyof typeof MESSAGE_TYPES;

interface TelegramMessage {
  type: MessageType;
  title: string;
  details?: string[];
  price?: number;
  timestamp?: Date;
}

/**
 * Send a message via Telegram Bot API
 */
async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!TELEGRAM_CONFIG.enabled || !TELEGRAM_CONFIG.botToken || !TELEGRAM_CONFIG.chatId) {
    console.log('[Telegram] Not configured or disabled');
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CONFIG.chatId,
        text: text,
        parse_mode: 'HTML',
        disable_notification: false,
      }),
    });

    if (response.ok) {
      console.log('[Telegram] Message sent successfully');
      return true;
    } else {
      const error = await response.json();
      console.error('[Telegram] Failed to send:', error);
      return false;
    }
  } catch (error) {
    console.error('[Telegram] Error:', error);
    return false;
  }
}

/**
 * Format and send a structured alert
 */
export async function sendTelegramAlert(message: TelegramMessage): Promise<boolean> {
  const emoji = MESSAGE_TYPES[message.type] || 'ℹ️';
  const time = (message.timestamp || new Date()).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  let text = `${emoji} <b>${message.title}</b>\n`;
  text += `🕐 ${time} EST\n`;

  if (message.price) {
    text += `💵 Price: $${message.price.toFixed(2)}\n`;
  }

  if (message.details && message.details.length > 0) {
    text += '\n';
    message.details.forEach((detail) => {
      text += `• ${detail}\n`;
    });
  }

  return sendTelegramMessage(text);
}

/**
 * Quick alert functions for common events
 */
export const TelegramAlerts = {
  // Zone tap alerts
  zoneTap: (zone: string, price: number, direction?: 'long' | 'short') =>
    sendTelegramAlert({
      type: 'zoneTap',
      title: `${zone.toUpperCase()} Zone Tapped`,
      price,
      details: direction ? [`Direction: ${direction.toUpperCase()}`] : undefined,
    }),

  upperZoneTap: (price: number) =>
    sendTelegramAlert({
      type: 'zoneTap',
      title: 'Upper Zone Tapped',
      price,
      details: ['Potential SHORT setup'],
    }),

  lowerZoneTap: (price: number) =>
    sendTelegramAlert({
      type: 'zoneTap',
      title: 'Lower Zone Tapped',
      price,
      details: ['Potential LONG setup'],
    }),

  // Order alerts
  orderPlaced: (side: string, price: number, stopLoss?: number, takeProfit?: number) =>
    sendTelegramAlert({
      type: 'orderPlaced',
      title: `${side.toUpperCase()} Order Placed`,
      price,
      details: [
        stopLoss ? `Stop Loss: $${stopLoss.toFixed(2)}` : '',
        takeProfit ? `Take Profit: $${takeProfit.toFixed(2)}` : '',
      ].filter(Boolean),
    }),

  orderFilled: (side: string, price: number) =>
    sendTelegramAlert({
      type: 'orderFilled',
      title: `${side.toUpperCase()} Order Filled`,
      price,
    }),

  stopHit: (price: number, pnl?: number) =>
    sendTelegramAlert({
      type: 'stopHit',
      title: 'Stop Loss Hit',
      price,
      details: pnl !== undefined ? [`P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`] : undefined,
    }),

  tpHit: (price: number, pnl?: number) =>
    sendTelegramAlert({
      type: 'tpHit',
      title: 'Take Profit Hit',
      price,
      details: pnl !== undefined ? [`P&L: +$${pnl.toFixed(2)}`] : undefined,
    }),

  breakeven: (price: number) =>
    sendTelegramAlert({
      type: 'breakeven',
      title: 'Stop Moved to Breakeven',
      price,
    }),

  // Overnight alerts
  overnightOrdersPlaced: (sellEntry: number, buyEntry: number) =>
    sendTelegramAlert({
      type: 'overnight',
      title: 'Overnight Orders Placed',
      details: [
        `SELL LIMIT @ $${sellEntry.toFixed(2)}`,
        `BUY LIMIT @ $${buyEntry.toFixed(2)}`,
      ],
    }),

  overnightZoneTapped: (zone: 'upper' | 'lower', price: number) =>
    sendTelegramAlert({
      type: 'overnight',
      title: `Overnight ${zone.toUpperCase()} Zone Tapped`,
      price,
      details: [zone === 'upper' ? 'SELL entry filled' : 'BUY entry filled'],
    }),

  // Custom message
  custom: (title: string, details?: string[], price?: number) =>
    sendTelegramAlert({
      type: 'info',
      title,
      details,
      price,
    }),
};

/**
 * Configure Telegram settings
 */
export function configureTelegram(botToken: string, chatId: string, enabled: boolean = true) {
  TELEGRAM_CONFIG.botToken = botToken;
  TELEGRAM_CONFIG.chatId = chatId;
  TELEGRAM_CONFIG.enabled = enabled;

  // Persist to localStorage
  localStorage.setItem('telegram_bot_token', botToken);
  localStorage.setItem('telegram_chat_id', chatId);
  localStorage.setItem('telegram_enabled', enabled.toString());

  console.log('[Telegram] Configuration updated');
}

/**
 * Test the Telegram connection
 */
export async function testTelegramConnection(): Promise<boolean> {
  return sendTelegramMessage('🤖 <b>Horizon Alpha Terminal</b>\n\n✅ Telegram alerts connected successfully!');
}

/**
 * Check if Telegram is configured
 */
export function isTelegramConfigured(): boolean {
  return !!(TELEGRAM_CONFIG.botToken && TELEGRAM_CONFIG.chatId);
}

/**
 * Enable/disable Telegram alerts
 */
export function setTelegramEnabled(enabled: boolean) {
  TELEGRAM_CONFIG.enabled = enabled;
  localStorage.setItem('telegram_enabled', enabled.toString());
}

/**
 * Horizon Commands - Auto-fetch from window.__horizonState
 * Call these from browser console - no parameters needed!
 */

// command1 - Current price (from Live Market Data panel)
export const command1 = () => {
  const live = (window as any).__liveMarketData;
  const state = (window as any).__horizonState;
  const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

  // Try live market data first, fall back to state
  const price = live?.price ?? state?.currentPrice;

  if (!price) {
    return sendTelegramMessage('⚠️ Price not available - waiting for market data');
  }

  let text = `💵 <b>Live Market Price</b>\n🕐 ${now} EST\n\n`;
  text += `<b>Last:</b> $${price.toFixed(2)}\n`;

  if (live) {
    if (live.bid) text += `<b>Bid:</b> $${live.bid.toFixed(2)}\n`;
    if (live.ask) text += `<b>Ask:</b> $${live.ask.toFixed(2)}\n`;
    if (live.change !== null) {
      const sign = live.change >= 0 ? '+' : '';
      text += `\n<b>Change:</b> ${sign}${live.change.toFixed(2)}`;
      if (live.changePercent !== null) {
        text += ` (${sign}${live.changePercent.toFixed(2)}%)`;
      }
      text += `\n`;
    }
    if (live.high) text += `<b>High:</b> $${live.high.toFixed(2)}\n`;
    if (live.low) text += `<b>Low:</b> $${live.low.toFixed(2)}\n`;
  }

  return sendTelegramMessage(text);
};

// command2 - Current Zones (S1, Lower, Upper, R1 + Open)
export const command2 = () => {
  const state = (window as any).__horizonState;
  if (!state) {
    return sendTelegramMessage('⚠️ Zone data not available - UI not loaded');
  }

  const { zones, zonesEnabled, zoneSize, openPrice } = state;
  const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

  let text = `📊 <b>Zone Levels</b>\n🕐 ${now} EST\n\n`;

  // S1 (Support 1)
  if (zones.s1) {
    const status = zonesEnabled?.lower !== false ? '✅' : '❌';
    text += `${status} <b>S1:</b> $${(zones.s1 - zoneSize).toFixed(2)} - $${zones.s1.toFixed(2)}\n`;
  }

  // Lower Zone
  if (zones.lower) {
    const status = zonesEnabled?.lower !== false ? '✅' : '❌';
    text += `${status} <b>Lower:</b> $${(zones.lower - zoneSize).toFixed(2)} - $${zones.lower.toFixed(2)}\n`;
  }

  // Upper Zone
  if (zones.upper) {
    const status = zonesEnabled?.upper !== false ? '✅' : '❌';
    text += `${status} <b>Upper:</b> $${zones.upper.toFixed(2)} - $${(zones.upper + zoneSize).toFixed(2)}\n`;
  }

  // R1 (Resistance 1)
  if (zones.r1) {
    const status = zonesEnabled?.upper !== false ? '✅' : '❌';
    text += `${status} <b>R1:</b> $${zones.r1.toFixed(2)} - $${(zones.r1 + zoneSize).toFixed(2)}\n`;
  }

  // Open Price (last)
  if (openPrice) {
    text += `\n📍 <b>Open:</b> $${openPrice.toFixed(2)}`;
  }

  return sendTelegramMessage(text);
};

// command3 - Full status (price, zones, wave engine)
export const command3 = () => {
  const state = (window as any).__horizonState;
  const wave = (window as any).__waveEngine;
  const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

  if (!state) {
    return sendTelegramMessage('⚠️ State not available - UI not loaded');
  }

  const { currentPrice } = state;

  let text = `📊 <b>Horizon Alpha Status</b>\n🕐 ${now} EST\n\n`;

  if (currentPrice) {
    text += `💵 <b>Price:</b> $${currentPrice.toFixed(2)}\n\n`;
  }

  // Wave Engine status
  if (wave) {
    text += `<b>Wave Engine:</b>\n`;
    text += `• State: ${wave.state || 'IDLE'}\n`;
    text += `• Window: ${wave.activeWindow || 'None'}\n`;
    text += `• Direction: ${wave.direction || 'None'}\n`;
    if (wave.logs && wave.logs.length > 0) {
      wave.logs.slice(-3).forEach((log: string) => {
        text += `  → ${log}\n`;
      });
    }
  } else {
    text += `<b>Wave:</b> ❌ Not running\n`;
  }

  return sendTelegramMessage(text);
};

// command4 - Wave engine status with logs
export const command4 = () => {
  const wave = (window as any).__waveEngine;
  if (!wave) {
    return sendTelegramMessage('⚠️ Wave Engine not running');
  }

  const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
  let text = `🌊 <b>Wave Engine Status</b>\n🕐 ${now} EST\n\n`;
  text += `• State: ${wave.state || 'IDLE'}\n`;
  text += `• Window: ${wave.activeWindow || 'None'}\n`;
  text += `• Direction: ${wave.direction || 'None'}\n`;
  text += `• Stack: ${wave.stackStatus || 'None'}\n`;

  if (wave.logs && wave.logs.length > 0) {
    text += `\n<b>Recent Logs:</b>\n`;
    wave.logs.slice(-5).forEach((log: string) => {
      text += `  → ${log}\n`;
    });
  }

  return sendTelegramMessage(text);
};

// command5 - Reserved
export const command5 = () => {
  return sendTelegramMessage('ℹ️ Command reserved for future use');
};

// command6 - Wave engine automation status
export const command6 = () => {
  const wave = (window as any).__waveEngine;
  const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

  let text = `🤖 <b>Automation Status</b>\n🕐 ${now} EST\n\n`;

  if (wave) {
    text += `<b>Wave (EMA Stack):</b>\n`;
    text += `• State: ${wave.state || 'IDLE'}\n`;
    text += `• W1 trade: ${wave.tradeTakenW1 ? '✅' : '⏳'}\n`;
    text += `• W2 trade: ${wave.tradeTakenW2 ? '✅' : '⏳'}\n`;
    text += `• W3 trade: ${wave.tradeTakenW3 ? '✅' : '⏳'}\n`;

    if (wave.logs && wave.logs.length > 0) {
      wave.logs.slice(-3).forEach((log: string) => {
        text += `  → ${log}\n`;
      });
    }
  } else {
    text += `<b>Wave:</b> ❌ Not running\n`;
  }

  return sendTelegramMessage(text);
};

/**
 * Real-time Event Alerts - Auto-send to Telegram when events happen
 */
export const sendEventAlert = (
  engine: 'Wave' | 'Manual',
  eventType: 'breakout' | 'retest' | 'entry' | 'zone-tap' | 'sweep' | 'wick' | 'overnight' | 'breakeven' | 'tp-hit' | 'stop-hit' | 'info',
  message: string,
  price?: number
) => {
  if (!TELEGRAM_CONFIG.enabled) return;

  const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

  // Event type emojis
  const emojis: Record<string, string> = {
    'breakout': '🚀',
    'retest': '🔄',
    'entry': '📝',
    'zone-tap': '🎯',
    'sweep': '🧹',
    'wick': '📍',
    'overnight': '🌙',
    'breakeven': '🔒',
    'tp-hit': '💰',
    'stop-hit': '🛑',
    'info': 'ℹ️'
  };

  const emoji = emojis[eventType] || 'ℹ️';

  let text = `${emoji} <b>${engine}</b>\n🕐 ${now} EST\n\n`;
  text += message;

  if (price) {
    text += `\n💵 $${price.toFixed(2)}`;
  }

  return sendTelegramMessage(text);
};

// command7 - Shows all commands
export const command7 = () =>
  sendTelegramMessage(
    `🤖 <b>Horizon Alpha Commands</b>\n\n` +
    `All commands auto-fetch live data:\n\n` +
    `• <code>command1()</code> - Current price\n` +
    `• <code>command2()</code> - Current zones\n` +
    `• <code>command3()</code> - Full status\n` +
    `• <code>command4()</code> - Wave engine status\n` +
    `• <code>command5()</code> - Reserved\n` +
    `• <code>command6()</code> - Automation status\n` +
    `• <code>command7()</code> - This help`
  );

// Expose globally for easy console access
if (typeof window !== 'undefined') {
  // Horizon Commands
  (window as any).command1 = command1;  // Current price
  (window as any).command2 = command2;  // Current zones
  (window as any).command3 = command3;  // Full status
  (window as any).command4 = command4;  // Wave engine status
  (window as any).command5 = command5;  // Reserved
  (window as any).command6 = command6;  // Automation status
  (window as any).command7 = command7;  // Help
  // Event Alert (for engines to call)
  (window as any).sendEventAlert = sendEventAlert;
  // Alerts & Config
  (window as any).TelegramAlerts = TelegramAlerts;
  (window as any).configureTelegram = configureTelegram;
  (window as any).testTelegramConnection = testTelegramConnection;
  (window as any).setTelegramEnabled = setTelegramEnabled;
}

export default TelegramAlerts;
