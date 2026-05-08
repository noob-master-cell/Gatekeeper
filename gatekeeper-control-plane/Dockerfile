# ──────────────────────────────────────────────────────────────
# Gatekeeper Control Plane — Multi-stage Dockerfile
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Builder ─────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir . && \
    rm -rf /root/.cache /tmp/*

# ── Stage 2: Runtime ─────────────────────────────────────────
FROM python:3.11-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -r gatekeeper && useradd -r -g gatekeeper -s /sbin/nologin gatekeeper

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY app/ app/
COPY alembic/ alembic/
COPY alembic.ini .
COPY start.sh .

USER gatekeeper

EXPOSE 8002

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD python -c "import urllib.request,ssl;c=ssl._create_unverified_context();urllib.request.urlopen('https://localhost:8002/health',context=c)" || \
    python -c "import urllib.request; urllib.request.urlopen('http://localhost:8002/health')"

CMD ["./start.sh"]
