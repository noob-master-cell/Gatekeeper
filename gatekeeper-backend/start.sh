#!/usr/bin/env bash

set -e

if [ "$GK_MTLS_ENABLED" = "true" ]; then
    echo "Starting Uvicorn with mTLS enabled..."
    exec uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 2 \
        --ssl-certfile=/certs/server.crt \
        --ssl-keyfile=/certs/server.key \
        --ssl-ca-certs=/certs/ca.crt \
        --ssl-cert-reqs=1
else
    echo "Starting Uvicorn (HTTP only)..."
    exec uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 2
fi
