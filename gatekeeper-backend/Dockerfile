FROM python:3.11-slim AS base

# Non-root user
RUN groupadd -r gatekeeper && useradd -r -g gatekeeper gatekeeper

WORKDIR /app

# Install dependencies first (cache layer)
COPY pyproject.toml .
RUN pip install --no-cache-dir . && rm -rf /root/.cache

# Copy application code
COPY app/ app/
COPY start.sh .

USER gatekeeper

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD python -c "import urllib.request,ssl;c=ssl._create_unverified_context();\nurllib.request.urlopen('https://localhost:8001/health',context=c)" || \
    python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"

CMD ["./start.sh"]
