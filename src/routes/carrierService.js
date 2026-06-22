import { Router } from "express";
import { verifyShopifyHmac, checkDomain } from "../middleware/auth.js";
import { getRatesForShopify } from "../services/rateService.js";

const router = Router();

/**
 * Shopify CarrierService callback.
 *
 * Shopify POSTs a body like:
 * {
 *   "rate": {
 *     "origin": { "country": "US", "postal_code": "10001", "province": "NY", ... },
 *     "destination": { "country": "US", "postal_code": "90210", "province": "CA", ... },
 *     "items": [ { "name", "quantity", "grams", "price", "product_id", "variant_id", "properties" }, ... ],
 *     "currency": "USD",
 *     "locale": "en"
 *   }
 * }
 *
 * We must respond with: { "rates": [ { service_name, service_code, total_price (cents, string), currency }, ... ] }
 * Returning an empty rates array is valid (Shopify just shows no Nicnat option).
 */
router.post("/carrier-service", verifyShopifyHmac, checkDomain, async (req, res) => {
  const shopDomain = req.shopDomain || req.get("X-Shopify-Shop-Domain") || "";

  try {
    const result = await getRatesForShopify(req.body, shopDomain);

    // Helpful server log (parallels the WC plugin's error_log of payload/rates)
    if (process.env.NODE_ENV !== "production") {
      console.log("[carrier-service] shop=%s", shopDomain);
      console.log("[carrier-service] payload=", JSON.stringify(result.payload));
      console.log("[carrier-service] rates=", JSON.stringify(result.rates));
      if (result.error) console.warn("[carrier-service] backend error:", result.error);
    }

    return res.status(200).json({ rates: result.rates });
  } catch (err) {
    console.error("[carrier-service] fatal:", err);
    // Never break checkout — return no rates rather than a 500.
    return res.status(200).json({ rates: [] });
  }
});

/**
 * Debug endpoint: same logic but returns the full backend payload + raw
 * response so you can verify rates without going through Shopify checkout.
 * POST a Shopify-shaped { rate: {...} } body here.
 */
router.post("/carrier-service/debug", async (req, res) => {
  const shopDomain = req.get("X-Shopify-Shop-Domain") || "debug.myshopify.com";
  const result = await getRatesForShopify(req.body, shopDomain);
  return res.status(200).json(result);
});

export default router;
