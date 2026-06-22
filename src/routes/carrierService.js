import { Router } from "express";
import { verifyShopifyHmac, checkDomain } from "../middleware/auth.js";
import { getRatesForShopify } from "../services/rateService.js";
import nicnat from "../lib/nicnatClient.js";
import config from "../lib/config.js";

const router = Router();

function log(stage, obj) {
  try { console.log(`[carrier-service][${stage}] ${JSON.stringify(obj)}`); }
  catch { console.log(`[carrier-service][${stage}]`, obj); }
}

/**
 * Shopify CarrierService callback.
 * Body:     { rate: { origin, destination, items, currency, locale } }
 * Response: { rates: [ { service_name, service_code, total_price (cents string), currency } ] }
 *
 * Returning `{rates: []}` is valid. When it happens, Shopify falls back to
 * the store's manually-configured rates (this is where "Free" rows come from
 * — they're in Shopify Admin → Settings → Shipping and delivery, NOT this app).
 */
router.post("/carrier-service", verifyShopifyHmac, checkDomain, async (req, res) => {
  const shopDomain = req.shopDomain || req.get("X-Shopify-Shop-Domain") || "";
  const reqId = Math.random().toString(36).slice(2, 8);

  log("request", {
    reqId, shop: shopDomain,
    origin: req.body?.rate?.origin,
    destination: req.body?.rate?.destination,
    itemCount: req.body?.rate?.items?.length || 0,
  });

  try {
    const result = await getRatesForShopify(req.body, shopDomain);
    log("backend-payload",   { reqId, payload: result.payload });
    log("backend-raw",       { reqId, raw: result.raw });
    log("normalized",        { reqId, normalized: result.normalized });
    log("shopify-rates",     { reqId, rates: result.rates });
    if (result.error) log("backend-error", { reqId, error: result.error });
    if (result.note)  log("note",          { reqId, note: result.note });
    if (result.usedFallback) {
      log("FALLBACK-RATES-USED", {
        reqId,
        reason: result.note,
        hint: "NICNAT_USE_FALLBACK is ON. Real backend failed — returning hardcoded test rates labelled '(TEST)'. Turn this off in production.",
      });
    }
    if (!result.rates.length) {
      log("EMPTY-RATES-RETURNED", {
        reqId,
        why: result.note || (result.error ? "backend error (see above)" : "no usable rates"),
        hint: "Shopify will now show the store's manual fallback rates (often 'Free').",
      });
    }
    return res.status(200).json({ rates: result.rates });
  } catch (err) {
    log("fatal", { reqId, error: err?.message || String(err), stack: err?.stack });
    return res.status(200).json({ rates: [] });
  }
});

/** POST a Shopify-shaped { rate: {...} } body (or flat) to inspect the full pipeline. */
router.post("/carrier-service/debug", async (req, res) => {
  const shopDomain = req.get("X-Shopify-Shop-Domain") || req.body.shop || "debug.myshopify.com";
  const body = req.body.rate ? req.body : { rate: req.body };
  const result = await getRatesForShopify(body, shopDomain);
  return res.status(200).json({
    ok: result.rates.length > 0,
    shop: shopDomain,
    sentHeaders: nicnat.headersForLog(shopDomain),
    sentToBackend: result.payload,
    backendRawResponse: result.raw,
    backendError: result.error || null,
    note: result.note || null,
    normalized: result.normalized || [],
    shopifyRates: result.rates,
  });
});

/**
 * /diagnose — browser-friendly self-test. Uses a hardcoded US→US cart.
 */
router.get("/diagnose", async (_req, res) => {
  const sample = {
    rate: {
      origin: { country: "US", postal_code: "10001", province: "NY" },
      destination: { country: "US", postal_code: "90210", province: "CA" },
      currency: "USD",
      items: [{ name: "Diagnostic item", quantity: 1, grams: 500, product_id: 1, variant_id: 1 }],
    },
  };
  const shop = "diagnose.myshopify.com";
  const result = await getRatesForShopify(sample, shop);
  const sentHeaders = nicnat.headersForLog(shop);

  const checks = {
    apiKeyConfigured: Boolean(config.nicnat.apiKey),
    domainOverrideConfigured: Boolean(config.nicnat.domainOverride),
    backendReachable: result.raw !== null && result.error == null,
    backendReturnedData: !!result.raw && Object.keys(result.raw || {}).length > 0,
    backendHttpError: result.raw?.__httpError || null,
    ratesNormalized: (result.normalized || []).length,
    shopifyRatesCount: result.rates.length,
    fallbackEnabled: config.nicnat.useFallback,
    fallbackUsed: Boolean(result.usedFallback),
  };

  // Verdict + actionable next step
  let verdict, nextStep;
  if (checks.fallbackUsed) {
    verdict = "⚠️  TEST MODE — fallback rates returned because real backend failed.";
    nextStep = `Backend reason: ${result.note}. The Shopify-side flow IS working (these test rates will show at checkout, labelled "(TEST)"). Fix the backend issue, then set NICNAT_USE_FALLBACK=false.`;
  } else if (checks.shopifyRatesCount > 0) {
    verdict = "OK — rates returned successfully";
    nextStep = "Delete the manual 'Nicnatdirect' / 'Standard' rates from Shopify Admin so only real rates show.";
  } else if (!checks.backendReachable) {
    verdict = "FAIL — backend unreachable or threw.";
    nextStep = `Check NICNAT_API_BASE (currently ${config.nicnat.apiBase}) and network egress.`;
  } else if (checks.backendHttpError === 401 || checks.backendHttpError === 403) {
    verdict = `FAIL — backend returned HTTP ${checks.backendHttpError}. Auth failed.`;
    nextStep = !checks.apiKeyConfigured
      ? "Set NICNAT_API_KEY in your environment (Railway → Variables) to the API key your Laravel backend issued for your registered domain."
      : "API key is set but backend rejected it. Verify NICNAT_API_KEY matches a real plugin-user key (NOT the Laravel app's internal PLUGIN_API_KEY). The working Postman key is the one to use.";
  } else if (checks.backendHttpError) {
    verdict = `FAIL — backend returned HTTP ${checks.backendHttpError}.`;
    nextStep = "Inspect backendRawResponse below for the backend's error message.";
  } else if (!checks.backendReturnedData) {
    verdict = "FAIL — backend returned an empty body.";
    nextStep = `Check NICNAT_RATES_ENDPOINT (currently '${config.nicnat.ratesEndpoint}') — likely wrong path.`;
  } else {
    verdict = "FAIL — backend responded but no rates parsed.";
    nextStep = "Inspect backendRawResponse below. If the shape is new, extend normalizeRates() in src/services/rateService.js.";
  }
  if (checks.fallbackEnabled && !checks.fallbackUsed) {
    nextStep += " (NICNAT_USE_FALLBACK is ON but wasn't needed — real rates came through.)";
  }

  res.status(200).json({
    verdict,
    nextStep,
    checks,
    sentHeaders,
    sentToBackend: result.payload,
    backendRawResponse: result.raw,
    backendError: result.error || null,
    note: result.note || null,
    shopifyRates: result.rates,
  });
});

export default router;
