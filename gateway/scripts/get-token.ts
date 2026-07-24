/**
 * Print a fresh Canton devnet access token. Sanity-check that your wallet
 * credentials work before wiring the gateway.
 *
 *   cd gateway && npm install
 *   cp .env.example .env      # fill CANTON_USERNAME + CANTON_PASSWORD
 *   npx tsx scripts/get-token.ts
 */
import "dotenv/config";
import { getAccessToken } from "../src/auth.js";

const token = await getAccessToken();
console.log(token);
