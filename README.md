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

## Debugging "Free" rates / no rates showing

When Shopify shows "Free" or your manual fallback rate instead of Nicnat rates,
it almost always means the carrier-service callback returned `{rates: []}`. There
are four common reasons. Use these tools in order.

### Step 1 — Hit `/diagnose` first

Open this in a browser (no body needed, it sends a hardcoded US→US cart):

```
https://YOUR-DOMAIN.up.railway.app/diagnose
```

You'll get back a `verdict` plus `checks`, `sentToBackend`, `backendRawResponse`,
and `shopifyRates`. The verdict tells you exactly which layer is broken:

| Verdict | Meaning | Fix |
|---|---|---|
| OK — rates returned | App + backend both work | Issue is store-specific (see Step 4) |
| FAIL — backend unreachable | Can't reach Laravel | Check `NICNAT_API_BASE`, network egress, DNS |
| FAIL — backend HTTP 4xx/5xx | Backend rejected the call | Check auth headers, domain whitelist, payload shape |
| FAIL — backend returned empty body | Wrong endpoint path | Check `NICNAT_RATES_ENDPOINT` |
| FAIL — no rates parsed | Backend returned a shape we don't understand, or all prices were 0/null | Inspect `backendRawResponse` in the JSON |

### Step 2 — Hit `/carrier-service/debug` with the real cart

Reproduce your actual checkout (e.g. India destination from your screenshot):

```bash
curl -X POST https://YOUR-DOMAIN.up.railway.app/carrier-service/debug \
  -H 'Content-Type: application/json' \
  -d '{
    "rate": {
      "origin": { "country": "US", "postal_code": "10001", "province": "NY" },
      "destination": { "country": "IN", "postal_code": "411001", "province": "MH" },
      "currency": "USD",
      "items": [{ "name":"Tee","quantity":1,"grams":500,"product_id":1,"variant_id":1 }]
    }
  }'
```

Returns: `sentToBackend`, `backendRawResponse`, `backendError`, `note`,
`normalized`, `shopifyRates`. If `shopifyRates: []` but `backendRawResponse`
has data, the response shape isn't one we recognise — paste it and we'll
extend `normalizeRates()` in `src/services/rateService.js`.

### Step 3 — Check live logs

Railway: Deployments → View Logs (or `railway logs --tail`).
Every checkout request logs (with a short `reqId` so you can follow one
request through):

```
[carrier-service][request]       {"reqId":"a1b2c3","shop":"...","destination":{...}}
[carrier-service][backend-payload] {"reqId":"a1b2c3","payload":{...}}
[carrier-service][backend-raw]   {"reqId":"a1b2c3","raw":{...}}
[carrier-service][normalized]    {"reqId":"a1b2c3","normalized":[...]}
[carrier-service][shopify-rates] {"reqId":"a1b2c3","rates":[...]}
[carrier-service][EMPTY-RATES-RETURNED] {"reqId":"a1b2c3","why":"...","hint":"..."}
```

If you don't see ANY `[carrier-service]` lines when you reach checkout,
Shopify isn't calling your app at all — the carrier service isn't registered
for that shop. Re-run `POST /admin/register-carrier`.

### Step 4 — Common causes & fixes

**A. Carrier service not registered with the shop.**
No `[carrier-service][request]` log lines on checkout → Shopify never called you.
Re-register:
```bash
curl -X POST https://YOUR-DOMAIN.up.railway.app/admin/register-carrier \
  -H 'Content-Type: application/json' \
  -d '{"shop":"your-store.myshopify.com","accessToken":"shpat_xxx"}'
```

**B. Destination country has no rates in the backend.**
This is what your "India" screenshot looks like. The WC plugin and Laravel
service were US-store-origin oriented. Confirm with `/carrier-service/debug`
using the same destination — if `backendRawResponse` is empty/has an error,
the backend has no rates for that country. Either add them server-side or
limit the destinations your store sells to.

**C. Backend HTTP error (auth, missing headers).**
`/diagnose` shows `backendHttpError: 401/403/422`. Inspect what
`X-Nicnat-Key` / `X-Nicnat-Domain` your backend expects, set `NICNAT_API_KEY`
in env, and flip `AUTH_DISABLED=false` once you have it working.

**D. The "Free" rows are manual store rates, not from your app.**
Shopify Admin → **Settings → Shipping and delivery** → check each shipping
profile/zone. If you see manually-created rates called "Nicnatdirect" or
"Standard" priced at $0, delete or hide them — they're confusing the picture.
After you delete them and the app returns `[]`, the customer will simply see
"No shipping rates available" (which is the honest state when the backend
has no rates).

**E. All backend prices were 0 or null.**
`normalizeRates()` filters those out (matches the WC plugin behaviour).
Check `backendRawResponse` — if `cost: 0` or `price: null`, the issue is in
the rate calculation server-side (likely no zone/rate row for that
package/destination), not in this app.

### When to ask for help

Capture and share:
1. Full output of `GET /diagnose`
2. Full output of `POST /carrier-service/debug` with your failing cart
3. The relevant `[carrier-service][...]` log lines (find them by `reqId`)

That's enough to pinpoint any remaining issue.
