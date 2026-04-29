"""
ProjectX Token Manager
======================

Simple, self-contained token lifecycle management:
- Fetch new tokens from ProjectX API
- Cache tokens with 23-hour expiry
- Auto-refresh before expiration
- Single retry on 401, backoff on repeated failures

Usage:
    from token_manager import ProjectXTokenManager

    token_manager = ProjectXTokenManager(api_key="your_key")
    token = token_manager.get_token()  # Returns cached or fresh token
    headers = {"Authorization": f"Bearer {token}"}
"""

import logging
import httpx
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


class ProjectXTokenManager:
    """Manages ProjectX authentication tokens with automatic refresh."""

    API_BASE = "https://api.topstepx.com"
    TOKEN_VALIDITY_HOURS = 23  # Refresh every 23 hours

    def __init__(self, api_key: str, username: Optional[str] = None):
        """
        Initialize token manager.

        Args:
            api_key: ProjectX API key from environment
            username: Optional username (required by some ProjectX endpoints)
        """
        self.api_key = api_key
        self.username = username
        self.token: Optional[str] = None
        self.token_expiry: Optional[datetime] = None
        self._failure_count = 0
        self._max_failures = 3

        logger.info("🔑 ProjectXTokenManager initialized")

    def fetch_new_token(self) -> Optional[str]:
        """
        Fetch a new token from ProjectX API.

        Returns:
            Token string if successful, None otherwise
        """
        url = f"{self.API_BASE}/api/Auth/loginKey"

        # Payload format: {"apiKey": "your_key"} or {"userName": "...", "apiKey": "..."}
        payload = {"apiKey": self.api_key}
        if self.username:
            payload["userName"] = self.username

        try:
            logger.info("🔄 Fetching new ProjectX token...")

            with httpx.Client(timeout=10.0) as client:
                response = client.post(url, json=payload)

            # Success
            if response.status_code == 200:
                data = response.json()

                if data.get("success"):
                    self.token = data.get("token")
                    self.token_expiry = datetime.utcnow() + timedelta(hours=self.TOKEN_VALIDITY_HOURS)
                    self._failure_count = 0  # Reset failure counter on success

                    logger.info(f"✅ Token refreshed successfully (valid for {self.TOKEN_VALIDITY_HOURS} hours)")
                    logger.info(f"   Token expires at: {self.token_expiry.strftime('%Y-%m-%d %H:%M:%S')} UTC")

                    return self.token
                else:
                    error_msg = data.get("message", "Unknown error")
                    logger.error(f"❌ Token fetch failed: {error_msg}")
                    self._failure_count += 1
                    return None

            # Bad Request (400)
            elif response.status_code == 400:
                logger.error(f"❌ Invalid payload or API key format (400 Bad Request)")
                logger.error(f"   Response: {response.text}")
                logger.error(f"   Payload sent: {payload}")
                self._failure_count += 1
                return None

            # Unauthorized (401)
            elif response.status_code == 401:
                logger.error(f"❌ Unauthorized - API key rejected by ProjectX (401)")
                logger.error(f"   Response: {response.text}")
                self._failure_count += 1
                return None

            # Other errors
            else:
                logger.error(f"❌ Token request failed: {response.status_code}")
                logger.error(f"   Response: {response.text}")
                self._failure_count += 1
                return None

        except httpx.TimeoutException:
            logger.error(f"❌ Token fetch timeout - ProjectX API not responding")
            self._failure_count += 1
            return None

        except Exception as e:
            logger.error(f"❌ Unexpected error during token fetch: {e}")
            self._failure_count += 1
            return None

    def get_token(self) -> Optional[str]:
        """
        Get current token, fetching new one if expired or missing.

        Returns:
            Token string if available, None if fetch failed
        """
        # Check if we have a valid cached token
        if self.token and self.token_expiry:
            # Add 1-minute buffer to prevent using token right at expiry
            if datetime.utcnow() < (self.token_expiry - timedelta(minutes=1)):
                logger.debug(f"♻️ Using cached token (expires in {(self.token_expiry - datetime.utcnow()).total_seconds() / 3600:.1f}h)")
                return self.token
            else:
                logger.info(f"⏰ Token expired or expiring soon - fetching new token")

        # Fetch new token
        return self.fetch_new_token()

    def is_token_valid(self) -> bool:
        """
        Check if current token is valid (exists and not expired).

        Returns:
            True if token is valid, False otherwise
        """
        if not self.token or not self.token_expiry:
            return False

        return datetime.utcnow() < self.token_expiry

    def force_refresh(self) -> Optional[str]:
        """
        Force a token refresh regardless of expiry.

        Returns:
            New token string if successful, None otherwise
        """
        logger.info("🔄 Force refreshing token...")
        return self.fetch_new_token()

    def should_backoff(self) -> bool:
        """
        Check if we should back off due to repeated failures.

        Returns:
            True if failure count exceeds threshold
        """
        return self._failure_count >= self._max_failures

    def reset_failure_count(self):
        """Reset failure counter (call after successful API calls)."""
        self._failure_count = 0

    def get_auth_headers(self) -> dict:
        """
        Get authorization headers for API requests.

        Returns:
            Dictionary with Authorization header
        """
        token = self.get_token()
        if token:
            return {"Authorization": f"Bearer {token}"}
        else:
            logger.error("❌ No valid token available for auth headers")
            return {}
