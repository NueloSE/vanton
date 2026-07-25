/**
 * Real Canton network data for the canton-stats service.
 *
 * Pulls genuine, live numbers from the shared devnet — the current reward round
 * (shared by the whole network) and the ledger offset (total ledger events so
 * far). Both move over time, so a buyer gets fresh data on every paid call.
 */

import { getAccessToken } from "./auth.js";

const LEDGER = "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services:443";
const VALIDATOR = "https://validator-api-http.validator.hackcanton-01.devnet.naas.noders.services";

export interface CantonStats {
  network: string;
  currentRound: number;
  ledgerOffset: number;
  observedAt: string;
  source: string;
}

/** CC (Amulet) balance of the onboarded operator wallet, via the validator API. */
export async function ccBalance(): Promise<number> {
  const token = await getAccessToken();
  const r = await fetch(`${VALIDATOR}/api/validator/v0/wallet/balance`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) return 0;
  const d = (await r.json()) as { effective_unlocked_qty?: string };
  return Number(d.effective_unlocked_qty ?? 0);
}

export async function cantonStats(): Promise<CantonStats> {
  const token = await getAccessToken();
  const auth = { authorization: `Bearer ${token}` };
  const [endRes, balRes] = await Promise.all([
    fetch(`${LEDGER}/v2/state/ledger-end`, { headers: auth }),
    fetch(`${VALIDATOR}/api/validator/v0/wallet/balance`, { headers: auth }),
  ]);
  if (!endRes.ok) throw new Error(`ledger-end ${endRes.status}`);
  if (!balRes.ok) throw new Error(`balance ${balRes.status}`);
  const end = (await endRes.json()) as { offset: number };
  const bal = (await balRes.json()) as { round: number };
  return {
    network: "Canton hackcanton-01 devnet",
    currentRound: bal.round,
    ledgerOffset: end.offset,
    observedAt: new Date().toISOString(),
    source: "Canton JSON Ledger API + Splice validator",
  };
}
