import { Router } from "express";
import { verifyShopifyHmac, checkDomain } from "../middleware/auth.js";
import { getRatesForShopify } from "../services/rateService.js";

const router = Router();

/**
 * Tiny structured logger. Always logs — even in production — so you can see
 * exactly what Shopify sent, what we sent to the backend, and what came back.
 * View logs on Railway: Deployments → View Logs (or `railway logs`).
 */
function log(stage, obj) {
  try {
    console.log(`[carrier-service][${stage}] ${JSON.stringify(obj)}`);
  } catch {
    console.log(`[carrier-service][${stage}]`, obj);
  }
}

/**
 * Shopify CarrierService callback.
 * Body: { rate: { origin, destination, items, currency, locale } }
 * Response: { rates: [ { service_name, service_code, total_price (cents string), currency } ] }
 *
 * Returning `{rates: []}` is valid; Shopify just shows no Nicnat option and
 * falls back to whatever manual rates the store has configured (that's where
 * the mysterious "Free" rows come from).
 */
router.post("/carrier-service", verifyShopifyHmac, checkDomain, async (req, res) => {
  const shopDomain = req.shopDomain || req.get("X-Shopify-Shop-Domain") || "";
  const reqId = Math.random().toString(36).slice(2, 8);

  log("request", {
    reqId,
    shop: shopDomain,
    origin: req.body?.rate?.origin,
    destination: req.body?.rate?.destination,
    itemCount: req.body?.rate?.items?.length || 0,
  });

  try {
    const result = await getRatesForShopify(req.body, shopDomain);

    log("backend-payload", { reqId, payload: result.payload });
    log("backend-raw",     { reqId, raw: result.raw });
    log("normalized",      { reqId, normalized: result.normalized });
    log("shopify-rates",   { reqId, rates: result.rates });

    if (result.error)       log("backend-error", { reqId, error: result.error });
    if (result.note)        log("note",          { reqId, note: result.note });
    if (!result.rates.length) {
      log("EMPTY-RATES-RETURNED", {
        reqId,
        why: result.note
          || (result.error ? "backend error (see above)" : "backend returned nothing usable"),
        hint: "Shopify will now show the store's manual fallback rates (often 'Free').",
      });
    }

    return res.status(200).json({ rates: result.rates });
  } catch (err) {
    log("fatal", { reqId, error: err?.message || String(err), stack: err?.stack });
    // Never break checkout — return no rates rather than a 500.
    return res.status(200).json({ rates: [] });
  }
});

/**
 * Debug endpoint: returns the full picture (payload sent to backend, raw
 * backend response, normalized rates, mapped Shopify rates) so you can verify
 * everything without going through Shopify checkout.
 *
 * POST a Shopify-shaped { rate: {...} } body here, OR a simplified body like:
 *   { "origin": {...}, "destination": {...}, "items": [...] }
 */
router.post("/carrier-service/debug", async (req, res) => {
  const shopDomain = req.get("X-Shopify-Shop-Domain") || req.body.shop || "debug.myshopify.com";
  // Allow flat body (no .rate wrapper) for convenience
  const body = req.body.rate ? req.body : { rate: req.body };
  const result = await getRatesForShopify(body, shopDomain);
  return res.status(200).json({
    ok: result.rates.length > 0,
    shop: shopDomain,
    sentToBackend: result.payload,
    backendRawResponse: result.raw,
    backendError: result.error || null,
    note: result.note || null,
    normalized: result.normalized || [],
    shopifyRates: result.rates,
  });
});

/**
 * /diagnose — one-shot self-test you can hit from a browser. Uses a hardcoded
 * US→US cart to check that the backend is reachable and returning rates.
 * Use this FIRST whenever rates aren't showing.
 */
router.get("/diagnose", async (_req, res) => {
  const sample = {
    rate: {
      origin: { country: "US", postal_code: "10001", province: "NY" },
      destination: { country: "US", postal_code: "90210", province: "CA" },
      currency: "USD",
      items: [
        { name: "Diagnostic item", quantity: 1, grams: 500, product_id: 1, variant_id: 1 },
      ],
    },
  };
  const result = await getRatesForShopify(sample, "diagnose.myshopify.com");

  const checks = {
    backendReachable: result.raw !== null && result.error == null,
    backendReturnedData: !!result.raw && (Array.isArray(result.raw) || Object.keys(result.raw || {}).length > 0),
    backendHttpError: result.raw?.__httpError || null,
    ratesNormalized: (result.normalized || []).length,
    shopifyRatesCount: result.rates.length,
  };

  const verdict = checks.shopifyRatesCount > 0
    ? "OK — rates returned successfully"
    : !checks.backendReachable
      ? "FAIL — backend unreachable or threw. Check NICNAT_API_BASE and network."
      : checks.backendHttpError
        ? `FAIL — backend returned HTTP ${checks.backendHttpError}. Check auth / domain whitelist.`
        : !checks.backendReturnedData
          ? "FAIL — backend returned empty body. Likely wrong endpoint path."
          : "FAIL — backend responded but no rates parsed. Inspect backendRawResponse shape.";

  res.status(200).json({
    verdict,
    checks,
    sentToBackend: result.payload,
    backendRawResponse: result.raw,
    backendError: result.error || null,
    shopifyRates: result.rates,
  });
});

export default router;
