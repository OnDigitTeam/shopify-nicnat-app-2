/**
 * Unit conversion — mirrors nicnat_convert_weight() / nicnat_convert_dimension()
 * from the WooCommerce shipping-method.php.
 *
 * The Laravel rate service (WeightHelper::chargeable + FedEx provider) works in
 * POUNDS and INCHES, so we normalise everything to lbs/in here, exactly like
 * the WC plugin did with wc_get_weight(..,'lbs') and wc_get_dimension(..,'in').
 *
 * Shopify specifics:
 *   - Cart line item `grams` is ALWAYS grams.
 *   - Shopify does not send product dimensions in the carrier callback, so we
 *     fall back to the same per-item defaults the WC plugin used (1 in each)
 *     unless the merchant has stored dimensions in line item properties.
 */

const GRAMS_PER_LB = 453.59237;
const CM_PER_INCH = 2.54;

export function gramsToLbs(grams) {
  const g = Number(grams) || 0;
  if (g <= 0) return 0;
  return g / GRAMS_PER_LB;
}

export function toLbs(value, unit = "lb") {
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  switch ((unit || "lb").toLowerCase()) {
    case "lb":
    case "lbs":
      return v;
    case "oz":
      return v / 16;
    case "kg":
      return v * 2.2046226218;
    case "g":
    case "grams":
      return gramsToLbs(v);
    default:
      return v;
  }
}

export function toInches(value, unit = "in") {
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  switch ((unit || "in").toLowerCase()) {
    case "in":
    case "inch":
    case "inches":
      return v;
    case "cm":
      return v / CM_PER_INCH;
    case "mm":
      return v / (CM_PER_INCH * 10);
    case "m":
      return (v * 100) / CM_PER_INCH;
    default:
      return v;
  }
}

/** Round to 2dp the way the rate service formats prices. */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
