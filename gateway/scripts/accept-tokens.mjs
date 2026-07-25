/**
 * Accept all pending registry-utility token transfers (cBTC, cETH) on the shared
 * devnet, so they land as spendable Holdings.
 *
 * Flow per offer (Canton Token Standard / DA Registry Utility):
 *   1. fetch the accept choice-context from the registry
 *      POST {registry}/api/token-standard/v0/registrars/{admin}/registry/
 *           transfer-instruction/v1/{cid}/choice-contexts/accept
 *   2. exercise TransferInstruction_Accept on the offer with the context + disclosed contracts
 *
 * Run:  cd gateway && node scripts/accept-tokens.mjs
 */

import "dotenv/config";

const LEDGER = "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services:443";
const KEYCLOAK = "https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token";
const REG = "https://api.utilities.digitalasset-dev.com";
const ME = "ff34445b-43b1-4bde-b4a3-0e455ab0d3fa::122003aa7c491e00a453145c4d2cd3dbf5db8908b4e663c9944baed57fd66effa668";
const IFACE = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction";

async function token() {
  const body = new URLSearchParams({
    grant_type: "password", client_id: "web-app-ui-hackcanton-01-devnet",
    username: process.env.CANTON_USERNAME, password: process.env.CANTON_PASSWORD,
    scope: "openid daml_ledger_api offline_access",
  });
  const r = await fetch(KEYCLOAK, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  return (await r.json()).access_token;
}

const TK = await token();
const USER_ID = JSON.parse(Buffer.from(TK.split(".")[1], "base64").toString()).sub;
const H = { "content-type": "application/json", authorization: `Bearer ${TK}` };

async function lj(path, body) {
  const r = await fetch(`${LEDGER}${path}`, { method: body ? "POST" : "GET", headers: H, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(d).slice(0, 400)}`);
  return d;
}

async function pendingOffers() {
  const { offset } = await lj("/v2/state/ledger-end");
  const acs = await lj("/v2/state/active-contracts", {
    activeAtOffset: offset,
    filter: { filtersByParty: { [ME]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } },
    verbose: false,
  });
  const offers = [];
  for (const c of acs) {
    const ce = c?.contractEntry?.JsActiveContract?.createdEvent;
    if (ce?.templateId?.includes("TransferOffer")) {
      const iid = ce.createArgument.transfer.instrumentId;
      offers.push({ id: iid.id, admin: iid.admin, amount: ce.createArgument.transfer.amount, cid: ce.contractId });
    }
  }
  return offers;
}

async function acceptContext(admin, cid) {
  const enc = encodeURIComponent(admin);
  const r = await fetch(`${REG}/api/token-standard/v0/registrars/${enc}/registry/transfer-instruction/v1/${cid}/choice-contexts/accept`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meta: {} }),
  });
  if (!r.ok) throw new Error(`choice-context ${r.status} ${await r.text()}`);
  return r.json();
}

async function accept(offer) {
  const ctx = await acceptContext(offer.admin, offer.cid);
  const disclosed = ctx.disclosedContracts.map((d) => ({
    templateId: d.templateId, contractId: d.contractId, createdEventBlob: d.createdEventBlob, synchronizerId: d.synchronizerId,
  }));
  await lj("/v2/commands/submit-and-wait-for-transaction", {
    commands: {
      userId: USER_ID,
      commands: [{
        ExerciseCommand: {
          templateId: IFACE,
          contractId: offer.cid,
          choice: "TransferInstruction_Accept",
          choiceArgument: { extraArgs: { context: { values: ctx.choiceContextData.values }, meta: { values: {} } } },
        },
      }],
      commandId: `vanton-accept-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      actAs: [ME], readAs: [],
      disclosedContracts: disclosed,
    },
  });
}

const offers = await pendingOffers();
if (!offers.length) { console.log("no pending token transfers"); process.exit(0); }
for (const o of offers) {
  process.stdout.write(`accepting ${o.amount} ${o.id} … `);
  try { await accept(o); console.log("✓"); }
  catch (e) { console.log("✗\n  " + (e.message || e)); }
}
