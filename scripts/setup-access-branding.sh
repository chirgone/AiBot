#!/bin/bash
# AngaFlow - Custom Access Login Portal Setup
# Requires: CF_API_TOKEN with permissions:
#   - Zone:DNS:Edit (for angaflow.mx)
#   - Account:Cloudflare Zero Trust:Edit
#   - Account:Access: Organizations, Identity Providers, and Groups:Edit

set -euo pipefail

: "${CF_API_TOKEN:?Missing CF_API_TOKEN env var}"

ACCOUNT_ID="e3421356cff91cefbf0e954753f49f17"
ZONE_ID_ANGAFLOW_MX="78cc695ec3932c370033ac24d583f1e9"
TEAM_DOMAIN="anguiano301184"
LOGO_URL="https://pub-67515dd021ed4d5ea77627afc77bbae6.r2.dev/branding/angaflow-logo-dark.png"

API="https://api.cloudflare.com/client/v4"
HDR_AUTH="Authorization: Bearer ${CF_API_TOKEN}"
HDR_JSON="Content-Type: application/json"

echo "==> 1. Creating CNAME access.angaflow.mx -> ${TEAM_DOMAIN}.cloudflareaccess.com"
curl -sf -X POST "${API}/zones/${ZONE_ID_ANGAFLOW_MX}/dns_records" \
  -H "${HDR_AUTH}" -H "${HDR_JSON}" \
  -d "{
    \"type\": \"CNAME\",
    \"name\": \"access\",
    \"content\": \"${TEAM_DOMAIN}.cloudflareaccess.com\",
    \"proxied\": true,
    \"ttl\": 1,
    \"comment\": \"AngaFlow custom Access authentication domain\"
  }" | python3 -m json.tool | head -20

echo ""
echo "==> 2. Getting current Access organization config"
ORG_CURRENT=$(curl -sf "${API}/accounts/${ACCOUNT_ID}/access/organizations" \
  -H "${HDR_AUTH}")
echo "${ORG_CURRENT}" | python3 -m json.tool | head -30

echo ""
echo "==> 3. Updating Access organization with custom branding + custom domain"
curl -sf -X PUT "${API}/accounts/${ACCOUNT_ID}/access/organizations" \
  -H "${HDR_AUTH}" -H "${HDR_JSON}" \
  -d "{
    \"name\": \"AngaFlow\",
    \"auth_domain\": \"${TEAM_DOMAIN}.cloudflareaccess.com\",
    \"login_design\": {
      \"background_color\": \"#0a0a0a\",
      \"text_color\": \"#ffffff\",
      \"header_text\": \"Bienvenido a AngaFlow\",
      \"footer_text\": \"Plataforma Multi-Agente de IA Conversacional\",
      \"logo_path\": \"${LOGO_URL}\"
    },
    \"custom_pages\": {}
  }" | python3 -m json.tool | head -40

echo ""
echo "==> 4. Adding custom domain access.angaflow.mx to Access"
# Nota: en el dashboard esto se hace en Settings -> Custom Pages -> Custom domain
# Via API: PATCH la organization o crear un custom_domain resource
curl -sf -X PUT "${API}/accounts/${ACCOUNT_ID}/access/custom_pages" \
  -H "${HDR_AUTH}" -H "${HDR_JSON}" \
  -d '{}' 2>&1 | head -5 || echo "(custom domain must be added via Dashboard: Zero Trust -> Settings -> Custom Pages)"

echo ""
echo "==> Done. Verify at:"
echo "    https://${TEAM_DOMAIN}.cloudflareaccess.com  (should show AngaFlow branding)"
echo "    https://access.angaflow.mx                   (once CNAME propagates)"
