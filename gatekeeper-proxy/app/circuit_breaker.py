"""Circuit breaker for upstream backend connections.

Implements the classic 3-state machine:
  CLOSED    Normal operation — requests flow through.
  OPEN      Tripped — requests fail-fast without hitting upstream.
  HALF_OPEN Recovery probe — one request allowed to test recovery.

State transitions:
  CLOSED   → OPEN      when failure_count >= failure_threshold
  OPEN     → HALF_OPEN when recovery_timeout seconds have elapsed
  HALF_OPEN→ CLOSED    when the probe request succeeds
  HALF_OPEN→ OPEN      when the probe request fails (reset timer)
"""

from __future__ import annotations

import asyncio
import time
from enum import StrEnum

import structlog

logger = structlog.get_logger()


class CircuitState(StrEnum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerOpenError(Exception):
    """Raised when a call is attempted on an OPEN circuit."""


class CircuitBreaker:
    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ) -> None:
        self.name              = name
        self._threshold        = failure_threshold
        self._recovery_timeout = recovery_timeout

        self._state:        CircuitState = CircuitState.CLOSED
        self._failure_count: int         = 0
        self._opened_at:    float | None = None
        self._lock                       = asyncio.Lock()

    # ── Public ────────────────────────────────────────────────

    @property
    def state(self) -> CircuitState:
        return self._effective_state()

    async def call(self, coro):
        """Execute `coro` through the circuit breaker.

        Raises CircuitBreakerOpenError if the circuit is OPEN.
        Records success/failure and drives state transitions.
        """
        state = self._effective_state()

        if state == CircuitState.OPEN:
            logger.warning("circuit_breaker.rejected", name=self.name, state=state)
            raise CircuitBreakerOpenError(
                f"Circuit '{self.name}' is OPEN — upstream is unavailable"
            )

        try:
            result = await coro
            await self._on_success(state)
            return result
        except Exception as exc:
            await self._on_failure(exc)
            raise

    def status(self) -> dict:
        state = self._effective_state()
        return {
            "name":          self.name,
            "state":         state.value,
            "failures":      self._failure_count,
            "threshold":     self._threshold,
            "opened_at":     self._opened_at,
            "recovery_in_s": max(
                0,
                round(self._recovery_timeout - (time.monotonic() - (self._opened_at or 0)), 1),
            ) if state == CircuitState.OPEN else None,
        }

    # ── Internal ──────────────────────────────────────────────

    def _effective_state(self) -> CircuitState:
        """Return current state, auto-transitioning OPEN→HALF_OPEN on timeout."""
        if self._state == CircuitState.OPEN and self._opened_at is not None:
            elapsed = time.monotonic() - self._opened_at
            if elapsed >= self._recovery_timeout:
                self._state = CircuitState.HALF_OPEN
                logger.info(
                    "circuit_breaker.half_open",
                    name=self.name,
                    elapsed_s=round(elapsed, 1),
                )
        return self._state

    async def _on_success(self, prev_state: CircuitState) -> None:
        async with self._lock:
            if prev_state == CircuitState.HALF_OPEN:
                logger.info("circuit_breaker.closed", name=self.name, reason="probe_success")
                self._state         = CircuitState.CLOSED
                self._failure_count = 0
                self._opened_at     = None

    async def _on_failure(self, exc: Exception) -> None:
        async with self._lock:
            self._failure_count += 1
            should_trip = (
                self._failure_count >= self._threshold
                or self._state == CircuitState.HALF_OPEN
            )
            if should_trip and self._state != CircuitState.OPEN:
                self._state     = CircuitState.OPEN
                self._opened_at = time.monotonic()
                logger.error(
                    "circuit_breaker.opened",
                    name=self.name,
                    failures=self._failure_count,
                    error=str(exc),
                )


# ── Singleton instances ────────────────────────────────────────

backend_cb       = CircuitBreaker(name="backend",       failure_threshold=5, recovery_timeout=30.0)
control_plane_cb = CircuitBreaker(name="control_plane", failure_threshold=5, recovery_timeout=30.0)
