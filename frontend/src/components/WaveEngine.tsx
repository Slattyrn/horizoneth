import { useEffect, useRef, memo, useCallback } from 'react';
import { CandleData } from '../hooks/useAutomation';

/**
 * =============================================================================
 * WAVE ENGINE — Wave → touch EMA6 → reclaim → MARKET (1:1 RR)
 * =============================================================================
 *
 * Runs on whatever timeframe the chart is currently showing (feed = App.tsx `candles`).
 * Indicators: EMA 6 / 12 / 18 (wave stack) + EMA 35 (bias).
 *
 * The setup (no time limits):
 *   1. CLEAR WAVE            — EMAs stacked and all three sloping the same way
 *                              (e6 > e12 > e18 rising for long; inverse for short)
 *                              + bias: close > EMA35 for long / < for short.
 *   2. PB SERIES STARTS      — any opposite-colour candle prints (red in an
 *                              up-wave; green in a down-wave).
 *   3. EMA6 TOUCH            — while the PB series runs, any bar must wick to
 *                              within `ema6WickPts` of EMA 6 (once confirmed,
 *                              stays confirmed for the life of the series).
 *   4. RECLAIM               — price trades 1 tick beyond the PB-series' highest
 *                              high (long) / lowest low (short). Fires MARKET.
 *
 * The PB series is the opposite-colour candle + every subsequent bar until the
 * reclaim trigger. SL is the extreme of the whole series, TP is 1:1.
 *
 * Levels (all snapped to tick grid):
 *   Entry trigger = series high + 1 tick (long) / series low  − 1 tick (short)
 *   SL            = series low  − 1 tick (long) / series high + 1 tick (short)
 *   TP            = entry ± (SL distance × rrRatio)   [rrRatio defaults to 1.0]
 *   Qty           = sized so risk lands in [riskAmt − 75, riskAmt + 75].
 *
 * Bracket flow: entry (market) + SL (stop) + TP (limit) all submitted together
 * via handleAutomationOrderPlacement — same pipeline manual market orders use.
 *
 * State machine:
 *   IDLE      — scanning for wave + opposite candle on each closed bar
 *   PB_WAIT   — PB series running; updates series extremes / touch flag each bar;
 *               ticks trigger the reclaim → MARKET entry
 *   IN_TRADE  — market entry fired, tracking SL / TP for session P&L
 *   DONE      — session locked (one trade or daily risk hit)
 *
 * Time gate: 09:25 → 11:00 ET by default. testMode bypasses it for ETH testing.
 * =============================================================================
 */

const DEBUG = true;

// ─── Signal types for chart overlay rendering ─────────────────────────────
export interface WaveSignal {
  type: 'pb' | 'armed' | 'entry' | 'sl' | 'tp' | 'timeout';
  time: number;
  price: number;
  side: 1 | -1;
  label?: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

interface WaveConfig {
  tickSize: number;
  tickValue: number;
  riskAmt: number;
  minRiskTicks: number;
  rrRatio: number;
  dailyStopLoss: number;
  dailyProfitTarget: number;
  testMode: boolean;
  /** Max distance (points) between the PB wick and EMA6 to qualify as a pullback. */
  ema6WickPts: number;
  /** Max number of bars after the PB bar to wait for a wick reclaim. */
  maxReclaimBars: number;
  /** Minimum points between EMA 6 and EMA 12 to count as a clean wave. */
  minEmaGap612: number;
  /** Minimum points between EMA 12 and EMA 18 (tends to compress slower than 6↔12). */
  minEmaGap1218: number;
}

const DEFAULT_CONFIG: WaveConfig = {
  tickSize: 1.0,
  tickValue: 0.50,
  riskAmt: 500,
  minRiskTicks: 4,
  rrRatio: 1.0,
  dailyStopLoss: -550,
  dailyProfitTarget: 400,
  testMode: false,
  ema6WickPts: 2,
  maxReclaimBars: 9999, // effectively disabled — setup has no bar timeout
  minEmaGap612: 2.75,
  minEmaGap1218: 2.0,
};

// ─── Bar type ───────────────────────────────────────────────────────────────

interface BarData {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

// ─── State enum ──────────────────────────────────────────────────────────────

type EngineState = 'IDLE' | 'PB_WAIT' | 'IN_TRADE' | 'DONE';

// ─── Callbacks ───────────────────────────────────────────────────────────────

interface WaveCallbacks {
  onEntry: (side: 1 | -1, qty: number, ep: number, sl: number, tp: number) => void;
  onCancel: () => void;
}

// ─── Core engine class (pure logic, no React) ───────────────────────────────

class WaveReclaimEngine {
  private cfg: WaveConfig;
  private cb: WaveCallbacks;

  // EMA state (incremental)
  private ema6 = 0;
  private ema13 = 0;
  private ema21 = 0;
  private ema35 = 0;
  private prevEma6 = 0;
  private prevEma13 = 0;
  private prevEma21 = 0;

  private barCount = 0;
  private prevBar: BarData | null = null;

  state: EngineState = 'IDLE';
  side: 1 | -1 = 1;
  doneSess = false;

  // When non-null, this takes precedence over the engine's own hypothetical
  // dailyPnL for the daily stop/target lock (set from App.tsx balance polling).
  externalDailyPnL: number | null = null;

  private entryPrice = 0;
  private stopPrice = 0;
  private tpPrice = 0;
  private pendingQty = 0;
  private armedBarCount = 0;

  // PB_WAIT — series-level state (opposite-colour bar + every bar until reclaim)
  private pbSeriesHigh = 0;
  private pbSeriesLow = 0;
  private pbTouchedEma6 = false;
  private triggerLevel = 0;

  private sessionDate = '';

  logs: string[] = [];
  signals: WaveSignal[] = [];

  lastEntry = 0;
  lastSL = 0;
  lastTP = 0;

  dailyPnL = 0;
  dailyLockReason = '';
  private lastTradeEntry = 0;
  private lastTradeSide: 1 | -1 = 1;
  private lastTradeQty = 0;

  constructor(cfg: Partial<WaveConfig> = {}, cb: WaveCallbacks) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.cb = cb;
  }

  log(msg: string): void {
    const ts = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const entry = `[${ts}] ${msg}`;
    this.logs = [...this.logs.slice(-99), entry];
    if (DEBUG) console.log(`[WaveEngine] ${entry}`);
  }

  private emitSignal(type: WaveSignal['type'], time: number, price: number, label?: string): void {
    this.signals.push({ type, time, price, side: this.side, label });
  }

  private initOrUpdateEMA(prev: number, close: number, period: number, isFirst: boolean): number {
    if (isFirst) return close;
    const k = 2 / (period + 1);
    return close * k + prev * (1 - k);
  }

  private getETDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  }

  private getETMinutes(ts: number): number {
    const d = new Date(ts);
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return et.getHours() * 60 + et.getMinutes();
  }

  private snap(price: number): number {
    return Math.round(price / this.cfg.tickSize) * this.cfg.tickSize;
  }

  // Pick qty so total risk lands near riskAmt, preferring the lower contract count.
  private computeQty(slDist: number): number {
    const stopTicks = Math.round(slDist / this.cfg.tickSize);
    if (stopTicks < this.cfg.minRiskTicks) return 0;

    const riskPerContract = slDist * this.cfg.tickValue;
    const minRisk = this.cfg.riskAmt - 75;
    const maxRisk = this.cfg.riskAmt + 75;

    const qtyLow = Math.floor(this.cfg.riskAmt / riskPerContract);
    const qtyHigh = qtyLow + 1;
    const riskLow = qtyLow * riskPerContract;
    const riskHigh = qtyHigh * riskPerContract;

    const lowInRange = qtyLow >= 1 && riskLow >= minRisk && riskLow <= maxRisk;
    const highInRange = qtyHigh >= 1 && riskHigh >= minRisk && riskHigh <= maxRisk;

    if (lowInRange) return qtyLow;
    if (highInRange) return qtyHigh;
    if (qtyLow >= 1) return qtyLow;
    return 1;
  }

  private markDone(reason: string): void {
    // In testMode the engine is uncapped — skip the session lock so a TP/SL
    // (or daily stop/target) doesn't freeze the engine. Live mode keeps the
    // one-trade-per-session discipline.
    if (this.cfg.testMode) {
      this.log(`TEST MODE — continuing after ${reason} | Daily P&L: $${this.dailyPnL.toFixed(2)}`);
      this.resetToIdle(reason);
      return;
    }
    this.log(`SESSION DONE (${reason})`);
    this.doneSess = true;
    this.state = 'DONE';
  }

  private resetToIdle(reason: string): void {
    if (this.state !== 'IDLE' && this.state !== 'DONE') {
      this.log(`RESET → IDLE (${reason})`);
    }
    this.state = 'IDLE';
    this.armedBarCount = 0;
    this.entryPrice = 0;
    this.stopPrice = 0;
    this.tpPrice = 0;
    this.pendingQty = 0;
    this.pbSeriesHigh = 0;
    this.pbSeriesLow = 0;
    this.pbTouchedEma6 = false;
    this.triggerLevel = 0;
  }

  // Recompute trigger / SL / TP / qty from the current series high+low.
  // Called when the series first starts and every time a new bar extends the extremes.
  private updatePbLevels(): void {
    const ts = this.cfg.tickSize;
    if (this.side === 1) {
      const ep = this.snap(this.pbSeriesHigh + ts);
      const sl = this.snap(this.pbSeriesLow - ts);
      const slDist = ep - sl;
      const tp = this.snap(ep + slDist * this.cfg.rrRatio);
      this.triggerLevel = ep;
      this.entryPrice = ep;
      this.stopPrice = sl;
      this.tpPrice = tp;
      this.pendingQty = this.computeQty(slDist);
    } else {
      const ep = this.snap(this.pbSeriesLow - ts);
      const sl = this.snap(this.pbSeriesHigh + ts);
      const slDist = sl - ep;
      const tp = this.snap(ep - slDist * this.cfg.rrRatio);
      this.triggerLevel = ep;
      this.entryPrice = ep;
      this.stopPrice = sl;
      this.tpPrice = tp;
      this.pendingQty = this.computeQty(slDist);
    }
    this.lastEntry = this.entryPrice;
    this.lastSL = this.stopPrice;
    this.lastTP = this.tpPrice;
  }

  // Stage a pullback — series running; waiting for EMA6 touch + reclaim
  private armPullback(source: string): void {
    this.log(`${source} PB staged — seriesHi ${this.pbSeriesHigh.toFixed(2)} seriesLo ${this.pbSeriesLow.toFixed(2)} trigger ${this.triggerLevel.toFixed(2)} SL ${this.stopPrice.toFixed(2)} TP ${this.tpPrice.toFixed(2)} touch=${this.pbTouchedEma6} qty=${this.pendingQty}`);
    this.state = 'PB_WAIT';
    this.armedBarCount = 0;
  }

  // Fire the market entry on reclaim trigger
  private fireMarketEntry(source: string): void {
    this.log(`${source} RECLAIM @ ${this.entryPrice.toFixed(2)} — firing MARKET | SL ${this.stopPrice.toFixed(2)} TP ${this.tpPrice.toFixed(2)} qty=${this.pendingQty}`);
    this.cb.onEntry(this.side, this.pendingQty, this.entryPrice, this.stopPrice, this.tpPrice);
    this.lastTradeEntry = this.entryPrice;
    this.lastTradeSide = this.side;
    this.lastTradeQty = this.pendingQty;
    this.state = 'IN_TRADE';
  }

  // Seed EMAs from historical bars so the engine doesn't cold-start on mount or TF
  // switch. Resets EMA + warmup state, then silently runs each bar through the EMA
  // updaters — no state-machine evaluation, no signals. Sets sessionDate to the latest
  // bar's ET date so the normal day-reset doesn't fire on the next live bar.
  seedHistoricalBars(bars: BarData[]): void {
    if (this.state !== 'IDLE') {
      this.log(`Seed skipped — engine in ${this.state}`);
      return;
    }
    this.ema6 = 0; this.ema13 = 0; this.ema21 = 0; this.ema35 = 0;
    this.prevEma6 = 0; this.prevEma13 = 0; this.prevEma21 = 0;
    this.barCount = 0;
    this.prevBar = null;

    for (const bar of bars) {
      const isFirst = this.barCount === 0;
      this.prevEma6 = this.ema6;
      this.prevEma13 = this.ema13;
      this.prevEma21 = this.ema21;
      this.ema6 = this.initOrUpdateEMA(this.ema6, bar.close, 7, isFirst);
      this.ema13 = this.initOrUpdateEMA(this.ema13, bar.close, 13, isFirst);
      this.ema21 = this.initOrUpdateEMA(this.ema21, bar.close, 21, isFirst);
      this.ema35 = this.initOrUpdateEMA(this.ema35, bar.close, 35, isFirst);
      this.barCount++;
      this.prevBar = bar;
    }

    if (bars.length > 0) {
      this.sessionDate = this.getETDate(bars[bars.length - 1].timestamp);
    }

    this.log(`Seeded ${bars.length} bars — EMAs warm | e6 ${this.ema6.toFixed(2)} e13 ${this.ema13.toFixed(2)} e21 ${this.ema21.toFixed(2)} e35 ${this.ema35.toFixed(2)}`);
  }

  onBar(bar: BarData): void {
    const isFirst = this.barCount === 0;
    this.barCount++;

    // Session day reset
    const dateStr = this.getETDate(bar.timestamp);
    if (dateStr !== this.sessionDate) {
      this.sessionDate = dateStr;
      this.doneSess = false;
      this.dailyLockReason = '';
      this.state = 'IDLE';
      this.barCount = 1;
      this.prevBar = null;
      this.prevEma6 = 0;
      this.prevEma13 = 0;
      this.prevEma21 = 0;
      this.dailyPnL = 0;
      this.signals = [];
      this.log(`New session: ${dateStr} — daily P&L reset`);
    }

    // EMAs — update previous, then current
    this.prevEma6 = this.ema6;
    this.prevEma13 = this.ema13;
    this.prevEma21 = this.ema21;

    this.ema6 = this.initOrUpdateEMA(this.ema6, bar.close, 7, isFirst);
    this.ema13 = this.initOrUpdateEMA(this.ema13, bar.close, 13, isFirst);
    this.ema21 = this.initOrUpdateEMA(this.ema21, bar.close, 21, isFirst);
    this.ema35 = this.initOrUpdateEMA(this.ema35, bar.close, 35, isFirst);

    // Warmup — need EMA35 to settle
    if (this.barCount < 36) {
      this.prevBar = bar;
      return;
    }

    // Time gate
    const etMin = this.getETMinutes(bar.timestamp);
    const SCAN_START = 9 * 60 + 25;
    const SESS_END = 11 * 60;
    const inScan = this.cfg.testMode ? true : (etMin >= SCAN_START && etMin < SESS_END);

    // Daily risk lock — prefer the broker-derived P&L when it's available
    const effectivePnL = this.externalDailyPnL !== null ? this.externalDailyPnL : this.dailyPnL;
    if (!this.doneSess && this.state !== 'IN_TRADE') {
      if (effectivePnL <= this.cfg.dailyStopLoss) {
        this.dailyLockReason = 'Daily stop hit';
        this.markDone('daily stop loss hit');
        this.prevBar = bar;
        return;
      }
      if (effectivePnL >= this.cfg.dailyProfitTarget) {
        this.dailyLockReason = 'Daily target hit';
        this.markDone('daily profit target hit');
        this.prevBar = bar;
        return;
      }
    }

    // Session close (skipped in testMode)
    if (!this.cfg.testMode && etMin >= SESS_END && this.state === 'IDLE') {
      this.prevBar = bar;
      return;
    }

    if (this.doneSess) {
      this.prevBar = bar;
      return;
    }

    // State machine
    if (this.state === 'IDLE') {
      if (!inScan) { this.prevBar = bar; return; }

      const e6 = this.ema6;
      const e35 = this.ema35;
      // Wave check uses PREVIOUS bar's EMAs so the pullback bar we're evaluating
      // doesn't get to veto its own setup by compressing EMA 6 on its own close.
      const pe6 = this.prevEma6, pe12 = this.prevEma13, pe18 = this.prevEma21;
      const g612 = this.cfg.minEmaGap612;
      const g1218 = this.cfg.minEmaGap1218;
      const stackedUp = (pe6 - pe12) >= g612 && (pe12 - pe18) >= g1218;
      const stackedDown = (pe12 - pe6) >= g612 && (pe18 - pe12) >= g1218;
      const isRed = bar.close < bar.open;
      const isGreen = bar.close > bar.open;

      // IDLE: wave + opposite-colour candle → start a PB series.
      const wickTol = this.cfg.ema6WickPts;
      const longSetup = stackedUp && bar.close > e35 && isRed;
      const shortSetup = stackedDown && bar.close < e35 && isGreen;

      if (longSetup) {
        this.side = 1;
        this.pbSeriesHigh = bar.high;
        this.pbSeriesLow = bar.low;
        this.pbTouchedEma6 = bar.low <= e6 + wickTol;  // touch can be the opener
        this.updatePbLevels();
        this.emitSignal('pb', bar.timestamp, bar.low, this.pbTouchedEma6 ? 'PB+TOUCH' : 'PB');
        this.emitSignal('armed', bar.timestamp, this.triggerLevel, 'RECLAIM LVL');
        this.armPullback('TREND LONG');
      } else if (shortSetup) {
        this.side = -1;
        this.pbSeriesHigh = bar.high;
        this.pbSeriesLow = bar.low;
        this.pbTouchedEma6 = bar.high >= e6 - wickTol;
        this.updatePbLevels();
        this.emitSignal('pb', bar.timestamp, bar.high, this.pbTouchedEma6 ? 'PB+TOUCH' : 'PB');
        this.emitSignal('armed', bar.timestamp, this.triggerLevel, 'RECLAIM LVL');
        this.armPullback('TREND SHORT');
      } else {
        // Diagnostic — one line per closed IDLE bar showing what's blocking a setup.
        const col = isRed ? 'R' : isGreen ? 'G' : 'D';
        const biasLabel = bar.close > e35 ? '>e35' : bar.close < e35 ? '<e35' : '=e35';
        this.log(`IDLE: stackUp=${stackedUp ? 'Y' : 'N'} stackDn=${stackedDown ? 'Y' : 'N'} bias=${biasLabel} col=${col} | gap612=${(pe6 - pe12).toFixed(2)}/${g612} gap1218=${(pe12 - pe18).toFixed(2)}/${g1218}`);
      }
    }
    else if (this.state === 'PB_WAIT') {
      this.armedBarCount++;

      // Extend the series with this bar: update high/low extremes + EMA6 touch flag
      this.pbSeriesHigh = Math.max(this.pbSeriesHigh, bar.high);
      this.pbSeriesLow = Math.min(this.pbSeriesLow, bar.low);
      if (!this.pbTouchedEma6) {
        const wickTol = this.cfg.ema6WickPts;
        if (this.side === 1 && bar.low <= this.ema6 + wickTol) this.pbTouchedEma6 = true;
        else if (this.side === -1 && bar.high >= this.ema6 - wickTol) this.pbTouchedEma6 = true;
        if (this.pbTouchedEma6) {
          this.emitSignal('pb', bar.timestamp, this.side === 1 ? bar.low : bar.high, 'EMA6 TOUCH');
        }
      }
      this.updatePbLevels();

      // Bar-level reclaim check — only valid once EMA6 touch is confirmed
      if (this.pbTouchedEma6) {
        const reclaimedOnBar = this.side === 1
          ? bar.high >= this.triggerLevel
          : bar.low <= this.triggerLevel;
        if (reclaimedOnBar) {
          this.fireMarketEntry('TREND BAR');
        }
      }
    }
    else if (this.state === 'IN_TRADE') {
      // Track SL / TP hits for local P&L; broker is the source of truth for fills.
      const slHit = this.side === 1 ? bar.low <= this.stopPrice : bar.high >= this.stopPrice;
      const tpHit = this.side === 1 ? bar.high >= this.tpPrice : bar.low <= this.tpPrice;

      if (tpHit) {
        const pnl = this.lastTradeSide === 1
          ? (this.tpPrice - this.lastTradeEntry) * this.lastTradeQty * this.cfg.tickValue
          : (this.lastTradeEntry - this.tpPrice) * this.lastTradeQty * this.cfg.tickValue;
        this.dailyPnL += pnl;
        this.dailyLockReason = 'Trade complete';
        this.log(`TP HIT @ ${this.tpPrice.toFixed(2)} — P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Daily: $${this.dailyPnL.toFixed(2)}`);
        this.emitSignal('tp', bar.timestamp, this.tpPrice, 'TP HIT');
        this.markDone('TP hit');
      } else if (slHit) {
        const pnl = this.lastTradeSide === 1
          ? (this.stopPrice - this.lastTradeEntry) * this.lastTradeQty * this.cfg.tickValue
          : (this.lastTradeEntry - this.stopPrice) * this.lastTradeQty * this.cfg.tickValue;
        this.dailyPnL += pnl;
        this.dailyLockReason = 'Trade complete';
        this.log(`SL HIT @ ${this.stopPrice.toFixed(2)} — P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Daily: $${this.dailyPnL.toFixed(2)}`);
        this.emitSignal('sl', bar.timestamp, this.stopPrice, 'SL HIT');
        this.markDone('SL hit');
      }
    }

    this.prevBar = bar;
  }

  // Real-time tick — fires the market entry on the first tick past the trigger,
  // but only once the series has touched EMA 6 at least once.
  onTick(price: number): void {
    if (this.state !== 'PB_WAIT') return;
    if (!this.pbTouchedEma6) return;
    const reclaimed = this.side === 1 ? price >= this.triggerLevel : price <= this.triggerLevel;
    if (reclaimed) this.fireMarketEntry('TREND TICK');
  }

  confirmFill(): void {
    if (this.state === 'PB_WAIT') this.fireMarketEntry('BROKER');
  }

  cancel(): void {
    if (this.state === 'IN_TRADE') {
      this.markDone('manual cancel while in trade');
    } else {
      this.state = 'DONE';
      this.doneSess = true;
    }
    this.cb.onCancel();
    this.log('Manual cancel — session marked done');
  }

  getStateLabel(): string {
    switch (this.state) {
      case 'IDLE': return this.getIdleLabel();
      case 'PB_WAIT': {
        const progress = `${this.armedBarCount}/${this.cfg.maxReclaimBars}`;
        if (!this.pbTouchedEma6) return `PB staged — awaiting EMA6 touch (${progress})`;
        return `PB armed @ ${this.triggerLevel.toFixed(2)} — reclaim pending (${progress})`;
      }
      case 'IN_TRADE': return `Position active (SL ${this.stopPrice.toFixed(2)} / TP ${this.tpPrice.toFixed(2)})`;
      case 'DONE': return this.dailyLockReason ? `Session locked — ${this.dailyLockReason}` : 'Session complete — engine locked';
    }
  }

  // Drill into IDLE to say exactly what the engine is waiting on so the UI
  // can progress past "Scanning for setup" as each precondition is met.
  private getIdleLabel(): string {
    if (this.barCount === 0) return 'Waiting for chart data';
    if (this.barCount < 36) return `Warming up (${this.barCount}/36 bars)`;
    const pe6 = this.prevEma6, pe12 = this.prevEma13, pe18 = this.prevEma21;
    const g612 = this.cfg.minEmaGap612;
    const g1218 = this.cfg.minEmaGap1218;
    const stackedUp = (pe6 - pe12) >= g612 && (pe12 - pe18) >= g1218;
    const stackedDown = (pe12 - pe6) >= g612 && (pe18 - pe12) >= g1218;
    if (!stackedUp && !stackedDown) return 'Scanning — no clean wave';
    if (!this.prevBar) return stackedUp ? 'Up-wave — waiting for bar' : 'Down-wave — waiting for bar';
    const biasOk = stackedUp ? this.prevBar.close > this.ema35 : this.prevBar.close < this.ema35;
    const dir = stackedUp ? 'Up' : 'Down';
    if (!biasOk) return `${dir}-wave — bias not aligned with EMA35`;
    const needColour = stackedUp ? 'red' : 'green';
    return `${dir}-wave clean — waiting for ${needColour} pullback candle`;
  }
}

// ─── Props ───────────────────────────────────────────────────────────────

interface WaveEngineProps {
  enabled: boolean;
  ticker: 'GC';
  candles5min: CandleData[];
  /** Bar stream the engine consumes — whatever TF the chart is currently showing. */
  candles: CandleData[];
  currentPrice: number | null;
  vwap?: number | null;      // unused — kept for backward compatibility with callers
  sma200?: number | null;    // unused — kept for backward compatibility with callers
  testMode?: boolean;
  /** Broker-derived session P&L. When provided, overrides the engine's internal
   *  hypothetical P&L for daily stop/target lock decisions and sidebar display. */
  externalDailyPnL?: number | null;
  config: {
    targetRiskMin: number;
    targetRiskMax: number;
    tickSize: number;
    tickValue: number;
    autoPlaceOrders: boolean;
  };
  onOrderPlacement: (order: {
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    orderType: 'market' | 'limit' | 'stop';
    limitPrice?: number;
    stopPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    localOrderId: string;
  }) => void;
  onOrderCancel?: (orderId: string) => void;
  onEngineDisable?: () => void;
}

function WaveEngine({
  enabled,
  ticker,
  candles,
  currentPrice,
  testMode = false,
  externalDailyPnL = null,
  config,
  onOrderPlacement,
}: WaveEngineProps) {

  const engineRef = useRef<WaveReclaimEngine | null>(null);
  const lastProcessedRef = useRef<number>(0);
  // Bar spacing (seconds between consecutive bars) of the last-seeded feed — lets us
  // detect TF switches and re-seed EMAs from the new timeframe's history.
  const seededSpacingRef = useRef<number | null>(null);
  // Latest candles reference — lets the init effect seed immediately on engine
  // re-creation instead of waiting for the next bar close to trigger the feed effect.
  const candlesRef = useRef<CandleData[]>(candles);
  candlesRef.current = candles;
  const activeOrderIdRef = useRef<string | null>(null);
  const activePositionRef = useRef<{
    localOrderId: string;
    side: 'buy' | 'sell';
    entry: number;
    stopLoss: number;
    takeProfit: number;
  } | null>(null);

  // Map the common ticker to ProjectX's internal symbol id where they differ
  // (e.g. full Gold is `GC` commonly but `GCE` on Globex in the ProjectX catalog).
  const projectxSymbolId: Record<string, string> = { GC: 'GCE' };

  // Market entry fired on reclaim — same pipeline as a manual market order,
  // so App.tsx places entry (market) + SL (stop) + TP (limit) in one flow.
  const handleEntry = useCallback((side: 1 | -1, qty: number, ep: number, sl: number, tp: number) => {
    if (!config.autoPlaceOrders) return;

    const buySell = side === 1 ? 'buy' : 'sell';
    const localOrderId = `WAVE-${buySell.toUpperCase()}-${Date.now()}`;
    const symbolId = projectxSymbolId[ticker] ?? ticker;

    activeOrderIdRef.current = localOrderId;
    activePositionRef.current = { localOrderId, side: buySell, entry: ep, stopLoss: sl, takeProfit: tp };

    onOrderPlacement({
      symbol: `CON.F.US.${symbolId}.M26`,
      side: buySell,
      quantity: qty,
      orderType: 'market',
      stopLoss: sl,
      takeProfit: tp,
      localOrderId,
    });
  }, [config.autoPlaceOrders, ticker, onOrderPlacement]);

  const handleCancel = useCallback(() => {
    activeOrderIdRef.current = null;
    activePositionRef.current = null;
  }, []);

  // Initialize engine
  useEffect(() => {
    const engine = new WaveReclaimEngine(
      {
        tickSize: config.tickSize,
        tickValue: config.tickValue,
        riskAmt: (config.targetRiskMin + config.targetRiskMax) / 2,
        testMode,
      },
      {
        onEntry: handleEntry,
        onCancel: handleCancel,
      }
    );
    engineRef.current = engine;

    (window as any).__waveEngine = {
      get state() { return engine.state; },
      get stateLabel() { return engine.getStateLabel(); },
      get side() { return engine.side; },
      get logs() { return engine.logs; },
      get lastEntry() { return engine.lastEntry; },
      get lastSL() { return engine.lastSL; },
      get lastTP() { return engine.lastTP; },
      get doneSess() { return engine.doneSess; },
      get dailyPnL() { return engine.externalDailyPnL !== null ? engine.externalDailyPnL : engine.dailyPnL; },
      get dailyPnLSource() { return engine.externalDailyPnL !== null ? 'broker' : 'hypothetical'; },
      get dailyLockReason() { return engine.dailyLockReason; },
      get signals() { return engine.signals; },
      get activePosition() { return activePositionRef.current; },
      get entryOrderId() { return activeOrderIdRef.current; },
      get fillPrice() { return engine.lastEntry; },
      confirmFill: () => engine.confirmFill(),
      updateOrderId: (localId: string, realId: string) => {
        if (activePositionRef.current?.localOrderId === localId) {
          activeOrderIdRef.current = realId;
          engine.log(`Entry order confirmed: ${realId}`);
        }
      },
    };

    (window as any).cancelWaveOrders = () => { engine.cancel(); };

    // Fresh engine = force a re-seed next time candles arrive
    seededSpacingRef.current = null;
    lastProcessedRef.current = 0;

    // If candles are already populated (common on engine re-init from testMode /
    // config changes), seed immediately so we don't show "Waiting for chart data"
    // until the next bar closes.
    const existingCandles = candlesRef.current;
    if (existingCandles.length > 1) {
      const history = existingCandles.slice(0, -1).map(c => ({
        open: c.open, high: c.high, low: c.low, close: c.close, timestamp: c.time,
      }));
      engine.seedHistoricalBars(history);
      seededSpacingRef.current = existingCandles[1].time - existingCandles[0].time;
      const latest = existingCandles[existingCandles.length - 1];
      engine.onBar({
        open: latest.open, high: latest.high, low: latest.low, close: latest.close, timestamp: latest.time,
      });
      lastProcessedRef.current = latest.time;
    }

    return () => {
      engine.cancel();
      delete (window as any).__waveEngine;
      delete (window as any).cancelWaveOrders;
    };
  }, [config.tickSize, config.tickValue, config.targetRiskMin, config.targetRiskMax, testMode,
      handleEntry, handleCancel]);

  // Feed bars — seed EMAs from history on first arrival or TF switch, then stream live.
  useEffect(() => {
    if (!enabled || !engineRef.current || candles.length === 0) return;

    const engine = engineRef.current;
    const spacing = candles.length >= 2 ? candles[1].time - candles[0].time : null;
    const needsSeed = seededSpacingRef.current === null
      || (spacing !== null && seededSpacingRef.current !== spacing);

    if (needsSeed && candles.length > 1) {
      const history = candles.slice(0, -1).map(c => ({
        open: c.open, high: c.high, low: c.low, close: c.close, timestamp: c.time,
      }));
      engine.seedHistoricalBars(history);
      seededSpacingRef.current = spacing;
      lastProcessedRef.current = 0;
    }

    const latestCandle = candles[candles.length - 1];
    if (!latestCandle || latestCandle.time === lastProcessedRef.current) return;
    lastProcessedRef.current = latestCandle.time;

    engine.onBar({
      open: latestCandle.open,
      high: latestCandle.high,
      low: latestCandle.low,
      close: latestCandle.close,
      timestamp: latestCandle.time,
    });
  }, [enabled, candles]);

  // Real-time tick — lets armed state flip to IN_TRADE the moment the stop triggers
  useEffect(() => {
    if (!enabled || !engineRef.current || !currentPrice) return;
    engineRef.current.onTick(currentPrice);
  }, [enabled, currentPrice]);

  // Sync broker-derived P&L into the engine so the daily lock uses real dollars
  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.externalDailyPnL = externalDailyPnL;
  }, [externalDailyPnL]);

  return null;
}

export default memo(WaveEngine);
export { WaveReclaimEngine };
export type { WaveConfig, BarData, WaveCallbacks, EngineState, WaveSignal };
