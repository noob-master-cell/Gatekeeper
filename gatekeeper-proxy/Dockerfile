# ──────────────────────────────────────────────────────────────
# Gatekeeper Proxy — Multi-stage Dockerfile
# Final image: python:3.11-slim (~85MB) with only runtime deps
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Builder ─────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps into a virtual environment for clean copy
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml .
RUN pip install --no-cache-dir . && \
    pip install --no-cache-dir \
        prometheus-client>=0.21.0 \
        opentelemetry-api>=1.25.0 \
        opentelemetry-sdk>=1.25.0 \
        opentelemetry-exporter-otlp-proto-grpc>=1.25.0 \
        opentelemetry-instrumentation-fastapi>=0.46b0 \
        opentelemetry-instrumentation-httpx>=0.46b0 \
        opa-python-client>=1.3.0 && \
    rm -rf /root/.cache /tmp/*

# ── Stage 2: Runtime ─────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Security: non-root user
RUN groupadd -r gatekeeper && useradd -r -g gatekeeper -s /sbin/nologin gatekeeper

WORKDIR /app

# Copy only the virtual environment from builder (no gcc, no headers)
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Copy application code
COPY app/ app/

# Keys directory
RUN mkdir -p /tmp/gatekeeper_keys && chown gatekeeper:gatekeeper /tmp/gatekeeper_keys

USER gatekeeper

EXPOSE ${PORT:-8000}

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\",\"8000\")}/proxy/health')"

CMD sh -c "python -c 'from app.auth.keys import initialize_keys; initialize_keys()' && uvicorn app.main:app --host :: --port ${PORT:-8000} --workers 4"
