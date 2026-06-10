"""OpenTelemetry tracing — W3C trace-context propagation with OTLP export.

Sets up distributed tracing for the Gatekeeper proxy:
  - Traces each incoming request with span attributes (method, path, user, etc.)
  - Propagates W3C traceparent/tracestate headers to upstreams
  - Exports spans via OTLP/gRPC to a collector (Jaeger, Tempo, etc.)
  - Falls back to no-op if OTEL is not configured
"""

from __future__ import annotations

import os

import structlog

logger = structlog.get_logger()

# Track whether tracing has been initialized
_tracer = None
_initialized = False


def init_tracing(service_name: str = "gatekeeper-proxy") -> None:
    """Initialize OpenTelemetry tracing with OTLP export.

    Reads configuration from environment variables:
      - OTEL_EXPORTER_OTLP_ENDPOINT: gRPC endpoint (default: http://localhost:4317)
      - OTEL_SERVICE_NAME: Override service name
      - OTEL_TRACES_SAMPLER: Sampler type (default: parentbased_traceidratio)
      - OTEL_TRACES_SAMPLER_ARG: Sampling ratio (default: 1.0)
    """
    global _tracer, _initialized

    if _initialized:
        return

    otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "")

    try:
        from opentelemetry import trace
        from opentelemetry.baggage.propagation import W3CBaggagePropagator
        from opentelemetry.propagate import set_global_textmap
        from opentelemetry.propagators.composite import CompositeTextMapPropagator
        from opentelemetry.sdk.resources import SERVICE_NAME, Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.trace.propagation import TraceContextTextMapPropagator

        # Resource identifies this service in traces
        resource = Resource.create({
            SERVICE_NAME: os.environ.get("OTEL_SERVICE_NAME", service_name),
            "service.version": "0.1.0",
            "deployment.environment": os.environ.get("GK_ENVIRONMENT", "development"),
        })

        # Create tracer provider
        provider = TracerProvider(resource=resource)

        # Add OTLP exporter if endpoint is configured
        if otlp_endpoint:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

            exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
            provider.add_span_processor(BatchSpanProcessor(exporter))
            logger.info("tracing.otlp_configured", endpoint=otlp_endpoint)
        else:
            logger.info(
                "tracing.no_exporter",
                message="No OTLP endpoint configured, traces are in-process only",
            )

        trace.set_tracer_provider(provider)

        # Set up W3C trace-context propagation (traceparent + tracestate headers)
        set_global_textmap(
            CompositeTextMapPropagator([
                TraceContextTextMapPropagator(),
                W3CBaggagePropagator(),
            ])
        )

        _tracer = trace.get_tracer("gatekeeper-proxy", "0.1.0")
        _initialized = True
        logger.info("tracing.initialized", service=service_name)

    except ImportError:
        logger.warning(
            "tracing.otel_not_installed",
            message="OpenTelemetry packages not installed, tracing disabled",
        )
        _initialized = True  # Don't retry

    except Exception as exc:
        logger.error("tracing.init_failed", error=str(exc))
        _initialized = True


def get_tracer():
    """Return the global tracer instance (may be None if not initialized)."""
    return _tracer


def instrument_fastapi(app) -> None:
    """Instrument FastAPI app with OpenTelemetry auto-instrumentation."""
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(
            app,
            excluded_urls="proxy/health,health,metrics,.well-known/jwks.json",
        )
        logger.info("tracing.fastapi_instrumented")
    except ImportError:
        logger.debug(
            "tracing.fastapi_instrument_skip",
            message="FastAPI instrumentor not available",
        )
    except Exception as exc:
        logger.warning("tracing.fastapi_instrument_failed", error=str(exc))


def instrument_httpx() -> None:
    """Instrument httpx client for outgoing trace propagation."""
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
        logger.info("tracing.httpx_instrumented")
    except ImportError:
        logger.debug("tracing.httpx_instrument_skip", message="httpx instrumentor not available")
    except Exception as exc:
        logger.warning("tracing.httpx_instrument_failed", error=str(exc))


def get_current_trace_id() -> str:
    """Get the current trace ID as a hex string, or empty string if no active span."""
    try:
        from opentelemetry import trace

        span = trace.get_current_span()
        ctx = span.get_span_context()
        if ctx and ctx.trace_id:
            return format(ctx.trace_id, "032x")
    except Exception:
        pass
    return ""


def get_current_span_id() -> str:
    """Get the current span ID as a hex string, or empty string if no active span."""
    try:
        from opentelemetry import trace

        span = trace.get_current_span()
        ctx = span.get_span_context()
        if ctx and ctx.span_id:
            return format(ctx.span_id, "016x")
    except Exception:
        pass
    return ""
