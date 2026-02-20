#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Generate mTLS certificates for Gatekeeper
# Usage: ./generate-certs.sh
# ──────────────────────────────────────────────────────────────
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")" && pwd)/certs"
mkdir -p "$CERT_DIR"

echo "🔐 Generating Gatekeeper mTLS Certificates"
echo "   Output: $CERT_DIR"
echo ""

# ─── Certificate Authority ───────────────────────────────────
echo "1. Generating CA key and certificate..."
openssl genrsa -out "$CERT_DIR/ca.key" 4096
openssl req -new -x509 -days 3650 -key "$CERT_DIR/ca.key" \
    -subj "/C=US/ST=Dev/O=Gatekeeper/CN=Gatekeeper CA" \
    -out "$CERT_DIR/ca.crt"

# ─── Server Certificate (Backend) ────────────────────────────
echo "2. Generating backend server certificate..."
openssl genrsa -out "$CERT_DIR/server.key" 2048
openssl req -new -key "$CERT_DIR/server.key" \
    -subj "/C=US/ST=Dev/O=Gatekeeper/CN=backend" \
    -out "$CERT_DIR/server.csr"

cat > "$CERT_DIR/server_ext.cnf" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = backend
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF

openssl x509 -req -days 365 -in "$CERT_DIR/server.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -extfile "$CERT_DIR/server_ext.cnf" \
    -out "$CERT_DIR/server.crt"

# ─── Client Certificate (Proxy) ──────────────────────────────
echo "3. Generating proxy client certificate..."
openssl genrsa -out "$CERT_DIR/client.key" 2048
openssl req -new -key "$CERT_DIR/client.key" \
    -subj "/C=US/ST=Dev/O=Gatekeeper/CN=proxy" \
    -out "$CERT_DIR/client.csr"

cat > "$CERT_DIR/client_ext.cnf" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -days 365 -in "$CERT_DIR/client.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -extfile "$CERT_DIR/client_ext.cnf" \
    -out "$CERT_DIR/client.crt"

# ─── Cleanup ─────────────────────────────────────────────────
rm -f "$CERT_DIR"/*.csr "$CERT_DIR"/*.cnf

echo ""
echo "✅ Certificates generated successfully!"
echo "   CA:      $CERT_DIR/ca.crt"
echo "   Server:  $CERT_DIR/server.crt / server.key"
echo "   Client:  $CERT_DIR/client.crt / client.key"
