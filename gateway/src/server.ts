/**
 * Vanton gateway.
 *
 * Wraps a provider's paid API with two gates, in order:
 *   1. Mandate gate (on-ledger allowance) — once the Vanton DAR is deployed,
 *      the agent's spend must be authorized by its AgentMandate or we 403
 *      without charging. Until then, enabled only when VANTON_PACKAGE_ID is set.
 *   2. Payment gate — PAY_MODE selects the rail:
 *        devnet (default): our 402 challenge, settled by a real CC transfer on
 *                          the hackathon node, verified in the merchant wallet.
 *        x402:             FTP facilitator middleware (mainnet transfer-factory).
 *
 * Also serves the marketplace data endpoints (/listings, /activity) that the
 * UI reads.
 */

import "dotenv/config";
import express from "express";
import { authorizeSpend, type MandateCheckConfig } from "./mandate.js";
import { issueCharge, verifyCharge, activityFeed } from "./devnet-pay.js";
import { cantonStats } from "./canton-data.js";
import { getAccessToken } from "./auth.js";

const PORT = Number(process.env.PORT ?? 3402);
const PAY_MODE = process.env.PAY_MODE ?? "devnet";
const PRICE_CC = process.env.PRICE_CC ?? "0.01";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name} — see .env.example`);
    process.exit(1);
  }
  return v;
}

const MERCHANT_PARTY = requireEnv("CANTON_X402_PAYTO");

const app = express();
app.use(express.json());

// The marketplace UI (localhost:3400) reads /listings and /activity cross-origin.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-vanton-mandate, x-vanton-payment");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// Marketplace data (free endpoints; the UI reads these)
// ---------------------------------------------------------------------------

const listings = [
  {
    id: "canton-stats",
    name: "Canton Stats API",
    provider: MERCHANT_PARTY,
    priceAmount: PRICE_CC,
    priceAsset: "CC",
    category: "analytics",
    endpoint: "/stats",
    description: "Live Canton network stats, priced per call.",
  },
];

app.get("/listings", (_req, res) => res.json({ listings }));

// A provider lists a service. In production this is a ServiceListingProposal on
// the ledger (signed with the provider's Console Wallet) that the operator
// accepts; here it registers the listing the marketplace shows and the gateway
// meters. The provider party is the payee for that service.
app.post("/listings", (req, res) => {
  const { name, provider, priceAmount, priceAsset, category, endpoint, description } =
    req.body ?? {};
  if (!name || !provider || !priceAmount) {
    return res.status(400).json({ error: "name, provider and priceAmount are required" });
  }
  if (Number.isNaN(Number(priceAmount)) || Number(priceAmount) <= 0) {
    return res.status(400).json({ error: "priceAmount must be a positive number" });
  }
  const id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  if (listings.some((l) => l.id === id)) {
    return res.status(409).json({ error: "a service with that name already exists" });
  }
  const listing = {
    id,
    name: String(name),
    provider: String(provider),
    priceAmount: String(priceAmount),
    priceAsset: priceAsset === "cBTC" || priceAsset === "cETH" ? priceAsset : "CC",
    category: String(category || "general"),
    endpoint: String(endpoint || `/${id}`),
    description: String(description || ""),
  };
  listings.unshift(listing);
  console.log(`[gateway] listed "${listing.name}" @ ${listing.priceAmount} ${listing.priceAsset} by ${listing.provider.slice(0, 24)}…`);
  res.status(201).json({ listing });
});

app.get("/activity", (_req, res) => res.json({ activity: activityFeed() }));
app.get("/health", (_req, res) => res.json({ ok: true, payMode: PAY_MODE }));

// ---------------------------------------------------------------------------
// Mandate + payment gate for /stats
//   initial request (no payment): the on-ledger mandate authorizes the spend
//     (budget / per-call cap / expiry). Rejected -> 403 and the agent never
//     pays. Authorized -> issue the 402 challenge.
//   retry (with x-vanton-payment): verify the CC settled on devnet, then serve.
// The mandate check runs on the ledger hosting our DAR (local Canton today; the
// shared node once the package is installed). Enabled when VANTON_PACKAGE_ID set.
// ---------------------------------------------------------------------------

const mandateEnabled = Boolean(process.env.VANTON_PACKAGE_ID);
const mandateCfg: MandateCheckConfig | null = mandateEnabled
  ? {
      ledgerApiUrl: requireEnv("LOCAL_LEDGER_API_URL").replace(/\/$/, ""),
      operatorParty: requireEnv("VANTON_OPERATOR_PARTY"),
      agentParty: requireEnv("VANTON_AGENT_PARTY"),
      packageId: process.env.VANTON_PACKAGE_ID!,
      // Shared devnet node needs auth; a local sandbox does not.
      getToken: process.env.MANDATE_AUTH === "true" ? getAccessToken : undefined,
    }
  : null;

if (PAY_MODE !== "devnet") {
  console.error("[gateway] PAY_MODE=x402 (mainnet facilitator) is the post-hackathon rail; use devnet");
  process.exit(1);
}

app.use("/stats", async (req, res, next) => {
  const ref = req.header("x-vanton-payment");

  if (!ref) {
    // Initial request: enforce the on-ledger mandate BEFORE offering to charge.
    if (mandateCfg) {
      const auth = await authorizeSpend(mandateCfg, "canton-stats", PRICE_CC);
      if (!auth.ok) {
        console.log(`[gateway] mandate DENIED: ${auth.reason} (budget left ${auth.remaining})`);
        return res
          .status(403)
          .json({ error: "mandate denied", reason: auth.reason, budgetRemaining: auth.remaining });
      }
      console.log(`[gateway] mandate authorized · budget left ${auth.remaining} CC`);
    }
    const charge = issueCharge("canton-stats", PRICE_CC);
    return res.status(402).json({
      price: charge.price,
      payTo: MERCHANT_PARTY,
      asset: "CC",
      reference: charge.reference,
      instructions:
        "Pay via Canton validator API transfer-preapproval/send with description=<reference>, then retry with header x-vanton-payment: <reference>",
    });
  }

  // Retry with payment — verify it landed on-ledger (indexing can lag a few s).
  for (let attempt = 0; attempt < 5; attempt++) {
    const settledCharge = await verifyCharge(ref);
    if (settledCharge) {
      console.log(
        `[gateway] verified ${settledCharge.price} CC (${ref}) event ${settledCharge.eventId.slice(0, 18)}…`,
      );
      return next();
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return res.status(402).json({ error: "payment not found on-ledger", reference: ref });
});

// ---------------------------------------------------------------------------
// The paid resource
// ---------------------------------------------------------------------------

app.get("/stats", async (_req, res) => {
  try {
    const stats = await cantonStats();
    res.json({ service: "canton-stats", paid: true, ...stats });
  } catch (e) {
    res.status(502).json({ error: "upstream data unavailable", detail: (e as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`[vanton-gateway] :${PORT} payMode=${PAY_MODE} price=${PRICE_CC} CC`);
  console.log(`  GET /stats     — paid (mandate gate ${mandateEnabled ? "ON" : "off — pre-DAR"})`);
  console.log(`  GET /listings  — free`);
  console.log(`  GET /activity  — free`);
});
