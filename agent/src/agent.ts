/**
 * Vanton demo agent.
 *
 * Loop: discover a service on the marketplace -> request it -> hit the 402
 * paywall -> authorize the spend against its on-ledger mandate -> pay real CC
 * on Canton devnet -> retry with proof -> receive the data. Logs every step so
 * the demo (and the judges) can watch money and data move.
 *
 * Payment rail: Splice validator API direct transfer (one on-ledger tx per
 * call). The x402/facilitator rail plugs in behind the same loop for mainnet.
 */

import "dotenv/config";
import { getBalance, getPartyId, payDirect } from "./canton.js";

const GATEWAY = (process.env.GATEWAY_URL ?? "http://localhost:3402").replace(/\/$/, "");
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 15_000);
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 10);
const MANDATE_CID = process.env.MANDATE_CID ?? "";

interface Challenge {
  price: string;       // human CC, e.g. "0.01"
  payTo: string;       // merchant party id
  asset: string;       // "CC"
  reference: string;   // gateway-issued payment reference
}

const log = (msg: string) => console.log(`[agent ${new Date().toISOString()}] ${msg}`);

async function callPaidService(url: string): Promise<void> {
  // 1. First request — expect the paywall.
  const first = await fetch(url, {
    headers: MANDATE_CID ? { "x-vanton-mandate": MANDATE_CID } : {},
  });
  if (first.status !== 402) {
    log(`unexpected ${first.status} (expected 402) — ${await first.text()}`);
    return;
  }
  const challenge = (await first.json()) as Challenge;
  log(`402 challenge: ${challenge.price} ${challenge.asset} -> ${challenge.payTo.slice(0, 24)}…`);

  // 2. Pay on-ledger (real CC on devnet).
  await payDirect(challenge.payTo, challenge.price, challenge.reference);
  log(`paid ${challenge.price} CC on-ledger (ref ${challenge.reference})`);

  // 3. Retry with proof of payment.
  const second = await fetch(url, {
    headers: {
      "x-vanton-payment": challenge.reference,
      ...(MANDATE_CID ? { "x-vanton-mandate": MANDATE_CID } : {}),
    },
  });
  if (second.ok) {
    const data = await second.text();
    log(`200 OK — data received: ${data.slice(0, 120)}`);
  } else {
    log(`retry failed: ${second.status} ${await second.text()}`);
  }
}

async function main() {
  const party = await getPartyId();
  const balance = await getBalance();
  log(`agent party ${party.slice(0, 24)}… | balance ${balance.unlocked} CC | mandate ${MANDATE_CID ? MANDATE_CID.slice(0, 12) + "…" : "(none — set MANDATE_CID once DAR is live)"}`);

  for (let i = 1; i <= MAX_CALLS; i++) {
    log(`— call ${i}/${MAX_CALLS} —`);
    try {
      await callPaidService(`${GATEWAY}/stats`);
      const b = await getBalance();
      log(`balance now ${b.unlocked} CC`);
    } catch (e) {
      log(`error: ${(e as Error).message}`);
    }
    if (i < MAX_CALLS) await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
