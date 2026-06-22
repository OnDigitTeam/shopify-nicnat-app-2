import { Router } from "express";
import config from "../lib/config.js";

const router = Router();

/**
 * Register (or update) the CarrierService in a shop so Shopify will call our
 * /carrier-service callback at checkout.
 *
 * In a full app you'd pull the shop's offline access token from your session
 * store after OAuth. For now, pass the token explicitly in the request body so
 * you can wire up rates immediately without finishing the auth flow.
 *
 * POST /admin/register-carrier
 * { "shop": "your-store.myshopify.com", "accessToken": "shpat_xxx" }
 */
router.post("/admin/register-carrier", async (req, res) => {
  const shop = (req.body.shop || "").trim();
  const accessToken = (req.body.accessToken || config.shopify.adminToken || "").trim();

  if (!shop || !accessToken) {
    return res.status(400).json({
      error: "Provide `shop` and `accessToken` (offline admin API token).",
    });
  }

  const callbackUrl = `${config.host}/carrier-service`;
  const apiVersion = config.shopify.apiVersion;
  const endpoint = `https://${shop}/admin/api/${apiVersion}/carrier_services.json`;

  const payload = {
    carrier_service: {
      name: "NicnatDirect Shipping",
      callback_url: callbackUrl,
      service_discovery: true,
      // 'legacy' carrier services are supported on all plans for testing.
      carrier_service_type: "api",
      format: "json",
      active: true,
    },
  };

  try {
    // Try to create. If it already exists, Shopify returns 422; then we update.
    let resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify(payload),
    });

    let data = await resp.json().catch(() => ({}));

    if (resp.status === 422) {
      // Already registered — find and update its callback URL.
      const listResp = await fetch(endpoint, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });
      const list = await listResp.json().catch(() => ({}));
      const existing = (list.carrier_services || []).find(
        (c) => c.name === "NicnatDirect Shipping"
      );
      if (existing) {
        const updResp = await fetch(
          `https://${shop}/admin/api/${apiVersion}/carrier_services/${existing.id}.json`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken,
            },
            body: JSON.stringify({
              carrier_service: { id: existing.id, callback_url: callbackUrl, active: true },
            }),
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

export default router;
