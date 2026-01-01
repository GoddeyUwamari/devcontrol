#!/bin/bash

##############################################################################
# SSL Certificate Generator for Development
# Generates self-signed SSL certificates for local HTTPS testing
#
# IMPORTANT: These certificates are for DEVELOPMENT ONLY!
# For production, use Let's Encrypt or a trusted Certificate Authority
##############################################################################

set -e

echo "════════════════════════════════════════════════════════"
echo "  SSL Certificate Generator (Development)"
echo "════════════════════════════════════════════════════════"
echo ""

# Create certs directory if it doesn't exist
CERTS_DIR="$(dirname "$0")/../certs"
mkdir -p "$CERTS_DIR"

echo "📁 Certificates directory: $CERTS_DIR"
echo ""

# Check if certificates already exist
if [ -f "$CERTS_DIR/key.pem" ] && [ -f "$CERTS_DIR/cert.pem" ]; then
  echo "⚠️  Certificates already exist!"
  echo ""
  read -p "Do you want to regenerate them? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Keeping existing certificates."
    exit 0
  fi
  echo ""
fi

echo "🔐 Generating self-signed SSL certificate..."
echo ""

# Generate private key and certificate
openssl req -x509 \
  -newkey rsa:4096 \
  -keyout "$CERTS_DIR/key.pem" \
  -out "$CERTS_DIR/cert.pem" \
  -days 365 \
  -nodes \
  -subj "/C=US/ST=Development/L=Localhost/O=DevControl/OU=Development/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1"

echo ""
echo "✅ SSL certificates generated successfully!"
echo ""
echo "📄 Files created:"
echo "   - $CERTS_DIR/key.pem  (Private key)"
echo "   - $CERTS_DIR/cert.pem (Certificate)"
echo ""
echo "⚠️  IMPORTANT SECURITY NOTES:"
echo "   - These certificates are SELF-SIGNED and for DEVELOPMENT ONLY"
echo "   - Browsers will show security warnings (this is normal)"
echo "   - DO NOT use these certificates in production"
echo "   - For production, use Let's Encrypt: https://letsencrypt.org"
echo ""
echo "🚀 Next steps:"
echo "   1. Start your backend server (it will auto-detect the certificates)"
echo "   2. Access your API at: https://localhost:8080"
echo "   3. Accept the browser security warning (development only)"
echo ""
echo "════════════════════════════════════════════════════════"
