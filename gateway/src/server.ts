/**
 * Vanton gateway.
 *
 * Wraps a provider's paid API with TWO gates, in order:
 *   1. Mandate gate (ours)  — the agent's on-ledger allowance must authorize the
 *                             spend, or we return 403 and never charge.
 *   2. Payment gate (x402)  — FTP's `cantonPaymentMiddleware` runs the 402
 *                             challenge and settles the payment via the
 *                             facilitator, one transaction on Canton.
 *
 * The paid handler only runs after BOTH gates pass. The payment mechanics follow
 * the x402-canton reference (scheme "exact", method "transfer-factory",
 * CIP-56 Token Standard). Merchant must self-provision a TransferPreapproval once:
 *     npx @ftptech/canton-agent-wallet preapproval
 */

import "dotenv/config";
import express from "express";
import { cantonPaymentMiddleware } from "@ftptech/x402-canton-express";
import type { PaymentRequirements } from "@ftptech/x402-canton-core";
import { authorizeSpend, type MandateCheckConfig } from "./mandate.js";

const PORT = Number(process.env.PORT ?? 3402);
const NETWORK = (process.env.NETWORK ?? "canton:mainnet") as PaymentRequirements["network"];
const FACILITATOR_URL = (process.env.FACILITATOR_URL ?? "https://facilitator.ftptech.xyz").replace(/\/$/, "");
const AMOUNT = process.env.X402_AMOUNT ?? "100000000"; // atomic units; 1 CC = 10^10

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name} — see .env.example`);
    process.exit(1);
  }
  return v;
}

const MERCHANT_PARTY = required("CANTON_X402_PAYTO");
const FACILITATOR_PARTY = required("CANTON_X402_FACILITATOR");
const DSO_PARTY = required("CANTON_X402_DSO");
const SYNCHRONIZER_ID = required("CANTON_SYNCHRONIZER_ID");
const EXECUTE_BEFORE_SECONDS = Number(process.env.EXECUTE_BEFORE_SECONDS ?? 120);

const mandateCfg: MandateCheckConfig = {
  ledgerApiUrl: required("LEDGER_API_URL").replace(/\/$/, ""),
  bearerToken: required("LEDGER_BEARER_TOKEN"),
  operatorParty: required("VANTON_OPERATOR_PARTY"),
  agentParty: required("VANTON_AGENT_PARTY"),
  packageId: process.env.VANTON_PACKAGE_ID ?? "vanton", // set after daml build/upload
};

// The 402 challenge for our demo service.
const statsRequirements: PaymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  amount: AMOUNT,
  asset: `${DSO_PARTY}::Amulet`,
  payTo: MERCHANT_PARTY,
  maxTimeoutSeconds: 120,
  extra: {
    assetTransferMethod: "transfer-factory",
    feePayer: FACILITATOR_PARTY,
    synchronizerId: SYNCHRONIZER_ID,
    instrumentId: { admin: DSO_PARTY, id: "Amulet" },
    executeBeforeSeconds: EXECUTE_BEFORE_SECONDS,
  },
};

const app = express();
app.use(express.json());

/**
 * GATE 1 — mandate check. Runs before the payment middleware. The agent presents
 * its mandate contract id and the spend amount; the ledger decides.
 */
app.use("/stats", async (req, res, next) => {
  const mandateCid = req.header("X-VANTON-MANDATE");
  if (!mandateCid) {
    return res.status(400).json({ error: "missing X-VANTON-MANDATE header" });
  }
  const result = await authorizeSpend(
    mandateCfg,
    mandateCid,
    MERCHANT_PARTY,
    "canton-stats",
    process.env.X402_AMOUNT_HUMAN ?? "0.01",
  );
  if (!result.ok) {
    // The ledger refused — the money shot. No payment is attempted.
    return res.status(403).json({ error: "mandate denied", reason: result.reason });
  }
  res.locals.authorizationCid = result.authorizationCid;
  next();
});

// GATE 2 — x402 payment. Only reached once the mandate authorized the spend.
app.use(
  cantonPaymentMiddleware({
    routes: {
      "GET /stats": {
        accepts: [statsRequirements],
        description: "Canton network stats (Scan-derived)",
        mimeType: "application/json",
      },
    },
    facilitatorUrl: FACILITATOR_URL,
  }),
);

// Paid handler — reached only after mandate + payment both pass.
app.get("/stats", (_req, res) => {
  // Demo payload; wire to the Scan API for real network metrics.
  res.json({
    service: "canton-stats",
    activeContracts: 128034,
    txLast24h: 41211,
    generatedAt: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[vanton-gateway] :${PORT}  facilitator=${FACILITATOR_URL}`);
  console.log(`  GET /stats   — mandate-gated + x402-paid`);
  console.log(`  GET /health  — free`);
});
