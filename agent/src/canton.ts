/**
 * Canton devnet client for the Vanton agent: Keycloak auth + the Splice
 * validator ("wallet") API. This is the devnet payment rail — real CC moves
 * on-ledger with each send. Verified live against hackcanton-01:
 *   GET  /api/validator/v0/wallet/balance             -> round + unlocked qty
 *   GET  /api/validator/v0/wallet/user-status         -> party id, onboarded
 *   POST /api/validator/v0/wallet/transfer-preapproval        -> self-provision
 *   POST /api/validator/v0/wallet/transfer-preapproval/send   -> one-step direct pay
 */

const KEYCLOAK_URL =
  "https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token";
const CLIENT_ID = "web-app-ui-hackcanton-01-devnet";
const VALIDATOR_API =
  "https://validator-api-http.validator.hackcanton-01.devnet.naas.noders.services";

let cached: { token: string; expiresAt: number } | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} — see .env.example`);
  return v;
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 30_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: CLIENT_ID,
    username: requireEnv("CANTON_USERNAME"),
    password: requireEnv("CANTON_PASSWORD"),
    scope: "openid daml_ledger_api offline_access",
  });
  const res = await fetch(KEYCLOAK_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function vapi(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${VALIDATOR_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export interface Balance {
  round: number;
  unlocked: string;
}

export async function getBalance(): Promise<Balance> {
  const res = await vapi("/api/validator/v0/wallet/balance");
  if (!res.ok) throw new Error(`balance failed: ${res.status}`);
  const d = (await res.json()) as { round: number; effective_unlocked_qty: string };
  return { round: d.round, unlocked: d.effective_unlocked_qty };
}

export async function getPartyId(): Promise<string> {
  const res = await vapi("/api/validator/v0/wallet/user-status");
  if (!res.ok) throw new Error(`user-status failed: ${res.status}`);
  return ((await res.json()) as { party_id: string }).party_id;
}

/** One-time: allow others to pay this party directly (no accept step). */
export async function ensureTransferPreapproval(): Promise<string> {
  const res = await vapi("/api/validator/v0/wallet/transfer-preapproval", {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) throw new Error(`preapproval failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { transfer_preapproval_contract_id: string })
    .transfer_preapproval_contract_id;
}

/**
 * Pay `amount` CC directly to `receiver` (must hold a TransferPreapproval).
 * Settles as one on-ledger transaction. The dedupId doubles as our payment
 * reference on the wire.
 */
export async function payDirect(
  receiver: string,
  amount: string,
  dedupId: string,
): Promise<void> {
  const res = await vapi("/api/validator/v0/wallet/transfer-preapproval/send", {
    method: "POST",
    body: JSON.stringify({
      receiver_party_id: receiver,
      amount,
      deduplication_id: dedupId,
      // The reference travels in the transfer's description so the merchant
      // can match the on-ledger payment to the HTTP charge.
      description: dedupId,
    }),
  });
  if (!res.ok) throw new Error(`payment failed: ${res.status} ${await res.text()}`);
}
