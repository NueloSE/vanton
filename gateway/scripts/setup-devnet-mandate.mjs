/**
 * Create the AgentMandate on the SHARED hackcanton devnet node.
 *
 * Uses the parties [NODERS] pre-allocated (vanton-owner/agent/operator) — our
 * user has CanActAs on them — and authenticates with the OIDC token. This puts
 * mandate enforcement on the same ledger where CC settles: one real ledger.
 *
 * Run from the gateway dir (needs its .env + node_modules):
 *   cd gateway && node scripts/setup-devnet-mandate.mjs
 */

import "dotenv/config";

const LEDGER = "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services:443";
const KEYCLOAK = "https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token";
const PKG = "322deec212e394ac80e87c3d69503d76eb4d01311fe1168d57e3e17e12a56b5f";
const NS = "122003aa7c491e00a453145c4d2cd3dbf5db8908b4e663c9944baed57fd66effa668";
const P = (name) => `vanton-${name}::${NS}`;

const BUDGET = process.env.BUDGET_CC ?? "0.05";
const PER_CALL = process.env.PER_CALL_CC ?? "0.02";

async function token() {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "web-app-ui-hackcanton-01-devnet",
    username: process.env.CANTON_USERNAME,
    password: process.env.CANTON_PASSWORD,
    scope: "openid daml_ledger_api offline_access",
  });
  const r = await fetch(KEYCLOAK, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return (await r.json()).access_token;
}

const TK = await token();
const H = { "content-type": "application/json", authorization: `Bearer ${TK}` };
// The ledger checks rights for the token's user; the command userId must match it.
const USER_ID = JSON.parse(Buffer.from(TK.split(".")[1], "base64").toString()).sub;
console.error(`acting as ledger user: ${USER_ID}`);

async function j(path, init) {
  const r = await fetch(`${LEDGER}${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}

async function submit(actAs, command) {
  return j("/v2/commands/submit-and-wait-for-transaction", {
    method: "POST",
    body: JSON.stringify({
      commands: { userId: USER_ID, commands: [command], commandId: `setup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, actAs: [actAs], readAs: [] },
    }),
  });
}

async function activeCid(party, endsWith) {
  const { offset } = await j("/v2/state/ledger-end");
  const acs = await j("/v2/state/active-contracts", {
    method: "POST",
    body: JSON.stringify({ activeAtOffset: offset, filter: { filtersByParty: { [party]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } }, verbose: false }),
  });
  for (const c of acs) {
    const ce = c?.contractEntry?.JsActiveContract?.createdEvent;
    if (ce?.templateId?.endsWith(endsWith)) return ce.contractId;
  }
  return null;
}

const validUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
await submit(P("owner"), {
  CreateCommand: {
    templateId: `${PKG}:Vanton.Marketplace:MandateProposal`,
    createArguments: { operator: P("operator"), owner: P("owner"), agent: P("agent"), budgetTotal: BUDGET, perCallCap: PER_CALL, asset: "CC", validUntil },
  },
});
const proposal = await activeCid(P("owner"), ":MandateProposal");
if (!proposal) throw new Error("proposal not found");
await submit(P("agent"), {
  ExerciseCommand: { templateId: `${PKG}:Vanton.Marketplace:MandateProposal`, contractId: proposal, choice: "MandateProposal_Accept", choiceArgument: {} },
});
const mandate = await activeCid(P("agent"), ":AgentMandate");
if (!mandate) throw new Error("mandate not found");

console.error(`AgentMandate on SHARED devnet — budget ${BUDGET} CC, per-call ${PER_CALL} CC\n`);
console.log(`VANTON_PACKAGE_ID=${PKG}`);
console.log(`LOCAL_LEDGER_API_URL=${LEDGER}`);
console.log(`MANDATE_AUTH=true`);
console.log(`VANTON_OPERATOR_PARTY=${P("operator")}`);
console.log(`VANTON_AGENT_PARTY=${P("agent")}`);
console.log(`VANTON_MANDATE_CID=${mandate}`);
