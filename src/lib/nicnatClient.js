import config from "./config.js";

/**
 * NicnatClient — Node port of the WooCommerce `Nicnat_API` class (api-client.php)
 * plus `nicnat_api_headers()` / `nicnat_decode_response()` from helpers.php.
 *
 * Only the rate call is needed for showing rates at checkout, but the same
 * pattern extends to profile/orders/tracking later.
 */
class NicnatClient {
  base() {
    return config.nicnat.apiBase; // already has trailing slash
  }

  headers(shopDomain = "") {
    // Mirrors nicnat_api_headers(): JSON + the X-Nicnat-* identity headers.
    // Auth is intentionally permissive for now (key may be blank).
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (config.nicnat.apiKey) h["X-Nicnat-Key"] = config.nicnat.apiKey;
    if (shopDomain) h["X-Nicnat-Domain"] = shopDomain;
    return h;
  }

  async post(endpoint, payload, shopDomain = "", timeoutMs = config.nicnat.timeoutMs) {
    const url = this.base() + endpoint.replace(/^\//, "");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers(shopDomain),
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
        return { __httpError: res.status, __raw: text, ...(typeof data === "object" ? data : {}) };
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Equivalent of Nicnat_API::get_shipping_rates($payload).
   * Returns whatever the Laravel endpoint returns (we normalise in the mapper).
   */
  async getShippingRates(payload, shopDomain = "") {
    return this.post(config.nicnat.ratesEndpoint, payload, shopDomain);
  }
}

export default new NicnatClient();
