/**
 * cBTC / cETH settlement for the agent (DA Registry Utility token-standard).
 *
 * Pays a registry token from our party to the provider and returns the
 * on-ledger update id of the settlement, which the gateway verifies. Flow:
 * GET transfer-factory choice-context → exercise TransferFactory_Transfer
 * (creates an offer) → accept it as the provider (we hold CanActAs).
 *
 * CC uses a different, simpler rail (validator API) — see canton.ts. This module
 * is the wrapped-asset rail that makes Vanton eligible for the cBTC/cETH tracks.
 */

import { getAccessToken } from "./canton.js";

const LEDGER = "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services:443";
const REG = "https://api.utilities.digitalasset-dev.com";
const IF = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1";

// instrument admin (registrar) per asset on devnet
export const TOKEN_ADMINS: Record<string, string> = {
  cBTC: "cbtc-network::12202a83c6f4082217c175e29bc53da5f2703ba2675778ab99217a5a881a949203ff",
  cETH: "rails-cethMain-1-dev::12200b6de051e66bacd250de4bc76292e9d0ef71b478d7c11e49799b8e26f853493e",
};
// on-ledger instrument id string ("CBTC" / "cETH")
const INSTRUMENT_ID: Record<string, string> = { cBTC: "CBTC", cETH: "cETH" };

interface Disclosed { templateId: string; contractId: string; createdEventBlob: string; synchronizerId: string }

async function auth() {
  const t = await getAccessToken();
  return { header: { "content-type": "application/json", authorization: `Bearer ${t}` }, user: userIdFrom(t) };
}
function userIdFrom(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).sub as string;
}
const disc = (a: any[]): Disclosed[] =>
  a.map((d) => ({ templateId: d.templateId, contractId: d.contractId, createdEventBlob: d.createdEventBlob, synchronizerId: d.synchronizerId }));

async function lj(header: Record<string, string>, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${LEDGER}${path}`, { method: body ? "POST" : "GET", headers: header, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}
async function reg(admin: string, path: string, body: unknown): Promise<any> {
  const r = await fetch(`${REG}/api/token-standard/v0/registrars/${encodeURIComponent(admin)}/registry${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`registry ${path} -> ${r.status}`);
  return r.json();
}

async function myHolding(header: Record<string, string>, me: string, admin: string): Promise<string> {
  const { offset } = await lj(header, "/v2/state/ledger-end");
  const acs = await lj(header, "/v2/state/active-contracts", {
    activeAtOffset: offset,
    filter: { filtersByParty: { [me]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } }, verbose: false,
  });
  for (const c of acs) {
    const ce = c?.contractEntry?.JsActiveContract?.createdEvent;
    const a = ce?.createArgument;
    if (ce?.templateId?.endsWith(":Holding") && a?.owner === me && a?.instrument?.source === admin) return ce.contractId;
  }
  throw new Error("no holding to spend for this asset");
}
async function offerToProvider(header: Record<string, string>, provider: string, admin: string): Promise<string | null> {
  const { offset } = await lj(header, "/v2/state/ledger-end");
  const acs = await lj(header, "/v2/state/active-contracts", {
    activeAtOffset: offset,
    filter: { filtersByParty: { [provider]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } }, verbose: false,
  });
  for (const c of acs) {
    const ce = c?.contractEntry?.JsActiveContract?.createdEvent;
    if (ce?.templateId?.includes("TransferOffer") && ce?.createArgument?.transfer?.instrumentId?.admin === admin) return ce.contractId;
  }
  return null;
}

/** Pay `amount` of a wrapped asset from `me` to `provider`. Returns the settlement update id. */
export async function payToken(asset: string, amount: string, me: string, provider: string): Promise<string> {
  const admin = TOKEN_ADMINS[asset];
  const id = INSTRUMENT_ID[asset];
  if (!admin) throw new Error(`unknown asset ${asset}`);
  const { header, user } = await auth();
  const holdingCid = await myHolding(header, me, admin);

  const transfer = {
    sender: me, receiver: provider, amount,
    instrumentId: { admin, id },
    requestedAt: new Date().toISOString(), executeBefore: new Date(Date.now() + 3600e3).toISOString(),
    inputHoldingCids: [holdingCid], meta: { values: {} },
  };
  const factory = await reg(admin, "/transfer-instruction/v1/transfer-factory", {
    choiceArguments: { expectedAdmin: admin, transfer, extraArgs: { context: { values: {} }, meta: { values: {} } } },
    excludeDebugFields: true,
  });
  const tx = await lj(header, "/v2/commands/submit-and-wait-for-transaction", {
    commands: {
      userId: user,
      commands: [{ ExerciseCommand: {
        templateId: `${IF}:TransferFactory`, contractId: factory.factoryId, choice: "TransferFactory_Transfer",
        choiceArgument: { expectedAdmin: admin, transfer, extraArgs: { context: { values: factory.choiceContext.choiceContextData.values }, meta: { values: {} } } },
      } }],
      commandId: `vanton-pay-${Date.now()}`, actAs: [me], readAs: [], disclosedContracts: disc(factory.choiceContext.disclosedContracts),
    },
  });
  const updateId: string = tx.transaction?.updateId ?? "";

  // offer kind: accept as the provider so the funds land
  const offerCid = await offerToProvider(header, provider, admin);
  if (offerCid) {
    const actx = await reg(admin, `/transfer-instruction/v1/${offerCid}/choice-contexts/accept`, { meta: {} });
    await lj(header, "/v2/commands/submit-and-wait-for-transaction", {
      commands: {
        userId: user,
        commands: [{ ExerciseCommand: {
          templateId: `${IF}:TransferInstruction`, contractId: offerCid, choice: "TransferInstruction_Accept",
          choiceArgument: { extraArgs: { context: { values: actx.choiceContextData.values }, meta: { values: {} } } },
        } }],
        commandId: `vanton-accept-${Date.now()}`, actAs: [provider], readAs: [], disclosedContracts: disc(actx.disclosedContracts),
      },
    });
  }
  return updateId;
}
