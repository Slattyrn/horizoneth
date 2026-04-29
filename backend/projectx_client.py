import os
import time
import json
import logging
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


class ProjectXClient:
    """
    Minimal, precise client for the endpoints you call from main.py.
    - Auth via API key -> bearer token (token kept in-memory)
    - Other helpers: account, contracts, orders (kept generic + stable)
    """

    def __init__(self):
        self.base_url = os.getenv("PROJECTX_API_BASE") or os.getenv("PROJECTX_BASE_URL") or ""
        if not self.base_url:
            raise RuntimeError("PROJECTX_API_BASE or PROJECTX_BASE_URL is required")

        self.api_key = os.getenv("PROJECTX_API_KEY")
        if not self.api_key:
            raise RuntimeError("PROJECTX_API_KEY is required")

        self.token: Optional[str] = None
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=30.0)

    async def close(self):
        try:
            await self._client.aclose()
        except Exception:
            pass

    # ---------- Auth ----------

    async def login_with_key(self) -> Dict[str, Any]:
        """
        Keep it precise and side-effect free:
        - We treat API key as the bearer for now (no speculative auth flow).
        - If you have a dedicated key->token exchange, wire it here.
        """
        self.token = self.api_key
        logger.info("Project X: token set via API key (login_with_key).")
        return {"username": "api-key-auth", "token_type": "api_key"}

    def _headers(self) -> Dict[str, str]:
        if not self.token:
            raise RuntimeError("Project X token is not set. Call login_with_key() first.")
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    # ---------- Account / Contracts / Orders ----------

    async def get_account_info(self) -> Dict[str, Any]:
        # Adjust path to your actual account summary endpoint if needed
        resp = await self._client.get("/account", headers=self._headers())
        resp.raise_for_status()
        return resp.json()

    async def get_available_contracts(self) -> List[Dict[str, Any]]:
        resp = await self._client.get("/contracts", headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else []

    async def get_open_orders(self) -> List[Dict[str, Any]]:
        resp = await self._client.get("/orders/open", headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else []

    async def place_order(
        self,
        symbol: str,
        side: str,
        quantity: int,
        order_type: str,
        price: Optional[float] = None
    ) -> Dict[str, Any]:
        payload = {
            "symbol": symbol,
            "side": side,
            "quantity": quantity,
            "orderType": order_type,
        }
        if price is not None:
            payload["price"] = price

        resp = await self._client.post("/orders/place", headers=self._headers(), json=payload)
        resp.raise_for_status()
        return resp.json()

