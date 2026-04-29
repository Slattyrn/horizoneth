"""
Historical Data Export Module for Sierra Chart

This module provides an endpoint to export ES and NQ futures historical data
in Sierra Chart compatible CSV format.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException
from fastapi.responses import PlainTextResponse

logger = logging.getLogger("historical_export")

# Contract mapping for ES and NQ
EXPORT_CONTRACTS = {
    "ES": "CON.F.US.ES.H26",   # E-mini S&P 500 (March 2026 - update as needed)
    "NQ": "CON.F.US.NQ.H26",   # E-mini Nasdaq-100 (March 2026 - update as needed)
    "MES": "CON.F.US.MES.H26", # Micro E-mini S&P 500
    "MNQ": "CON.F.US.MNQ.H26", # Micro E-mini Nasdaq-100
}


async def export_historical_data(
    symbol: str,
    days: int,
    interval: int,
    http_client,
    get_auth_token
):
    """
    Export historical bar data for ES or NQ futures in Sierra Chart compatible CSV format.

    Args:
        symbol: 'ES' or 'NQ' (will map to full contract ID)
        days: Number of days to fetch (default 365, max ~730 depending on API limits)
        interval: Bar interval in minutes (default: 5)
        http_client: The httpx async client
        get_auth_token: Function to get auth token

    Returns:
        PlainTextResponse with CSV data
    """
    # Validate symbol
    symbol_upper = symbol.upper()
    if symbol_upper not in EXPORT_CONTRACTS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid symbol: {symbol}. Supported: ES, NQ, MES, MNQ"
        )

    contract_id = EXPORT_CONTRACTS[symbol_upper]
    logger.info(f"📊 Starting historical export for {symbol_upper} ({contract_id})")

    try:
        token = await get_auth_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Calculate time range - go back as far as requested
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(days=days)

        logger.info(f"📊 Time range: {start_time.date()} to {end_time.date()} ({days} days)")

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

        # Fetch historical bars in chunks (API may have limits)
        all_bars = []
        chunk_days = 30  # Fetch 30 days at a time to avoid API limits
        current_start = start_time

        while current_start < end_time:
            chunk_end = min(current_start + timedelta(days=chunk_days), end_time)

            payload = {
                "contractId": contract_id,
                "startTime": current_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "endTime": chunk_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "unit": 2,  # Minute
                "unitNumber": interval,
                "limit": 10000,  # Max per request
                "live": False,
                "includePartialBar": False
            }

            if account_id is not None:
                payload["accountId"] = account_id

            logger.info(f"📊 Fetching chunk: {current_start.date()} to {chunk_end.date()}")

            try:
                resp = await http_client.post(
                    "/api/History/retrieveBars",
                    json=payload,
                    headers=headers,
                    timeout=60.0  # Longer timeout for large requests
                )

                if resp.status_code == 200:
                    data = resp.json()
                    bars = data.get("bars", data) if isinstance(data, dict) else data

                    if isinstance(bars, list) and len(bars) > 0:
                        all_bars.extend(bars)
                        logger.info(f"✅ Got {len(bars)} bars from this chunk (total: {len(all_bars)})")
                    else:
                        logger.warning(f"⚠️ No bars in chunk {current_start.date()} to {chunk_end.date()}")
                elif resp.status_code == 429:
                    # Rate limited - wait and retry
                    logger.warning("⚠️ Rate limited, waiting 5s...")
                    await asyncio.sleep(5)
                    continue
                else:
                    logger.error(f"❌ API error {resp.status_code}: {resp.text}")
            except Exception as chunk_error:
                logger.error(f"❌ Chunk fetch error: {chunk_error}")

            # Move to next chunk
            current_start = chunk_end

            # Small delay between chunks to avoid rate limiting
            await asyncio.sleep(0.5)

        if len(all_bars) == 0:
            raise HTTPException(status_code=404, detail=f"No historical data available for {symbol_upper}")

        logger.info(f"✅ Total bars fetched: {len(all_bars)}")

        # Sort by timestamp (oldest first)
        all_bars.sort(key=lambda b: b.get("timestamp") or b.get("t") or "")

        # Remove duplicates based on timestamp
        seen_timestamps = set()
        unique_bars = []
        for bar in all_bars:
            ts = bar.get("timestamp") or bar.get("t")
            if ts not in seen_timestamps:
                seen_timestamps.add(ts)
                unique_bars.append(bar)

        logger.info(f"✅ Unique bars after dedup: {len(unique_bars)}")

        # Format as Sierra Chart compatible CSV
        # Sierra Chart format: Date, Time, Open, High, Low, Close, Volume, NumberOfTrades, BidVolume, AskVolume
        # Simplified version: DateTime, Open, High, Low, Close, Volume
        csv_lines = ["DateTime, Open, High, Low, Close, Volume"]

        for bar in unique_bars:
            # Parse timestamp
            timestamp = bar.get("timestamp") or bar.get("t")
            if isinstance(timestamp, str):
                # ISO format timestamp
                try:
                    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                except:
                    continue
            elif isinstance(timestamp, (int, float)):
                # Unix timestamp (seconds or milliseconds)
                if timestamp > 10000000000:
                    timestamp = timestamp / 1000
                dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
            else:
                continue

            # Format datetime for Sierra Chart: YYYY-MM-DD HH:MM:SS
            dt_str = dt.strftime("%Y-%m-%d %H:%M:%S")

            # Get OHLCV
            open_p = bar.get("open") or bar.get("o") or 0
            high_p = bar.get("high") or bar.get("h") or 0
            low_p = bar.get("low") or bar.get("l") or 0
            close_p = bar.get("close") or bar.get("c") or 0
            volume = bar.get("volume") or bar.get("v") or 0

            csv_lines.append(f"{dt_str}, {open_p:.2f}, {high_p:.2f}, {low_p:.2f}, {close_p:.2f}, {int(volume)}")

        csv_content = "\n".join(csv_lines)

        logger.info(f"✅ Export complete: {len(csv_lines) - 1} bars for {symbol_upper}")

        return PlainTextResponse(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={symbol_upper}_{interval}min_{days}days.csv"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Historical export failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")
