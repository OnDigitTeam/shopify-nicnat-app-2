// dotenv is optional at import time so the app/tests can run before deps are
// installed; if present it loads .env, otherwise process.env is used as-is.
try {
  const dotenv = await import("dotenv");
  dotenv.default.config();
} catch {
  /* dotenv not installed yet — rely on real process.env */
}

function bool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  return String(v).toLowerCase() === "true" || v === "1";
}

const base = (process.env.NICNAT_API_BASE || "https://nicnat.ondigit.us/api/v1/").trim();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: (process.env.HOST || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ""),
  nodeEnv: process.env.NODE_ENV || "development",

  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    apiSecret: process.env.SHOPIFY_API_SECRET || "",
    scopes: (process.env.SHOPIFY_SCOPES || "write_shipping,read_shipping")
      .split(",").map((s) => s.trim()).filter(Boolean),
    apiVersion: process.env.SHOPIFY_API_VERSION || "2025-01",
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN || "",
  },

  nicnat: {
    apiBase: base.endsWith("/") ? base : base + "/",
    ratesEndpoint: (process.env.NICNAT_RATES_ENDPOINT || "get-shipping-rates").replace(/^\//, ""),

    // The API key the Laravel backend expects in the X-Nicnat-Key header.
    // This is the equivalent of `get_option('nicnat_api_key')` in the WC plugin.
    // If your backend has auth enabled (returns 401 "Missing credentials"),
    // you MUST set this — get it from your Laravel admin (or whichever flow
    // mints these keys for registered domains).
    apiKey: process.env.NICNAT_API_KEY || "",

    // Spoof the X-Nicnat-Domain header + payload domain_name. Useful when the
    // backend whitelists domains and your Shopify shop domain isn't registered
    // yet — set this to a domain that IS registered (e.g. your old WC site).
    // Leave blank to send the real Shopify shop domain.
    domainOverride: (process.env.NICNAT_DOMAIN_OVERRIDE || "").trim(),

    timeoutMs: parseInt(process.env.NICNAT_TIMEOUT_MS || "25000", 10),
    methods: (process.env.NICNAT_METHODS || "economy,priority,overnight")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    shippingServiceId: parseInt(process.env.NICNAT_SHIPPING_SERVICE_ID || "1", 10),
    originCountry: (process.env.NICNAT_ORIGIN_COUNTRY || "US").toUpperCase(),
  },

  flags: {
    authDisabled: bool(process.env.AUTH_DISABLED, true),
    domainCheckDisabled: bool(process.env.DOMAIN_CHECK_DISABLED, true),
  },
};

export default config;
