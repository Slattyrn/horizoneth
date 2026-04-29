"""
Historical Candle Database
Stores candle data in a JSON file and updates every 5 minutes
"""
import asyncio
import json
import os
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional
from pathlib import Path

logger = logging.getLogger("candle_db")

CANDLES_DIR = Path("data/candles")
CANDLES_DIR.mkdir(parents=True, exist_ok=True)

TIMEFRAME_FILES = {
    '1m': 'mes_1m.json',
    '2m': 'mes_2m.json',
    '3m': 'mes_3m.json',
    '5m': 'mes_5m.json',
    '15m': 'mes_15m.json',
    '30m': 'mes_30m.json',
    '60m': 'mes_60m.json',
    '240m': 'mes_240m.json',
    'D': 'mes_daily.json',
}

UPDATE_INTERVAL = 300  # 5 minutes in seconds

class CandleDatabase:
    def __init__(self):
        self.candles: Dict[str, List[Dict]] = {}
        self.last_update: Dict[str, datetime] = {}
        self.load_all()
    
    def get_file_path(self, timeframe: str) -> Path:
        return CANDLES_DIR / TIMEFRAME_FILES.get(timeframe, f"mes_{timeframe}.json")
    
    def load_all(self):
        """Load all cached candle data from files"""
        for tf, filename in TIMEFRAME_FILES.items():
            filepath = self.get_file_path(tf)
            if filepath.exists():
                try:
                    with open(filepath, 'r') as f:
                        data = json.load(f)
                        self.candles[tf] = data.get('candles', [])
                        self.last_update[tf] = datetime.fromisoformat(data.get('last_update', '2024-01-01T00:00:00'))
                    logger.info(f"📦 Loaded {len(self.candles[tf])} candles for {tf}")
                except Exception as e:
                    logger.error(f"Error loading {tf}: {e}")
                    self.candles[tf] = []
            else:
                self.candles[tf] = []
    
    def save(self, timeframe: str):
        """Save candle data to file"""
        filepath = self.get_file_path(timeframe)
        data = {
            'last_update': datetime.now(timezone.utc).isoformat(),
            'symbol': 'MES',
            'timeframe': timeframe,
            'candles': self.candles.get(timeframe, [])[-2000:]  # Keep last 2000 candles
        }
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        logger.info(f"💾 Saved {len(data['candles'])} candles to {filepath.name}")
    
    def add_candle(self, candle: Dict, timeframe: str):
        """Add or update a candle"""
        if timeframe not in self.candles:
            self.candles[timeframe] = []
        
        candles = self.candles[timeframe]
        
        # Find existing candle by time
        existing_idx = None
        for i, c in enumerate(candles):
            if c.get('t') == candle.get('t'):
                existing_idx = i
                break
        
        if existing_idx is not None:
            # Update existing candle (it's forming)
            candles[existing_idx] = candle
        else:
            # Add new candle
            candles.append(candle)
            # Keep only last 2000 candles
            if len(candles) > 2000:
                candles = candles[-2000:]
        
        self.candles[timeframe] = candles
    
    def merge_historical(self, timeframe: str, historical: List[Dict]):
        """Merge historical data from API"""
        if timeframe not in self.candles:
            self.candles[timeframe] = []
        
        existing_times = set(c.get('t') for c in self.candles[timeframe])
        
        for candle in historical:
            if candle.get('t') not in existing_times:
                self.candles[timeframe].append(candle)
        
        # Sort by timestamp and keep last 2000
        self.candles[timeframe] = sorted(self.candles[timeframe], key=lambda x: x.get('t', ''))[-2000:]
        
        self.save(timeframe)
    
    def get_candles(self, timeframe: str, limit: int = 1000) -> List[Dict]:
        """Get candles for a timeframe"""
        candles = self.candles.get(timeframe, [])
        return sorted(candles, key=lambda x: x.get('t', ''))[-limit:]

# Global instance
db = CandleDatabase()

async def update_loop(http_client, symbol: str = "CON.F.US.MES.Z25"):
    """Background task to update candle database every 5 minutes"""
    logger.info("🔄 Starting candle database update loop...")
    
    while True:
        try:
            now = datetime.now(timezone.utc)
            
            for tf, filename in TIMEFRAME_FILES.items():
                tf_minutes = int(tf.replace('m', '').replace('D', '1440').replace('H', '60'))
                
                # Calculate time range
                end_time = now
                start_time = end_time - timedelta(days=7)
                
                payload = {
                    "contractId": symbol,
                    "startTime": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "endTime": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "unit": 2,  # Minute
                    "unitNumber": tf_minutes,
                    "limit": 1000,
                    "live": False,
                    "includePartialBar": False
                }
                
                try:
                    token = None
                    from main import get_auth_token
                    token = await get_auth_token()
                    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                    
                    resp = await http_client.post("/api/History/retrieveBars", json=payload, headers=headers)
                    
                    if resp.status_code == 200:
                        data = resp.json()
                        bars = data.get("bars", data) if isinstance(data, dict) else data
                        
                        if isinstance(bars, list):
                            transformed = []
                            for bar in bars:
                                transformed.append({
                                    't': bar.get('t') or bar.get('timestamp'),
                                    'o': bar.get('o'),
                                    'h': bar.get('h'),
                                    'l': bar.get('l'),
                                    'c': bar.get('c'),
                                    'v': bar.get('v', 0),
                                })
                            
                            db.merge_historical(tf, transformed)
                            logger.info(f"✅ Updated {tf}: {len(transformed)} candles")
                    
                except Exception as e:
                    logger.error(f"Error updating {tf}: {e}")
            
        except Exception as e:
            logger.error(f"Update loop error: {e}")
        
        await asyncio.sleep(UPDATE_INTERVAL)

def start_update_task(http_client, symbol: str = "CON.F.US.MES.Z25"):
    """Start the background update task"""
    asyncio.create_task(update_loop(http_client, symbol))
