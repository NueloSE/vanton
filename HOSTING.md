# Hosting Vanton (so anyone can test it in a browser)

Two services: the **gateway** (backend, holds the wallet creds + runs the agent)
and the **marketplace UI** (frontend). Testers just open the UI and click
**Run the AI agent** — no wallet or funds needed from them; the hosted backend
pays from the pre-funded wallet and they watch settlements land.

## 1. Gateway → Railway / Render / Fly (Docker)

The repo root has a `Dockerfile` that runs the gateway and bundles the agent (for
the Run-agent button). Deploy it and set these env vars in the platform:

```
CANTON_USERNAME=<devnet wallet email>
CANTON_PASSWORD=<devnet wallet password>
CANTON_X402_PAYTO=ff34445b-...::122003aa...        # CC payee (your party)
CANTON_X402_FACILITATOR, CANTON_X402_DSO, CANTON_SYNCHRONIZER_ID   # from x402 setup (optional)
OPENAI_API_KEY=<key>                               # the agent's brain
# On-ledger mandate (from: node gateway/scripts/setup-devnet-mandate.mjs):
VANTON_PACKAGE_ID=322deec2...
LOCAL_LEDGER_API_URL=https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services:443
MANDATE_AUTH=true
VANTON_OPERATOR_PARTY=vanton-operator::122003aa...
VANTON_AGENT_PARTY=vanton-agent::122003aa...
```

Expose port `3402`. Note the public URL (e.g. `https://vanton-gateway.up.railway.app`).

## 2. UI → Vercel

Root directory: `marketplace`. Set one env var:

```
NEXT_PUBLIC_GATEWAY_URL=https://<your-gateway-url>
```

Deploy. That URL is what you give the organizers.

## 3. Keep it topped up

- The demo mandates are small so testers can see the ledger cut-off. Re-run
  `node gateway/scripts/setup-devnet-mandate.mjs` (or add a small admin button)
  to refill the budgets between heavy testing.
- Balances: ~81k CC, ~1 cBTC (1000 calls), ~1.5 cETH (150 calls) — plenty.

## Notes

- Listed services proxy to the provider's API URL, so when testers list a
  service they should use a **public** URL (or the built-in `/free-sample`).
- The "Run agent" button spawns the agent in-container; the agent's creds come
  from the gateway's env (above).
