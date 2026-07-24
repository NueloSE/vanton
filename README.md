# Vanton — the agent-payment marketplace on Canton

**AI agents are becoming the fastest-growing API customers, but they can't pay for anything — no card, no account, no subscription.** Vanton is a Canton-native marketplace and payment layer where agents discover services and pay per call in **CC, cBTC, and cETH** over Canton's x402 rails, with spending limits **enforced directly by the ledger**.

Built for HackCanton Season 2 · Tracks: Financial Applications + Open · Challenges: **cBTC** & **cETH** Ecosystem Challenges.

---

## Why this matters

- **For providers** — monetize machine traffic with one line of middleware. No billing stack, no per-customer accounts.
- **For agent owners** — give a bot a wallet without giving it a blank check. The budget is a Canton contract; the ledger rejects any spend beyond it.
- **Only on Canton** — every x402 micropayment on Base or Solana is public. On Canton, billing records are visible only to payer and provider. Confidential usage-based commerce is structurally impossible on transparent chains.

## How it works

```
agent ── GET /stats + X-VANTON-MANDATE ─▶ Vanton gateway
                                          │  GATE 1: exercise Mandate_Authorize on-ledger
                                          │          (budget · per-call cap · expiry)
                                          │          fail ⇒ 403, no charge
                                          │  GATE 2: x402 402 challenge → facilitator /verify + /settle
agent ◀── 200 + data + receipt ──────────┘          one transaction on Canton
```

Three pieces:
1. **Marketplace ("the shop")** — providers list endpoints priced per call; agents discover them.
2. **Gateway + SDK ("the checkout")** — provider middleware + agent autopay on HTTP 402.
3. **Mandates ("the allowance")** — DAML spend allowances the ledger enforces.

## Repo layout

| Path | What |
|---|---|
| `daml/` | The `vanton` DAML package — listings, mandates, authorizations, private receipts |
| `daml/daml/Vanton/Marketplace.daml` | Core templates (the enforcement lives in `Mandate_Authorize`) |
| `daml/daml/Vanton/Tests.daml` | Daml Script running the three demo beats |
| `gateway/` | Provider-side: x402 payment gate + on-ledger mandate gate |
| `agent/` | Demo agent autopay loop *(in progress)* |
| `marketplace/` | Browse UI + live volume dashboard *(in progress)* |
| `docs/` | Hackathon intel, Canton tech reference, build plan, comms |

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
| DAML package (listings, mandates, receipts) | Written; `daml test` covers the 3 beats |
| Ledger-enforced spend cap (the "money shot") | Implemented in `Mandate_Authorize` + scripted in `Tests.daml` |
| Privacy (outsider sees nothing) | Asserted in `Tests.daml` |
| x402 CC settlement | Wired to FTP facilitator; devnet run in progress |
| cBTC/cETH settlement | In progress (see above) |
| Marketplace UI + dashboard | In progress |

## Run

Prereqs: Daml SDK (`daml version`), Node 20+.

```bash
# 1. DAML: compile + run the demo script
cd daml
daml test            # runs Vanton.Tests:setup — expect all three beats to pass

# 2. Gateway: install, configure, run
cd ../gateway
npm install
cp .env.example .env  # fill parties/ids from your devnet wallet (docs §2)
npm run dev
```

## Docs

- `docs/01-hackathon-intel.md` — deadlines, gates, rubrics, prior art
- `docs/02-canton-tech-reference.md` — Canton/DAML + x402 stack reference
- `docs/03-build-plan.md` — architecture, day-by-day, scope-cut ladder
- `docs/04-pivot-comms.md` — pitch, demo narrative, materials

## License

Apache-2.0.
