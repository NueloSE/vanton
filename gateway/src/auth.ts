/**
 * Canton devnet access token via the Keycloak password grant.
 *
 * Reads CANTON_USERNAME / CANTON_PASSWORD from the environment (put them in
 * gateway/.env, which is gitignored — they never enter the repo). Caches the
 * token and refreshes it before expiry so long-running demos don't die
 * mid-flight.
 */

const KEYCLOAK_URL =
  "https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token";
const CLIENT_ID = "web-app-ui-hackcanton-01-devnet";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

let cached: { token: string; expiresAt: number } | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} — set it in gateway/.env`);
  return v;
}

export async function getAccessToken(): Promise<string> {
  // reuse the cached token until 30s before it expires
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
  if (!res.ok) {
    throw new Error(`token request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}
