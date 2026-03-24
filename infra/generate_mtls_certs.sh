#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"

echo "Creating mTLS certificates in $CERTS_DIR..."
mkdir -p "$CERTS_DIR"
cd "$CERTS_DIR"

# 1. Generate Root CA
echo "Generating Root CA..."
openssl req -x509 -sha256 -nodes -days 3650 -newkey rsa:4096 \
  -keyout ca.key -out ca.crt -subj "/CN=Gatekeeper-Root-CA"

# 2. Generate Server Certificate (for backend and control-plane)
echo "Generating Server Certificate..."
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=gatekeeper-backend"

# Create a config for Subject Alternative Names (SAN) so both services can use it
cat > server_ext.cnf << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = backend
DNS.2 = control-plane
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 3650 -sha256 -extfile server_ext.cnf

# 3. Generate Client Certificate (for proxy)
echo "Generating Client Certificate..."
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=gatekeeper-proxy"

openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out client.crt -days 3650 -sha256

# Cleanup CSRs and configs
rm -f server.csr client.csr server_ext.cnf ca.srl

# Set permissions
chmod 644 *.crt
chmod 600 *.key

echo "Done! Certificates generated:"
ls -l
