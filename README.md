<p align="center">
  <img src="branding/logo.png" alt="Vanton" width="520" />
</p>

<h1 align="center">Vanton — the agent-payment marketplace on Canton</h1>

**AI agents are becoming the fastest-growing API customers, but they can't pay for anything — no card, no account, no subscription.** Vanton is a Canton-native marketplace and payment layer where agents discover services and pay per call in **CC, cBTC, and cETH** over Canton's x402 rails, with spending limits **enforced directly by the ledger**.

Built for HackCanton Season 2 · Tracks: Financial Applications + Open · Challenges: **cBTC** & **cETH** Ecosystem Challenges.

---

## Why this matters

- **For providers** — monetize machine traffic with one line of middleware. No billing stack, no per-customer accounts.
- **For agent owners** — give a bot a wallet without giving it a blank check. The budget is a Canton contract; the ledger rejects any spend beyond it.
- **Only on Canton** — every x402 micropayment on Base or Solana is public. On Canton, billing records are visible only to payer and provider. Confidential usage-based commerce is structurally impossible on transparent chains.

## How it works

```
AI agent ── GET /stats ─────────────────▶ Vanton gateway
                                          │  GATE 1: exercise Mandate_Authorize on-ledger
                                          │          (budget · per-call cap · expiry)
                                          │          fail ⇒ 403, no charge  ← the ledger says no
                                          │  GATE 2: 402 challenge → agent pays CC on Canton
                                          │          gateway verifies the transfer in its wallet
AI agent ◀── 200 + data ─────────────────┘          one real transaction on Canton per call
```

Three pieces:
1. **Marketplace ("the shop")** — providers list endpoints priced per call; agents discover them.
2. **Gateway ("the checkout")** — 402 paywall; agent pays CC on Canton; gateway verifies on-ledger.
3. **Mandates ("the allowance")** — DAML spend allowances the ledger enforces; an agent *cannot* overspend.

The **agent is a real LLM** (`agent/src/ai-agent.ts`): given a task, it reads the marketplace, decides which services to buy, pays for them on Canton, and answers — and when it hits its on-chain budget, the ledger stops it mid-task.

## Repo layout

| Path | What |
|---|---|
| `daml/` | The `vanton` DAML package — listings, mandates, authorizations, private receipts |
| `daml/daml/Vanton/Marketplace.daml` | Core templates (the enforcement lives in `Mandate_Authorize`) |
| `daml-tests/` | Daml Script running the three demo beats (`daml test`) |
| `gateway/` | 402 paywall + real CC settlement + **on-ledger mandate gate** + marketplace API |
| `agent/` | **AI agent** (LLM buys paid services under a ledger-enforced budget) + validator-API client |
| `marketplace/` | Next.js UI — listings, live settlement feed, list-a-service, Connect Wallet |
| `docs/` | (private workspace) hackathon intel, tech reference, build plan |

## cBTC & cETH integration (challenge requirement)

Vanton settles agent payments in Canton's wrapped assets, and **each settlement is a real ledger state change** — not a balance display.

- **Settlement method:** x402 scheme `exact`, method `transfer-factory`, on the **CIP-56 Canton Token Standard** — the same standard cBTC (BitSafe) and cETH (onRails) implement. A paid call is a `TransferFactory_Transfer` settling the listing's price to the provider.
- **CC (today):** settles through the hosted FTP facilitator, working now.
- **cBTC / cETH (in progress):** same `transfer-factory` path against each asset's CIP-56 instrument id, via a facilitator configured for those instruments. Fallback if needed: a DAML escrow-tab draw-down where each call debits a pre-funded cBTC/cETH tab — still a real on-ledger state change per call, satisfying the cETH gate.
- **cETH state change:** every authorized call consumes a `SpendAuthorization` and settles the transfer — cETH is a live dependency of the flow, never a passive balance.

Test assets: cBTC faucet (`cbtc-faucet.bitsafe.finance`), cETH devnet form (see `docs/01-hackathon-intel.md`).

## Status

| Component | State |
|---|---|
| AI agent (LLM discovers, decides, pays) | ✅ working — buys services autonomously under budget |
| Real CC settlement on Canton devnet | ✅ working — one real transaction per paid call |
| Ledger-enforced spend cap (the "money shot") | ✅ **live** — agent cut off by the ledger at its budget |
| canton-stats real data | ✅ live network round + ledger offset |
| Marketplace UI (listings, live feed, list-a-service, connect wallet) | ✅ working |
| Privacy (outsider sees nothing) | ✅ asserted in `daml test` |
| cBTC/cETH settlement | Designed (same CIP-56 path); CC proven |

## Run

Prereqs: Daml SDK 3.4.11 (`daml version` — matches the Canton 3.5.x devnet node),
a JDK 17 (the script engine needs a JVM — `export JAVA_HOME=...` if `daml test`
reports no Java runtime), Node 20+.

The DAML is split in two packages so the deployable DAR stays lean (no
daml-script bloat on the shared participant): `daml/` = templates only,
`daml-tests/` = the demo script.

```bash
# 1. DAML: compile templates, run the demo script (the 3 beats)
cd daml && daml build          # -> .daml/dist/vanton-0.1.0.dar (deployable)
cd ../daml-tests && daml test  # "ok, 5 active contracts, 9 transactions."

# 2. Local Canton hosting the mandate (live ledger enforcement)
cd ../daml
daml sandbox --dar .daml/dist/vanton-0.1.0.dar --json-api-port 7575 &
node ../gateway/scripts/setup-local-mandate.mjs   # prints the mandate env

# 3. Gateway (paywall + real CC settlement + mandate gate)
cd ../gateway && npm install
cp .env.example .env   # fill CANTON_USERNAME/PASSWORD + paste the mandate env from step 2
npm run dev            # :3402

# 4. Marketplace UI
cd ../marketplace && npm install && npm run dev   # :3400

# 5. Turn the AI agent loose (needs OPENAI_API_KEY in agent/.env)
cd ../agent && npm install
npx tsx src/ai-agent.ts "Poll the Canton network status four times and tell me if the ledger offset increased."
# → the agent buys 3 readings (real CC), then the ledger refuses the 4th (budget exhausted).
```

## Docs

- `docs/01-hackathon-intel.md` — deadlines, gates, rubrics, prior art
- `docs/02-canton-tech-reference.md` — Canton/DAML + x402 stack reference
- `docs/03-build-plan.md` — architecture, day-by-day, scope-cut ladder
- `docs/04-pivot-comms.md` — pitch, demo narrative, materials

## License

Apache-2.0.
