import express from "express";
import config from "./lib/config.js";
import carrierServiceRoutes from "./routes/carrierService.js";
import adminRoutes from "./routes/admin.js";

const app = express();

/**
 * Capture the raw body so HMAC verification works (Shopify signs the raw bytes).
 * express.json still parses req.body as usual.
 */
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf && buf.length ? buf.toString("utf8") : "";
    },
  })
);

// Health / home
app.get("/", (_req, res) => {
  res.json({
    app: "NicnatDirect Shopify Shipping",
    status: "ok",
    callback: `${config.host}/carrier-service`,
    authDisabled: config.flags.authDisabled,
    domainCheckDisabled: config.flags.domainCheckDisabled,
    backend: config.nicnat.apiBase + config.nicnat.ratesEndpoint,
    methods: config.nicnat.methods,
  });
});
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Routes
app.use("/", carrierServiceRoutes);
app.use("/", adminRoutes);

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(config.port, () => {
  console.log(`NicnatDirect Shopify app listening on :${config.port}`);
  console.log(`  Carrier callback: ${config.host}/carrier-service`);
  console.log(`  Backend rates:    ${config.nicnat.apiBase}${config.nicnat.ratesEndpoint}`);
  console.log(`  Auth disabled:    ${config.flags.authDisabled}`);
  console.log(`  Domain check off: ${config.flags.domainCheckDisabled}`);
});

export default app;
