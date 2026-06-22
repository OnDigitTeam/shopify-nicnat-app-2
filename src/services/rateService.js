import config from "../lib/config.js";
import nicnat from "../lib/nicnatClient.js";
import { gramsToLbs, toInches, round2 } from "../lib/units.js";

/**
 * RateService — the brain of the app.
 *
 * Shopify CarrierService callback  ──►  Laravel get-shipping-rates payload
 * Laravel response                 ──►  Shopify rates[] response
 *
 * Mirrors WooCommerce `Nicnat_Shipping_Method::calculate_shipping()`:
 *   - builds the method list (economy / priority / overnight)
 *   - converts each line to lbs + inches
 *   - posts the same payload shape to the rate backend
 *   - turns the returned costs into selectable shipping options
 */

// Map a Nicnat method key -> {id,label} just like the WC plugin's $methods array.
const METHOD_DEFS = {
  economy: { id: 1, key: "economy", label: "Nicnat Economy" },
  priority: { id: 2, key: "priority", label: "Nicnat Priority" },
  overnight: { id: 3, key: "overnight", label: "Nicnat Overnight" },
};

// Shopify wants the service_code stable per method so it can be saved/selected.
const SERVICE_CODE = {
  economy: "NICNAT_ECONOMY",
  priority: "NICNAT_PRIORITY",
  overnight: "NICNAT_OVERNIGHT",
};

/**
 * Build the method list. Overnight is domestic-only (same rule as the WC plugin).
 */
function buildMethods(isDomestic) {
  const out = [];
  for (const m of config.nicnat.methods) {
    if (m === "overnight" && !isDomestic) continue;
    if (METHOD_DEFS[m]) out.push(METHOD_DEFS[m]);
  }
  return out;
}

/**
 * Convert a Shopify rate-request line item into the item/package shape used by
 * the WooCommerce payload AND the richer Laravel ShippingRateService payload.
 *
 * Shopify item fields: name, quantity, grams, price, product_id, variant_id,
 * and optional `properties` where merchants may stash dimensions.
 */
function mapItem(item) {
  const qty = Number(item.quantity) || 1;
  const props = item.properties || {};

  // Weight: Shopify gives grams -> lbs (WC used wc_get_weight(..,'lbs')).
  // Fall back to 0.5 lb like the WC plugin's `?: 0.5`.
  let weight = gramsToLbs(item.grams);
  if (!weight) weight = 0.5;

  // Dimensions are not part of Shopify's carrier payload, so use optional
  // line-item properties if present, else default to 1 in (WC used `?: 1`).
  const length = toInches(props.length || props._length || 1, props.dim_unit || "in") || 1;
  const width = toInches(props.width || props._width || 1, props.dim_unit || "in") || 1;
  const height = toInches(props.height || props._height || 1, props.dim_unit || "in") || 1;

  return {
    // WooCommerce-style item (for the simple get-shipping-rates endpoint)
    product_id: item.product_id || item.variant_id || 0,
    name: item.name || "",
    qty,
    weight,
    length,
    width,
    height,
    // ShippingRateService-style package (for the richer endpoint)
    package_type_id: Number(props.package_type_id) || 1,
    quantity: qty,
  };
}

/**
 * Build the payload sent to the Laravel backend. Matches the schema enforced
 * by `PluginAPIShippingRatesController::getRates()`:
 *   - origin_country       (string, required)
 *   - destination_country  (string, required)
 *   - destination_state    (string, optional — looked up via StateModel.code)
 *   - destination_postcode (string, optional)
 *   - methods              (array of {id,key,label}, required)
 *   - items                (array of {product_id,name,qty,weight,length,width,height}, required)
 *
 * This is byte-identical to the working Postman call.
 */
function buildPayload(shopifyReq, shopDomain) {
  const rate = shopifyReq.rate || shopifyReq;
  const origin = rate.origin || {};
  const dest = rate.destination || {};

  // Strip the package_type_id / quantity helper fields that buildMethods needs
  // internally — controller doesn't validate them but we don't need to send.
  const items = (rate.items || []).map(mapItem).map((i) => ({
    product_id: i.product_id,
    name: i.name,
    qty: i.qty,
    weight: i.weight,
    length: i.length,
    width: i.width,
    height: i.height,
  }));

  const originCountry = (origin.country || config.nicnat.originCountry || "US").toUpperCase();
  const destCountry = (dest.country || "").toUpperCase();
  const isDomestic = originCountry && destCountry && originCountry === destCountry;

  const methods = buildMethods(isDomestic);

  return {
    isDomestic,
    methods,
    payload: {
      origin_country: originCountry,
      destination_country: destCountry,
      destination_state: dest.province || "",
      destination_postcode: dest.postal_code || "",
      methods,
      items,
    },
  };
}

/**
 * Normalise the backend response into a flat list of {key,label,cost}.
 * Supports the two shapes seen in the codebase:
 *
 *  A) WooCommerce simple shape:  [ {id, label, cost}, ... ]
 *  B) ShippingRateService shape: { speeds: { economy:{price..}, priority:{...} } }
 */
function normalizeRates(data, methods) {
  const out = [];
  if (!data || typeof data !== "object") return out;

  // Shape A: top-level array, or {rates:[...]}, or {data:[...]}
  const arr = Array.isArray(data) ? data : data.rates || data.data;
  if (Array.isArray(arr)) {
    for (const r of arr) {
      if (r == null) continue;
      const cost = r.cost ?? r.price;
      if (cost == null) continue;
      const key = (r.key || r.label || `nicnat_${r.id}`).toString().toLowerCase();
      out.push({
        key: key.includes("nicnat") ? key.replace(/[^a-z]/g, "") : key,
        label: r.label || r.name || "Nicnat Shipping",
        cost: round2(cost),
      });
    }
    if (out.length) return out;
  }

  // Shape B: speeds map (best-company output of ShippingRateService::calculateRates)
  const speeds = data.speeds || (data.rates && data.rates.speeds);
  if (speeds && typeof speeds === "object") {
    for (const [speedKey, speedData] of Object.entries(speeds)) {
      if (!speedData) continue;
      const cost = typeof speedData === "object" ? speedData.price : speedData;
      if (cost == null || Number(cost) <= 0) continue;
      const def = METHOD_DEFS[speedKey.toLowerCase()];
      out.push({
        key: speedKey.toLowerCase(),
        label: def ? def.label : `Nicnat ${speedKey}`,
        cost: round2(cost),
      });
    }
  }

  return out;
}

/**
 * Turn a normalised rate into a Shopify CarrierService rate object.
 * Shopify expects `total_price` in the smallest currency unit (cents).
 */
function toShopifyRate(r) {
  const code =
    SERVICE_CODE[r.key] ||
    "NICNAT_" + r.key.replace(/[^a-z0-9]/gi, "_").toUpperCase();
  return {
    service_name: r.label,
    service_code: code,
    total_price: Math.round(r.cost * 100).toString(), // cents, as string
    currency: "USD",
    description: "Real-time rate via NicnatDirect",
  };
}

/**
 * Main entry: given Shopify's rate request, return Shopify rate objects.
 * Never throws to the caller — on failure returns [] so checkout still works.
 */
export async function getRatesForShopify(shopifyReq, shopDomain = "") {
  const { payload, methods, isDomestic } = buildPayload(shopifyReq, shopDomain);

  if (!methods.length) return { rates: [], payload, raw: null, note: "no methods enabled", usedFallback: false };
  if (!payload.items.length) return { rates: [], payload, raw: null, note: "empty cart", usedFallback: false };

  let raw, callError;
  try {
    raw = await nicnat.getShippingRates(payload, shopDomain);
  } catch (err) {
    callError = err.message || String(err);
    raw = null;
  }

  const normalized = normalizeRates(raw, methods);
  let rates = normalized.map(toShopifyRate);

  // Surface why we returned no rates so logs and /diagnose are actionable.
  let note;
  if (callError) {
    note = `backend threw: ${callError}`;
  } else if (raw && raw.__httpError) {
    note = `backend HTTP ${raw.__httpError}` + (raw.error ? ` — ${raw.error}` : "");
  } else if (!normalized.length) {
    note = "backend response had no usable rates (check shape and prices > 0)";
  }

  // ── Fallback / test mode ──────────────────────────────────────────────────
  // If the real call gave us nothing AND NICNAT_USE_FALLBACK=true, return
  // hardcoded test rates so you can verify the Shopify-rate flow works
  // independently of the backend. Each returned rate is labelled "(TEST)" so
  // it's obvious in checkout that this isn't a real price.
  let usedFallback = false;
  if (!rates.length && config.nicnat.useFallback) {
    const filtered = config.nicnat.fallbackRates.filter((r) => {
      if (r.key === "overnight" && !isDomestic) return false;
      return true;
    });
    rates = filtered.map((r) => {
      const shopifyRate = toShopifyRate({
        key: r.key,
        label: `${r.label} (TEST)`,
        cost: round2(r.cost),
      });
      // Make the test nature visible in checkout too
      shopifyRate.description = "TEST/FALLBACK rate — backend unreachable. NICNAT_USE_FALLBACK is on.";
      return shopifyRate;
    });
    usedFallback = true;
    note = (note ? note + " | " : "") + `FALLBACK ACTIVE: returned ${rates.length} test rate(s) instead`;
  }

  return { rates, payload, raw, normalized, note, usedFallback, error: callError || null };
}

export const __test = { buildMethods, mapItem, buildPayload, normalizeRates, toShopifyRate };
