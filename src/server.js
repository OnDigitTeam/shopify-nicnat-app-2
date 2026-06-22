import express from "express";

/**
 * NicnatDirect Shopify Shipping App — minimal test build.
 *
 * No backend, no auth, no config. Always returns two static rates so we can
 * verify the end-to-end Shopify CarrierService flow:
 *   - "Nicnat Economy"  $79 + small random cents (so the value is visibly dynamic)
 *   - "Nicnat Priority" $89 + small random cents
 *
 * Endpoints:
 *   GET  /                  health/info
 *   POST /carrier-service   Shopify CarrierService callback (always returns rates)
 *   POST /admin/register-carrier   one-time setup so Shopify knows to call us
 *   GET  /diagnose          shows what we'd return for a sample cart
 */

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = (process.env.HOST || `http://localhost:${PORT}`).replace(/\/$/, "");
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

app.use(express.json({ limit: "1mb" }));

// ─── The static rates we always return ──────────────────────────────────────
const STATIC_RATES = [
  { id: 1, label: "Nicnat Economy",  key: "economy",  cost: 79 },
  { id: 2, label: "Nicnat Priority", key: "priority", cost: 89 },
];

/**
 * Add a small random cents offset (0–99¢) to each base cost so the merchant
 * can SEE the rate changing between checkouts — proves the rate is coming
 * from this app, not a cached Shopify zone rate.
 */
function buildShopifyRates(currency = "USD") {
  return STATIC_RATES.map((r) => {
    const randomCents = Math.floor(Math.random() * 100);            // 0–99
    const totalCents = Math.round(r.cost * 100) + randomCents;      // e.g. 7943
    return {
      service_name: r.label,
      service_code: `NICNAT_${r.key.toUpperCase()}`,
      total_price: String(totalCents),
      currency,
      description: `Test rate from NicnatDirect app — base $${r.cost}, randomized cents`,
    };
  });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({
    app: "NicnatDirect Shopify Shipping (minimal test build)",
    status: "ok",
    callback: `${HOST}/carrier-service`,
    note: "Always returns two static rates with random cents — works for any address.",
  });
});

/**
 * Shopify CarrierService callback.
 * Always responds with the two static rates, regardless of cart or address.
 */
app.post("/carrier-service", (req, res) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  const rate = req.body?.rate || {};
  const currency = rate.currency || "USD";

  console.log(`[carrier-service][${reqId}] request from ${req.get("X-Shopify-Shop-Domain") || "unknown"}`);
  console.log(`[carrier-service][${reqId}] destination:`, rate.destination);
  console.log(`[carrier-service][${reqId}] items: ${rate.items?.length || 0}`);

  const rates = buildShopifyRates(currency);

  console.log(`[carrier-service][${reqId}] returning ${rates.length} rate(s):`, JSON.stringify(rates));
  res.status(200).json({ rates });
});

/**
 * Browser-friendly self-test.
 */
app.get("/diagnose", (_req, res) => {
  const rates = buildShopifyRates("USD");
  res.json({
    verdict: "OK — static test rates",
    callback: `${HOST}/carrier-service`,
    note: "Visit /diagnose again — total_price will change (random cents) so you can confirm it's live from the app.",
    staticRates: STATIC_RATES,
    shopifyRates: rates,
  });
});

/**
 * Register (or update) the CarrierService in a shop so Shopify will call our
 * /carrier-service callback at checkout. Pass the shop's admin access token
 * in the request body — no OAuth required.
 *
 *   curl -X POST $HOST/admin/register-carrier \
 *     -H 'Content-Type: application/json' \
 *     -d '{"shop":"your-store.myshopify.com","accessToken":"shpat_xxx"}'
 */
app.post("/admin/register-carrier", async (req, res) => {
  const shop = (req.body.shop || "").trim();
  const accessToken = (req.body.accessToken || "").trim();
  if (!shop || !accessToken) {
    return res.status(400).json({ error: "Provide `shop` and `accessToken`." });
  }

  const callbackUrl = `${HOST}/carrier-service`;
  const endpoint = `https://${shop}/admin/api/${API_VERSION}/carrier_services.json`;
  const payload = {
    carrier_service: {
      name: "NicnatDirect Shipping",
      callback_url: callbackUrl,
      service_discovery: true,
      carrier_service_type: "api",
      format: "json",
      active: true,
    },
  };

  try {
    let resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify(payload),
    });
    let data = await resp.json().catch(() => ({}));

    if (resp.status === 422) {
      // Already exists — update its callback URL
      const listResp = await fetch(endpoint, { headers: { "X-Shopify-Access-Token": accessToken } });
      const list = await listResp.json().catch(() => ({}));
      const existing = (list.carrier_services || []).find((c) => c.name === "NicnatDirect Shipping");
      if (existing) {
        const updResp = await fetch(
          `https://${shop}/admin/api/${API_VERSION}/carrier_services/${existing.id}.json`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
            body: JSON.stringify({ carrier_service: { id: existing.id, callback_url: callbackUrl, active: true } }),
          }
        );
        data = await updResp.json().catch(() => ({}));
        return res.status(updResp.status).json({ action: "updated", callbackUrl, data });
      }
    }
    return res.status(resp.status).json({ action: "created", callbackUrl, data });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`NicnatDirect Shopify app (minimal test build) listening on :${PORT}`);
  console.log(`  Carrier callback: ${HOST}/carrier-service`);
  console.log(`  Mode: static rates, no backend, no auth`);
});

export default app;
