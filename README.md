# NicnatDirect — Shopify Shipping App

A Shopify shipping app that shows **real-time NicnatDirect rates at checkout**, reusing
the exact rate logic from your WooCommerce plugin and your Laravel `ShippingRateService`.

Shopify's equivalent of WooCommerce's `WC_Shipping_Method::calculate_shipping()` is a
**CarrierService callback**: Shopify POSTs the cart to your app, and you respond with rate
objects. This app does that translation.

```
Shopify checkout
   │  POST /carrier-service  (cart: origin, destination, items[grams])
   ▼
This app (rateService.js)
   │  builds the same payload your WC plugin sent to get-shipping-rates
   │  (methods=economy/priority/overnight, items in lbs+inches)
   ▼
Laravel rate API  (NICNAT_API_BASE + get-shipping-rates)
   │  returns rates  ─►  [{id,label,cost}]  OR  {speeds:{...}}
   ▼
This app maps them back to Shopify rate objects (price in cents)
   ▼
Shopify shows "Nicnat Economy / Priority / Overnight" at checkout
```

## What maps to what (vs the WooCommerce plugin)

| WooCommerce plugin | This app |
|---|---|
| `calculate_shipping($package)` | `POST /carrier-service` → `getRatesForShopify()` |
| `nicnat_convert_weight()` (→ lbs) | `gramsToLbs()` / `toLbs()` in `lib/units.js` |
| `nicnat_convert_dimension()` (→ in) | `toInches()` in `lib/units.js` |
| `$methods` (economy/priority/overnight) | `buildMethods()` (overnight = domestic-only, same rule) |
| `Nicnat_API::get_shipping_rates()` | `lib/nicnatClient.js` |
| `nicnat_api_headers()` | `NicnatClient.headers()` |
| `$this->add_rate([... cost ...])` | `toShopifyRate()` (cost → cents string) |

## Auth & domain — currently OFF (by request)

In `.env`:

```
AUTH_DISABLED=true            # skips Shopify HMAC check on the callback
DOMAIN_CHECK_DISABLED=true    # skips shop-domain whitelist
```

This lets rates show immediately without finishing OAuth. The HMAC + domain
logic is already written in `src/middleware/auth.js` — just set both to `false`
in production to enforce them. Nothing else changes.

## Setup

```bash
cp .env.example .env       # set HOST, NICNAT_API_BASE, Shopify keys
npm install
npm start                  # or: npm run dev
```

`NICNAT_API_BASE` defaults to the same value your plugin's `config.php` used
(`https://nicnat.ondigit.us/api/v1/`), hitting the `get-shipping-rates` endpoint.

## Test rates without Shopify

Hit the debug endpoint with a Shopify-shaped body — it returns the backend
payload, the raw response, and the mapped Shopify rates:

```bash
curl -s -X POST http://localhost:3000/carrier-service/debug \
  -H 'Content-Type: application/json' \
  -d '{
    "rate": {
      "origin": { "country": "US", "postal_code": "10001", "province": "NY" },
      "destination": { "country": "US", "postal_code": "90210", "province": "CA" },
      "currency": "USD",
      "items": [
        { "name": "Tee", "quantity": 2, "grams": 300, "product_id": 11, "variant_id": 22,
          "properties": { "length": 10, "width": 8, "height": 4, "package_type_id": 1 } }
      ]
    }
  }'
```

## Register the carrier service in a shop

So Shopify actually calls `/carrier-service`, register it once per shop. Until
OAuth is finished, pass an offline admin token directly:

```bash
curl -s -X POST http://localhost:3000/admin/register-carrier \
  -H 'Content-Type: application/json' \
  -d '{ "shop": "your-store.myshopify.com", "accessToken": "shpat_xxx" }'
```

It creates the carrier service pointing at `HOST/carrier-service`, or updates the
callback URL if it already exists. (Carrier-service rates require the store to be
on a plan that supports third-party rates, or to use a dev/test store.)

## Backend response shapes supported

The mapper (`normalizeRates`) accepts either:

- **Array** (what the WC plugin consumed): `[{ id, label, cost }, ...]`
- **Speeds map** (richer `ShippingRateService::calculateRates` output):
  `{ speeds: { economy: { price }, priority: { price }, ... } }`

Zero/null prices are filtered out, prices round to 2dp, then convert to cents.

## Files

```
src/
  server.js                 Express app + raw-body capture (for HMAC)
  lib/
    config.js               env-driven config (mirrors plugin constants)
    units.js                grams→lbs, cm/mm/m→in, round2
    nicnatClient.js         Node port of Nicnat_API (rate call + headers)
  services/
    rateService.js          Shopify ⇄ Laravel translation (the core)
  middleware/
    auth.js                 HMAC verify + domain check (bypassable via flags)
  routes/
    carrierService.js       POST /carrier-service  (+ /debug)
    admin.js                POST /admin/register-carrier
```

## Notes / next steps

- Shopify's carrier payload has **no product dimensions**. We default to 1 in per
  side (same as the WC plugin's `?: 1`) unless you stash dims in line-item
  `properties` (`length/width/height`, optional `package_type_id`, `dim_unit`).
- To go to production: finish OAuth (store offline tokens per shop), set
  `AUTH_DISABLED=false` and `DOMAIN_CHECK_DISABLED=false`, and look the shop up in
  your DB inside `checkDomain`.

---

## Fixing the two most common "rates not showing" issues

### 1. The "Nicnatdirect — Free" / "Standard — Free" rows at checkout

These are NOT from this app. They are manual rates configured in:

**Shopify Admin → Settings → Shipping and delivery → Manage rates**

Open each shipping zone (Domestic, International, etc.) and **delete** the
manually-created rates named "Nicnatdirect" and "Standard" priced at $0.
Save. After this, when your app returns rates you'll see "Nicnat Economy /
Priority / Overnight" with real prices. When it returns nothing, the customer
will see "No shipping rates available" — the honest state.

### 2. Backend returns HTTP 401 "Missing credentials"

The Laravel backend has auth on. In the WooCommerce plugin the API key was
stored in `wp_options` after profile registration. In this Shopify app there
is no profile flow yet, so you pass the key via env var.

**Fix:**

1. Get the API key from your Laravel admin (or however your backend mints
   keys for registered domains).
2. In Railway → your service → **Variables**, add:
   ```
   NICNAT_API_KEY=<the key>
   ```
3. If your backend also whitelists which domains may call it (and your
   Shopify shop domain isn't whitelisted), add:
   ```
   NICNAT_DOMAIN_OVERRIDE=https://your-registered-domain.com
   ```
   This sends that domain in both the `X-Nicnat-Domain` header AND the
   `domain_name` payload field, matching exactly what the WC plugin sent.
4. Save (Railway auto-redeploys).
5. Re-hit `/diagnose`. The `verdict` should change to "OK — rates returned"
   and `shopifyRates` should have entries.

If you don't have an API key yet, the alternative is to **temporarily disable
auth on the Laravel side** so you can validate the rest of the pipeline works.

### How `/diagnose` now guides you

The endpoint returns both a `verdict` and a `nextStep`:

```jsonc
{
  "verdict":  "FAIL — backend returned HTTP 401. Auth failed.",
  "nextStep": "Set NICNAT_API_KEY in your environment (Railway → Variables)…",
  "checks": {
    "apiKeyConfigured": false,
    "domainOverrideConfigured": false,
    "backendHttpError": 401,
    ...
  },
  "sentHeaders": {
    "X-Nicnat-Key": "(empty)",
    "X-Nicnat-Domain": "https://diagnose.myshopify.com"
  },
  "backendRawResponse": { "error": "Missing credentials", ... }
}
```

So the next step is always printed in the response. Follow it.
