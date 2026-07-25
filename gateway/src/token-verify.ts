/**
 * Verification for cBTC / cETH payments.
 *
 * CC is verified by scanning the merchant wallet history (devnet-pay.ts). Wrapped
 * assets settle as registry Holdings on the provider party, so we verify by
 * snapshotting the provider's balance of the asset when the charge is issued and
 * confirming it rose by the price after the agent pays. Real, on-ledger, no trust
 * in the agent's claim.
 */

import crypto from "node:crypto";
import { getAccessToken } from "./auth.js";

const LEDGER = "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services:443";

const TOKEN_ADMIN: Record<string, string> = {
  cBTC: "cbtc-network::12202a83c6f4082217c175e29bc53da5f2703ba2675778ab99217a5a881a949203ff",
  cETH: "rails-cethMain-1-dev::12200b6de051e66bacd250de4bc76292e9d0ef71b478d7c11e49799b8e26f853493e",
};

async function providerBalance(asset: string, provider: string): Promise<number> {
  const admin = TOKEN_ADMIN[asset];
  const token = await getAccessToken();
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const endRes = await fetch(`${LEDGER}/v2/state/ledger-end`, { headers: h });
  const { offset } = (await endRes.json()) as { offset: number };
  const acsRes = await fetch(`${LEDGER}/v2/state/active-contracts`, {
    method: "POST", headers: h,
    body: JSON.stringify({
      activeAtOffset: offset,
      filter: { filtersByParty: { [provider]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } }, verbose: false,
    }),
  });
  const acs = (await acsRes.json()) as any[];
  let total = 0;
  for (const c of acs) {
    const ce = c?.contractEntry?.JsActiveContract?.createdEvent;
    const a = ce?.createArgument;
    if (ce?.templateId?.endsWith(":Holding") && a?.owner === provider && a?.instrument?.source === admin) {
      total += Number(a.amount);
    }
  }
  return total;
}

export interface TokenCharge {
  reference: string; service: string; asset: string; price: string; provider: string;
  snapshot: number; issuedAt: number;
}
export interface SettledToken extends TokenCharge { settledAt: string }

const pending = new Map<string, TokenCharge>();
const settled: SettledToken[] = [];

export async function issueTokenCharge(service: string, asset: string, price: string, provider: string): Promise<TokenCharge> {
  const snapshot = await providerBalance(asset, provider);
  const charge: TokenCharge = {
    reference: `vanton:${service}:${crypto.randomUUID().slice(0, 13)}`,
    service, asset, price, provider, snapshot, issuedAt: Date.now(),
  };
  pending.set(charge.reference, charge);
  return charge;
}

export async function verifyTokenCharge(reference: string): Promise<SettledToken | null> {
  const c = pending.get(reference);
  if (!c) return null;
  const bal = await providerBalance(c.asset, c.provider);
  if (bal + 1e-9 >= c.snapshot + Number(c.price)) {
    pending.delete(reference);
    const rec: SettledToken = { ...c, settledAt: new Date().toISOString() };
    settled.unshift(rec);
    if (settled.length > 200) settled.pop();
    return rec;
  }
  return null;
}

export function tokenActivity(): SettledToken[] {
  return settled;
}
