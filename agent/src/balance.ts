/** Quick check: party + CC balance via the validator API. */
import "dotenv/config";
import { getBalance, getPartyId } from "./canton.js";

const party = await getPartyId();
const b = await getBalance();
console.log(`party:   ${party}`);
console.log(`balance: ${b.unlocked} CC (round ${b.round})`);
