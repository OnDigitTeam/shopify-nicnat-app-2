import crypto from "crypto";
import config from "../lib/config.js";

/**
 * Verify the Shopify HMAC on the carrier-service callback.
 *
 * Per the user's request, auth + domain checks are DISABLED by default
 * (AUTH_DISABLED / DOMAIN_CHECK_DISABLED in .env) so rates show without setup.
 * Flip the flags to false in production to lock this down.
 *
 * IMPORTANT: HMAC verification needs the RAW request body, so the route that
 * uses this must capture rawBody (see server.js express.json verify hook).
 */
export function verifyShopifyHmac(req, res, next) {
  if (config.flags.authDisabled) {
    req.shopDomain = req.get("X-Shopify-Shop-Domain") || "";
    return next();
  }

  const hmacHeader = req.get("X-Shopify-Hmac-Sha256") || "";
  const secret = config.shopify.apiSecret;
  if (!secret || !hmacHeader || !req.rawBody) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid HMAC" });
  }

  req.shopDomain = req.get("X-Shopify-Shop-Domain") || "";
  return next();
}

/**
 * Optional shop-domain whitelist. Disabled by default.
 * In production you'd look the shop up in your DB / installed-shops list.
 */
export function checkDomain(req, res, next) {
  if (config.flags.domainCheckDisabled) return next();

  const shop = req.get("X-Shopify-Shop-Domain") || "";
  if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/i.test(shop)) {
    return res.status(403).json({ error: "Forbidden domain" });
  }
  // TODO: confirm shop is installed/active before returning rates.
  return next();
}
