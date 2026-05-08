# ──────────────────────────────────────────────────────────────
# Gatekeeper Backend — Multi-stage Dockerfile
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Builder ─────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

COPY pyproject.toml .
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir . && \
    rm -rf /root/.cache /tmp/*

# ── Stage 2: Runtime ─────────────────────────────────────────
FROM python:3.11-slim AS runtime

RUN groupadd -r gatekeeper && useradd -r -g gatekeeper -s /sbin/nologin gatekeeper

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY app/ app/
COPY start.sh .

USER gatekeeper

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD python -c "import urllib.request,ssl;c=ssl._create_unverified_context();urllib.request.urlopen('https://localhost:8001/health',context=c)" || \
    python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"

CMD ["./start.sh"]
