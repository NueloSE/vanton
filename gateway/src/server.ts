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
import { spawn } from "node:child_process";
import path from "node:path";
import express, { type Response } from "express";
import { authorizeSpend, type MandateCheckConfig } from "./mandate.js";
import { issueCharge, verifyCharge, activityFeed } from "./devnet-pay.js";
import { issueTokenCharge, verifyTokenCharge, tokenActivity } from "./token-verify.js";
import { cantonStats } from "./canton-data.js";
import { btcPrice, ethSignal } from "./prices.js";
import { loadUserListings, saveUserListings } from "./listings-store.js";
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

// The provider party that receives wrapped-asset payments (cBTC/cETH).
const PROVIDER_PARTY =
  process.env.VANTON_PROVIDER_PARTY ??
  "vanton-provider::122003aa7c491e00a453145c4d2cd3dbf5db8908b4e663c9944baed57fd66effa668";

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
  {
    id: "eth-signal",
    name: "ETH Signal (premium)",
    provider: PROVIDER_PARTY,
    priceAmount: process.env.PRICE_CETH ?? "0.01",
    priceAsset: "cETH",
    category: "signals",
    endpoint: "/eth-signal",
    description: "A signed ETH momentum signal, settled in cETH per call.",
  },
  {
    id: "btc-price",
    name: "BTC Price Oracle",
    provider: PROVIDER_PARTY,
    priceAmount: process.env.PRICE_CBTC ?? "0.001",
    priceAsset: "cBTC",
    category: "oracle",
    endpoint: "/btc-price",
    description: "A signed BTC/USD price, settled in cBTC per call.",
  },
];

// Wrapped-asset services: (endpoint, asset, price, response). Both settle in a
// registry token to PROVIDER_PARTY via the same verify path.
const TOKEN_SERVICES: Record<string, { asset: "cBTC" | "cETH"; price: string; body: () => Promise<object> }> = {
  "/eth-signal": { asset: "cETH", price: process.env.PRICE_CETH ?? "0.01", body: ethSignal },
  "/btc-price": { asset: "cBTC", price: process.env.PRICE_CBTC ?? "0.001", body: btcPrice },
};

// On-ledger mandate config (one AgentMandate per asset) + a shared enforcement
// helper used by every paid gate, so the ledger caps CC, cBTC and cETH alike.
const mandateEnabled = Boolean(process.env.VANTON_PACKAGE_ID);
const mandateCfg: MandateCheckConfig | null = mandateEnabled
  ? {
      ledgerApiUrl: requireEnv("LOCAL_LEDGER_API_URL").replace(/\/$/, ""),
      operatorParty: requireEnv("VANTON_OPERATOR_PARTY"),
      agentParty: requireEnv("VANTON_AGENT_PARTY"),
      packageId: process.env.VANTON_PACKAGE_ID!,
      getToken: process.env.MANDATE_AUTH === "true" ? getAccessToken : undefined,
    }
  : null;

/** Authorize a spend against the per-asset mandate. Returns true if allowed (or
 *  no mandate configured); otherwise responds 403 and returns false. */
async function enforceMandate(res: Response, asset: string, service: string, price: string): Promise<boolean> {
  if (!mandateCfg) return true;
  const auth = await authorizeSpend(mandateCfg, service, price, asset);
  if (!auth.ok) {
    console.log(`[gateway] mandate DENIED (${asset}): ${auth.reason} (budget left ${auth.remaining})`);
    res.status(403).json({ error: "mandate denied", reason: auth.reason, asset, budgetRemaining: auth.remaining });
    return false;
  }
  console.log(`[gateway] mandate authorized (${asset}) · budget left ${auth.remaining}`);
  return true;
}

app.get("/listings", (_req, res) => res.json({ listings }));

// A provider lists a service. In production this is a ServiceListingProposal on
// the ledger (signed with the provider's Console Wallet) that the operator
// accepts; here it registers the listing the marketplace shows and the gateway
// meters. The provider party is the payee for that service.
// user-listed services: id -> the provider's real API URL the gateway proxies to
const targets = new Map<string, string>();
const DEMO_IDS = new Set(["canton-stats", "eth-signal", "btc-price"]);

// restore user-listed services from disk (demo listings are always seeded above)
{
  const persisted = loadUserListings();
  for (const l of persisted.listings) if (!listings.some((x) => x.id === l.id)) listings.push(l);
  for (const [id, url] of persisted.targets) targets.set(id, url);
  if (persisted.listings.length) console.log(`[gateway] restored ${persisted.listings.length} user listing(s)`);
}

app.post("/listings", (req, res) => {
  const { name, provider, priceAmount, priceAsset, category, targetUrl, description } =
    req.body ?? {};
  if (!name || !provider || !priceAmount) {
    return res.status(400).json({ error: "name, provider and priceAmount are required" });
  }
  if (Number.isNaN(Number(priceAmount)) || Number(priceAmount) <= 0) {
    return res.status(400).json({ error: "priceAmount must be a positive number" });
  }
  if (!targetUrl || !/^https?:\/\//.test(String(targetUrl))) {
    return res.status(400).json({ error: "targetUrl must be an http(s) URL to your API" });
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
    endpoint: `/svc/${id}`, // the gateway gates this path and proxies to targetUrl
    description: String(description || ""),
  };
  targets.set(id, String(targetUrl));
  listings.unshift(listing);
  saveUserListings(listings.filter((l) => !DEMO_IDS.has(l.id)), targets);
  console.log(`[gateway] listed "${listing.name}" @ ${listing.priceAmount} ${listing.priceAsset} by ${listing.provider.slice(0, 24)}… -> ${targetUrl}`);
  res.status(201).json({ listing });
});

// Generic gated proxy: ANY listed service is buyable. Pay in the listing's asset
// to its provider, then the gateway proxies the call to the provider's API.
app.get("/svc/:id", async (req, res) => {
  const listing = listings.find((l) => l.id === req.params.id);
  const target = targets.get(req.params.id);
  if (!listing || !target) return res.status(404).json({ error: "no such service" });
  const isToken = listing.priceAsset === "cBTC" || listing.priceAsset === "cETH";
  const ref = req.header("x-vanton-payment");

  if (!ref) {
    if (!(await enforceMandate(res, listing.priceAsset, listing.id, listing.priceAmount))) return;
    const charge = isToken
      ? await issueTokenCharge(listing.id, listing.priceAsset as "cBTC" | "cETH", listing.priceAmount, listing.provider)
      : issueCharge(listing.id, listing.priceAmount);
    return res.status(402).json({
      price: listing.priceAmount,
      payTo: isToken ? listing.provider : MERCHANT_PARTY,
      asset: listing.priceAsset,
      reference: charge.reference,
    });
  }
  let paid = false;
  for (let i = 0; i < 6 && !paid; i++) {
    paid = Boolean(isToken ? await verifyTokenCharge(ref) : await verifyCharge(ref));
    if (!paid) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!paid) return res.status(402).json({ error: "payment not found on-ledger", reference: ref });

  // Paid — proxy to the provider's API and return its response.
  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(10_000) });
    const body = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get("content-type") ?? "application/json").send(body);
  } catch (e) {
    res.status(502).json({ error: "provider API unreachable", detail: (e as Error).message });
  }
});

app.get("/activity", (_req, res) => {
  // Merge CC settlements + wrapped-asset settlements, newest first.
  const cc = activityFeed().map((s) => ({ ...s, asset: "CC" }));
  const tok = tokenActivity().map((s) => ({ reference: s.reference, price: s.price, service: s.service, settledAt: s.settledAt, eventId: "token-transfer", sender: "agent", asset: s.asset }));
  const activity = [...cc, ...tok].sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));
  res.json({ activity });
});

// A free sample provider API — point a test listing's "Your API URL" at this to
// try the full list-a-service → agent-buys flow without hosting your own API.
app.get("/free-sample", (_req, res) =>
  res.json({ sample: "hello from a provider API", value: Math.round(Math.random() * 1000), ts: new Date().toISOString() }),
);

// Run the AI agent server-side for a given task — powers the UI "Run agent"
// button so anyone can trigger a full demo with one click (no terminal). The
// agent runs in its own package dir (its .env holds the OpenAI + wallet creds).
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
app.post("/run-agent", (req, res) => {
  const task = String(req.body?.task || "Get me the current BTC price from the oracle.").slice(0, 300);
  const agentDir = path.join(process.cwd(), "..", "agent");
  const proc = spawn("npx", ["tsx", "src/ai-agent.ts", task], { cwd: agentDir });
  let out = "";
  const cap = (d: Buffer) => {
    out += d.toString();
    if (out.length > 20_000) out = out.slice(-20_000);
  };
  proc.stdout.on("data", cap);
  proc.stderr.on("data", cap);
  const timer = setTimeout(() => proc.kill(), 150_000);
  proc.on("error", (e) => { clearTimeout(timer); if (!res.headersSent) res.status(500).json({ ok: false, output: e.message }); });
  proc.on("close", (code) => { clearTimeout(timer); if (!res.headersSent) res.json({ ok: code === 0, output: stripAnsi(out).trim() }); });
});

// Wrapped-asset paid services (cBTC / cETH). Each settles in a registry token to
// PROVIDER_PARTY: the initial request issues a token 402; the retry verifies the
// provider actually received the asset (balance check) before serving. Same shape
// as the CC /stats path, just a different settlement rail.
for (const [path, svc] of Object.entries(TOKEN_SERVICES)) {
  const service = path.slice(1);
  app.use(path, async (req, res, next) => {
    const ref = req.header("x-vanton-payment");
    if (!ref) {
      if (!(await enforceMandate(res, svc.asset, service, svc.price))) return;
      const charge = await issueTokenCharge(service, svc.asset, svc.price, PROVIDER_PARTY);
      return res.status(402).json({ price: charge.price, payTo: PROVIDER_PARTY, asset: svc.asset, reference: charge.reference });
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const s = await verifyTokenCharge(ref);
      if (s) {
        console.log(`[gateway] verified ${s.price} ${svc.asset} for ${service} (${ref})`);
        return next();
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return res.status(402).json({ error: `${svc.asset} payment not found on-ledger`, reference: ref });
  });
  app.get(path, async (_req, res) => res.json({ ...(await svc.body()), generatedAt: new Date().toISOString() }));
}
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

if (PAY_MODE !== "devnet") {
  console.error("[gateway] PAY_MODE=x402 (mainnet facilitator) is the post-hackathon rail; use devnet");
  process.exit(1);
}

app.use("/stats", async (req, res, next) => {
  const ref = req.header("x-vanton-payment");

  if (!ref) {
    // Initial request: enforce the on-ledger mandate BEFORE offering to charge.
    if (!(await enforceMandate(res, "CC", "canton-stats", PRICE_CC))) return;
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
