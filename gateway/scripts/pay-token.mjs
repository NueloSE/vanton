/**
 * Pay a registry-utility token (cBTC / cETH) from our party to a receiver, on the
 * shared devnet — the settlement primitive for cBTC/cETH per-call payments.
 *
 *   1. GET transfer-factory choice-context from the registry.
 *   2. Exercise TransferFactory_Transfer -> creates a TransferOffer (offer kind).
 *   3. Accept it as the receiver (we hold CanActAs on vanton-provider).
 *
 * Usage:  node scripts/pay-token.mjs CBTC 0.001
 *         node scripts/pay-token.mjs cETH 0.01
 */

import "dotenv/config";

const LEDGER = "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services:443";
const KEYCLOAK = "https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token";
const REG = "https://api.utilities.digitalasset-dev.com";
const ME = "ff34445b-43b1-4bde-b4a3-0e455ab0d3fa::122003aa7c491e00a453145c4d2cd3dbf5db8908b4e663c9944baed57fd66effa668";
const PROVIDER = "vanton-provider::122003aa7c491e00a453145c4d2cd3dbf5db8908b4e663c9944baed57fd66effa668";
const IF = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1";

const ADMINS = {
  CBTC: "cbtc-network::12202a83c6f4082217c175e29bc53da5f2703ba2675778ab99217a5a881a949203ff",
  cETH: "rails-cethMain-1-dev::12200b6de051e66bacd250de4bc76292e9d0ef71b478d7c11e49799b8e26f853493e",
};

const [, , ASSET = "CBTC", AMOUNT = "0.001"] = process.argv;
const ADMIN = ADMINS[ASSET];
if (!ADMIN) throw new Error(`unknown asset ${ASSET} (use CBTC or cETH)`);

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
const USER = JSON.parse(Buffer.from(TK.split(".")[1], "base64").toString()).sub;
const H = { "content-type": "application/json", authorization: `Bearer ${TK}` };

async function lj(path, body) {
  const r = await fetch(`${LEDGER}${path}`, { method: body ? "POST" : "GET", headers: H, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(d).slice(0, 500)}`);
  return d;
}
async function reg(path, body) {
  const r = await fetch(`${REG}/api/token-standard/v0/registrars/${encodeURIComponent(ADMIN)}/registry${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`registry ${path} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
const disc = (arr) => arr.map((d) => ({ templateId: d.templateId, contractId: d.contractId, createdEventBlob: d.createdEventBlob, synchronizerId: d.synchronizerId }));

async function activeCid(party, endsWith, admin) {
  const { offset } = await lj("/v2/state/ledger-end");
  const acs = await lj("/v2/state/active-contracts", {
    activeAtOffset: offset,
    filter: { filtersByParty: { [party]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } }, verbose: false,
  });
  for (const c of acs) {
    const ce = c?.contractEntry?.JsActiveContract?.createdEvent;
    if (!ce?.templateId?.endsWith(endsWith)) continue;
    const a = ce.createArgument;
    if (admin && (a?.instrument?.source ?? a?.transfer?.instrumentId?.admin) !== admin) continue;
    return ce.contractId;
  }
  return null;
}

// input holding cid for the asset
const holdingCid = await activeCid(ME, ":Holding", ADMIN);
if (!holdingCid) throw new Error(`no ${ASSET} holding to spend`);

// 1. transfer-factory
const now = new Date().toISOString();
const before = new Date(Date.now() + 3600e3).toISOString();
const transfer = {
  sender: ME, receiver: PROVIDER, amount: AMOUNT,
  instrumentId: { admin: ADMIN, id: ASSET },
  requestedAt: now, executeBefore: before, inputHoldingCids: [holdingCid], meta: { values: {} },
};
const factory = await reg("/transfer-instruction/v1/transfer-factory", {
  choiceArguments: { expectedAdmin: ADMIN, transfer, extraArgs: { context: { values: {} }, meta: { values: {} } } },
  excludeDebugFields: true,
});
console.log(`transfer-factory ok (kind=${factory.transferKind})`);

// 2. exercise TransferFactory_Transfer
await lj("/v2/commands/submit-and-wait-for-transaction", {
  commands: {
    userId: USER,
    commands: [{ ExerciseCommand: {
      templateId: `${IF}:TransferFactory`, contractId: factory.factoryId, choice: "TransferFactory_Transfer",
      choiceArgument: { expectedAdmin: ADMIN, transfer, extraArgs: { context: { values: factory.choiceContext.choiceContextData.values }, meta: { values: {} } } },
    } }],
    commandId: `vanton-pay-${Date.now()}`, actAs: [ME], readAs: [], disclosedContracts: disc(factory.choiceContext.disclosedContracts),
  },
});
console.log(`TransferFactory_Transfer ok — created offer to ${PROVIDER.slice(0, 20)}…`);

// 3. accept as the receiver (offer kind)
const offerCid = await activeCid(PROVIDER, "TransferOffer", ADMIN);
if (!offerCid) { console.log("no offer to accept (settled directly?)"); process.exit(0); }
const actx = await reg(`/transfer-instruction/v1/${offerCid}/choice-contexts/accept`, { meta: {} });
await lj("/v2/commands/submit-and-wait-for-transaction", {
  commands: {
    userId: USER,
    commands: [{ ExerciseCommand: {
      templateId: `${IF}:TransferInstruction`, contractId: offerCid, choice: "TransferInstruction_Accept",
      choiceArgument: { extraArgs: { context: { values: actx.choiceContextData.values }, meta: { values: {} } } },
    } }],
    commandId: `vanton-accept-${Date.now()}`, actAs: [PROVIDER], readAs: [], disclosedContracts: disc(actx.disclosedContracts),
  },
});
console.log(`${AMOUNT} ${ASSET} settled: ${ME.slice(0, 16)}… → vanton-provider`);
