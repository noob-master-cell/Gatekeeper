#!/usr/bin/env bash

set -e

# Run database migrations before starting the server
echo "Running database migrations..."
PYTHONPATH=/app alembic upgrade head
echo "Migrations complete."

if [ "$GK_CP_MTLS_ENABLED" = "true" ]; then
    echo "Starting Uvicorn with mTLS enabled..."
    exec uvicorn app.main:app --host :: --port 8002 --workers 2 \
        --ssl-certfile=/certs/server.crt \
        --ssl-keyfile=/certs/server.key \
        --ssl-ca-certs=/certs/ca.crt \
        --ssl-cert-reqs=1
else
    echo "Starting Uvicorn (HTTP only)..."
    exec uvicorn app.main:app --host :: --port 8002 --workers 2
fi
