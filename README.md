# NicnatDirect Shopify Shipping — Minimal Test Build

Single-file Express app that always returns two static rates at Shopify checkout, regardless of address or cart contents. Use it to confirm the Shopify CarrierService flow is wired up correctly before connecting any real backend.

```
[
  { "id": 1, "label": "Nicnat Economy",  "key": "economy",  "cost": 79 },
  { "id": 2, "label": "Nicnat Priority", "key": "priority", "cost": 89 }
]
```

Each checkout adds a tiny random cents offset (0–99¢) to each cost — e.g. $79.43, $89.71. The randomness is intentional: if the value changes between checkouts you know the rate is coming live from this app, not from a cached Shopify zone rate.

## Files
```
package.json
src/server.js   ← all logic, single file
```

No env vars are required for it to run. Optional:
- `PORT` — defaults to 3000
- `HOST` — public URL Shopify will call (e.g. `https://shopify-nicnat-app-production.up.railway.app`)
- `SHOPIFY_API_VERSION` — defaults to `2026-04`

## Endpoints
- `GET /` — health
- `GET /diagnose` — shows the rates this app will return for a sample cart
- `POST /carrier-service` — the Shopify callback (always returns rates)
- `POST /admin/register-carrier` — register the carrier service in a shop

## Deploy (Railway)
1. Push to GitHub.
2. Railway auto-deploys.
3. Set `HOST=https://shopify-nicnat-app-production.up.railway.app` in Variables.
4. Verify in browser: visit `/diagnose` — should show two rates with random cents.

## Register the carrier service in your shop
Run once per shop, using an admin API access token from a custom app in that shop:
```bash
curl -X POST https://shopify-nicnat-app-production.up.railway.app/admin/register-carrier \
  -H 'Content-Type: application/json' \
  -d '{"shop":"your-store.myshopify.com","accessToken":"shpat_xxxxx"}'
```
After this, go to checkout — the two Nicnat rates will appear for ANY address. Refresh checkout a few times; the cents will change each time.

## What was removed
- All Laravel/backend API call logic
- All auth / HMAC / domain checks
- All config files, multi-file structure, env-driven behaviour

This is intentionally a black box: cart in, two static rates out.
