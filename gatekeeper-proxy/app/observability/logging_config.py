"""Structured logging configuration — JSON output for production, console for dev.

Every log line includes:
  - timestamp (ISO 8601)
  - level
  - event
  - correlation_id (request-scoped)
  - trace_id (OpenTelemetry, if available)
  - span_id (OpenTelemetry, if available)
  - service: gatekeeper-proxy
"""

from __future__ import annotations

import os

import structlog


def _add_trace_context(logger, method_name, event_dict):
    """Inject OpenTelemetry trace context into every log line."""
    try:
        from app.observability.tracing import get_current_span_id, get_current_trace_id

        trace_id = get_current_trace_id()
        span_id = get_current_span_id()
        if trace_id:
            event_dict["trace_id"] = trace_id
        if span_id:
            event_dict["span_id"] = span_id
    except Exception:
        pass
    return event_dict


def _add_service_context(logger, method_name, event_dict):
    """Add service metadata to every log line."""
    event_dict["service"] = "gatekeeper-proxy"
    event_dict["version"] = "0.1.0"
    return event_dict


def configure_logging() -> None:
    """Configure structlog with environment-appropriate rendering.

    - Production (GK_LOG_FORMAT=json): JSON lines output
    - Development (default): Colored console output
    """
    log_format = os.environ.get("GK_LOG_FORMAT", "console").lower()

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        _add_service_context,
        _add_trace_context,
    ]

    if log_format == "json":
        # Production: JSON lines — parseable by Loki, Datadog, ELK, etc.
        renderer = structlog.processors.JSONRenderer()
    else:
        # Development: human-readable colored output
        renderer = structlog.dev.ConsoleRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(0),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
