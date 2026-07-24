/**
 * Devnet payment rail for the Vanton gateway.
 *
 * The gateway issues a 402 challenge with a one-time payment reference; the
 * agent pays real CC on-ledger (validator API direct transfer, with the
 * reference in the transfer's description); the gateway verifies by scanning
 * its own wallet history for a TransferPreapproval_Send carrying that
 * reference. Every paid call is one real Canton transaction.
 *
 * (The x402/facilitator rail is the mainnet path; this module is the devnet
 * equivalent so the full loop runs on the hackathon node today.)
 */

import crypto from "node:crypto";
import { getAccessToken } from "./auth.js";

const VALIDATOR_API =
  "https://validator-api-http.validator.hackcanton-01.devnet.naas.noders.services";

export interface PendingCharge {
  reference: string;
  price: string;
  service: string;
  issuedAt: number;
}

/** reference -> charge we are waiting to see on-ledger */
const pending = new Map<string, PendingCharge>();
/** reference -> settled record (kept for the activity feed) */
export interface SettledCharge extends PendingCharge {
  settledAt: string;
  eventId: string;
  sender?: string;
}
const settled: SettledCharge[] = [];

export function issueCharge(service: string, price: string): PendingCharge {
  const charge: PendingCharge = {
    reference: `vanton:${service}:${crypto.randomUUID().slice(0, 13)}`,
    price,
    service,
    issuedAt: Date.now(),
  };
  pending.set(charge.reference, charge);
  return charge;
}

interface TxItem {
  transaction_subtype: { choice: string };
  event_id: string;
  date: string;
  description: string | null;
  sender?: { party: string } | null;
}

/**
 * Look for the on-ledger transfer carrying `reference` in its description.
 * Scans the merchant wallet's recent history (newest first).
 */
export async function verifyCharge(reference: string): Promise<SettledCharge | null> {
  const charge = pending.get(reference);
  if (!charge) return null;

  const token = await getAccessToken();
  const res = await fetch(`${VALIDATOR_API}/api/validator/v0/wallet/transactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ page_size: 25 }),
  });
  if (!res.ok) throw new Error(`tx history failed: ${res.status}`);
  const { items } = (await res.json()) as { items: TxItem[] };

  const hit = items.find(
    (t) =>
      t.transaction_subtype?.choice === "TransferPreapproval_Send" &&
      t.description === reference,
  );
  if (!hit) return null;

  pending.delete(reference);
  const record: SettledCharge = {
    ...charge,
    settledAt: hit.date,
    eventId: hit.event_id,
    sender: hit.sender?.party,
  };
  settled.unshift(record);
  if (settled.length > 200) settled.pop();
  return record;
}

export function activityFeed(): SettledCharge[] {
  return settled;
}
