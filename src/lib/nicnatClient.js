import config from "./config.js";

/**
 * NicnatClient — Node port of the WooCommerce `Nicnat_API` class (api-client.php)
 * plus `nicnat_api_headers()` / `nicnat_decode_response()` from helpers.php.
 *
 * Auth model (matches the WP plugin):
 *   - X-Nicnat-Key:   the API key the backend issues per registered domain
 *   - X-Nicnat-Domain: the calling site's URL
 * Both are sent on every request. We send them ALWAYS (even if empty) because
 * some auth middlewares treat "missing header" and "empty header" differently
 * and we want to match the WP plugin's exact wire behaviour.
 */
class NicnatClient {
  base() {
    return config.nicnat.apiBase; // already has trailing slash
  }

  /**
   * Resolve which domain identity to advertise to the backend. If
   * NICNAT_DOMAIN_OVERRIDE is set (e.g. your old WC site URL that's already
   * registered with NicnatDirect), use it; otherwise use the live Shopify
   * shop domain (formatted as https://...myshopify.com to match site_url()).
   */
  resolveDomain(shopDomain = "") {
    if (config.nicnat.domainOverride) return config.nicnat.domainOverride;
    if (!shopDomain) return "";
    return /^https?:\/\//i.test(shopDomain) ? shopDomain : `https://${shopDomain}`;
  }

  headers(shopDomain = "") {
    // Mirrors nicnat_api_headers() in helpers.php — always sent.
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Nicnat-Key": config.nicnat.apiKey || "",
      "X-Nicnat-Domain": this.resolveDomain(shopDomain),
    };
  }

  /** Headers with the api key masked, for logging / debug output. */
  headersForLog(shopDomain = "") {
    const h = this.headers(shopDomain);
    const k = h["X-Nicnat-Key"];
    return { ...h, "X-Nicnat-Key": k ? `${k.slice(0, 4)}…(${k.length} chars)` : "(empty)" };
  }

  async post(endpoint, payload, shopDomain = "", timeoutMs = config.nicnat.timeoutMs) {
    const url = this.base() + endpoint.replace(/^\//, "");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = this.headers(shopDomain);

    // Send body exactly as the caller built it. domain_name is NOT injected:
    // the controller doesn't validate or use it, and identity travels in the
    // X-Nicnat-Domain header (which matches the working Postman call).
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });

      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {}; // nicnat_decode_response: bad JSON -> []
      }

      if (!res.ok) {
        return {
          __httpError: res.status,
          __raw: text,
          __sentHeaders: this.headersForLog(shopDomain),
          ...(typeof data === "object" ? data : {}),
        };
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Equivalent of Nicnat_API::get_shipping_rates($payload). */
  async getShippingRates(payload, shopDomain = "") {
    return this.post(config.nicnat.ratesEndpoint, payload, shopDomain);
  }
}

export default new NicnatClient();
