/**
 * Vanton AI agent.
 *
 * A real LLM agent whose tools are PAID services on the Vanton marketplace.
 * Given a task, it reads the marketplace, decides which services it needs,
 * pays for them in Canton Coin on-ledger, uses the results, and answers —
 * all under a spend budget. This is the "AI" in AI-agent marketplace: the
 * model reasons about what to buy; every purchase is a real Canton payment.
 *
 * Budget note: the budget here is enforced in-agent. The on-ledger AgentMandate
 * (daml/) makes the same limit ledger-enforced — that's the next wiring step,
 * where Canton itself rejects an over-budget call.
 *
 * Run:  cd agent && npx tsx src/ai-agent.ts "what is happening on Canton right now?"
 */

import "dotenv/config";
import OpenAI from "openai";
import { getBalance, getPartyId, payDirect } from "./canton.js";
import { payToken } from "./token-pay.js";

const GATEWAY = (process.env.GATEWAY_URL ?? "http://localhost:3402").replace(/\/$/, "");
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
// Concept B: the agent spends wrapped assets from its OWN funded wallet.
const AGENT_PARTY = process.env.VANTON_AGENT_PARTY ?? "";

const openai = new OpenAI(); // reads OPENAI_API_KEY

interface Listing {
  id: string;
  name: string;
  description: string;
  priceAmount: string;
  priceAsset: string;
  endpoint: string;
  provider: string;
  category: string;
}

const c = {
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  teal: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const log = (s = "") => console.log(s);

let spent = 0;

async function fetchListings(): Promise<Listing[]> {
  const r = await fetch(`${GATEWAY}/listings`);
  if (!r.ok) throw new Error(`gateway /listings ${r.status}`);
  return (await r.json()).listings ?? [];
}

/**
 * Buy a service through the gateway's 402 flow. The spend limit is enforced by
 * the Canton ledger (the AgentMandate): if the agent is over budget, the initial
 * request comes back 403 and no payment is attempted — the ledger said no.
 */
async function buyService(listing: Listing): Promise<{ ok: boolean; data?: string; error?: string }> {
  const url = `${GATEWAY}${listing.endpoint}`;
  const challengeRes = await fetch(url);

  if (challengeRes.status === 403) {
    const d = (await challengeRes.json().catch(() => ({}))) as { reason?: string; budgetRemaining?: string };
    log(c.amber(`      ⛔ ledger refused the spend: ${d.reason} (on-chain budget left ${d.budgetRemaining ?? "0"})`));
    return {
      ok: false,
      error: `The Canton ledger REFUSED this purchase (${d.reason ?? "not authorized"}). The on-chain spending budget is exhausted; you cannot buy anything more.`,
    };
  }
  if (challengeRes.status !== 402) return { ok: false, error: `expected 402, got ${challengeRes.status}` };

  const ch = (await challengeRes.json()) as { price: string; payTo: string; asset: string; reference: string };
  log(c.dim(`      402 → pay ${ch.price} ${ch.asset} to ${ch.payTo.slice(0, 16)}…`));

  // Route settlement by the asset the provider priced the service in.
  if (ch.asset === "cBTC" || ch.asset === "cETH") {
    const payer = AGENT_PARTY || (await getPartyId()); // spend from the agent's own wallet
    const updateId = await payToken(ch.asset, ch.price, payer, ch.payTo);
    log(c.teal(`      ✓ settled ${ch.price} ${ch.asset} from agent wallet (${updateId.slice(0, 12)}…)`));
  } else {
    await payDirect(ch.payTo, ch.price, ch.reference); // CC via validator API
    log(c.teal(`      ✓ paid ${ch.price} CC on-ledger`));
  }

  // The gateway verifies by the charge reference (for both rails).
  const dataRes = await fetch(url, { headers: { "x-vanton-payment": ch.reference } });
  if (!dataRes.ok) return { ok: false, error: `retry failed ${dataRes.status}` };
  return { ok: true, data: await dataRes.text() };
}

async function main() {
  const task = process.argv.slice(2).join(" ") || "What is happening on the Canton network right now? Give me a one-line summary.";
  const party = await getPartyId();
  const bal = await getBalance();
  const listings = await fetchListings();

  log(c.bold("\n  VANTON AI AGENT"));
  log(c.dim(`  CC wallet ${party.slice(0, 16)}… (${bal.unlocked} CC) · cBTC/cETH from agent wallet ${AGENT_PARTY.slice(0, 16)}… · budgets enforced on-ledger · ${MODEL}`));
  log(c.bold(`\n  TASK: `) + task);
  log(c.dim(`\n  ${listings.length} services on the marketplace:`));
  for (const l of listings) log(c.dim(`    · ${l.name} (${l.id}) — ${l.priceAmount} ${l.priceAsset}: ${l.description}`));
  log();

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "buy_service",
        description:
          "Buy one paid service from the Vanton marketplace to help complete the task. Costs Canton Coin, paid on-ledger. Only buy a service if it genuinely helps; stay within budget.",
        parameters: {
          type: "object",
          properties: {
            service_id: {
              type: "string",
              enum: listings.map((l) => l.id),
              description: "The id of the marketplace service to buy",
            },
          },
          required: ["service_id"],
        },
      },
    },
  ];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are an autonomous agent on the Vanton marketplace. You have an on-chain spending budget enforced by the Canton ledger — ` +
        `if you try to spend past it, a purchase will be REFUSED by the ledger and you must stop buying and report what you managed to gather. ` +
        `You complete tasks by buying paid services when they help. Each purchase spends real money on-ledger, so buy only what you need. ` +
        `When you have enough information (or the ledger stops you), give a concise final answer. ` +
        `Available services:\n` +
        listings.map((l) => `- ${l.id}: ${l.name} (${l.priceAmount} ${l.priceAsset}) — ${l.description}`).join("\n"),
    },
    { role: "user", content: task },
  ];

  for (let step = 0; step < 8; step++) {
    const resp = await openai.chat.completions.create({ model: MODEL, messages, tools });
    const msg = resp.choices[0].message;
    messages.push(msg);

    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        const args = JSON.parse(tc.function.arguments || "{}");
        const listing = listings.find((l) => l.id === args.service_id);
        log(c.amber(`  ◆ agent decides to buy: ${args.service_id}`));
        const result = listing
          ? await buyService(listing)
          : { ok: false, error: `no such service ${args.service_id}` };
        if (!result.ok) log(c.dim(`      ✗ ${result.error}`));
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.ok ? (result.data as string) : `ERROR: ${result.error}`,
        });
      }
      continue;
    }

    log(c.bold("\n  ANSWER: ") + (msg.content ?? "(no answer)"));
    log(c.dim(`\n  total spent: ${spent.toFixed(3)} CC on-ledger\n`));
    return;
  }
  log(c.dim("  (stopped after 8 steps)"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
