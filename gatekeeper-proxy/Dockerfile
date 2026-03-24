FROM python:3.11-slim AS base

# Non-root user
RUN groupadd -r gatekeeper && useradd -r -g gatekeeper gatekeeper

WORKDIR /app

# Install dependencies first (cache layer)
COPY pyproject.toml .
RUN pip install --no-cache-dir . && rm -rf /root/.cache

# Copy application code
COPY app/ app/

# Keys directory
RUN mkdir -p /tmp/gatekeeper_keys && chown gatekeeper:gatekeeper /tmp/gatekeeper_keys

USER gatekeeper

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/proxy/health')"

CMD sh -c "python -c 'from app.auth.keys import initialize_keys; initialize_keys()' && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4"
