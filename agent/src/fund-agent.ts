/**
 * Concept B: fund the agent's OWN wallet (vanton-agent) with cBTC/cETH so it
 * spends its own capped funds, not the owner's personal wallet. Transfers a
 * small amount from the owner party (ff34445b) to vanton-agent.
 *
 * Run once:  cd agent && npx tsx src/fund-agent.ts
 */
import "dotenv/config";
import { getPartyId } from "./canton.js";
import { payToken } from "./token-pay.js";

const AGENT = process.env.VANTON_AGENT_PARTY;
if (!AGENT) throw new Error("set VANTON_AGENT_PARTY in agent/.env");

const owner = await getPartyId();
console.log(`funding ${AGENT.slice(0, 20)}… from ${owner.slice(0, 20)}…`);
await payToken("cBTC", process.env.FUND_CBTC ?? "0.02", owner, AGENT);
console.log("  cBTC funded");
await payToken("cETH", process.env.FUND_CETH ?? "0.2", owner, AGENT);
console.log("  cETH funded");
console.log("vanton-agent is now a funded, ledger-capped agent wallet.");
