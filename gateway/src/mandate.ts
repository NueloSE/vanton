/**
 * Mandate enforcement — the piece that makes Vanton more than a payment relay.
 *
 * Before a payment is offered, the gateway exercises `Mandate_Authorize` on the
 * agent's on-ledger AgentMandate. If the ledger rejects it (budget spent,
 * per-call cap exceeded, mandate expired) the transaction fails and we refuse
 * the call WITHOUT charging. The rule lives on the ledger, not in this file.
 *
 * `Mandate_Authorize` is consuming — each success archives the mandate and
 * creates a new one with the budget decremented — so we look up the current
 * AgentMandate for the agent on every call rather than caching a contract id.
 *
 * Runs against the local Canton (sandbox) hosting the vanton package; no auth.
 */

export interface MandateCheckConfig {
  ledgerApiUrl: string; // JSON Ledger API of the ledger hosting the vanton DAR
  operatorParty: string;
  agentParty: string;
  packageId: string;
}

export interface AuthorizeResult {
  ok: boolean;
  reason?: string;
  remaining?: string;
}

const MODULE = "Vanton.Marketplace";

async function post(cfg: MandateCheckConfig, path: string, body: unknown): Promise<Response> {
  return fetch(`${cfg.ledgerApiUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The agent's current (unconsumed) AgentMandate contract, with its budget. */
async function currentMandate(
  cfg: MandateCheckConfig,
): Promise<{ cid: string; budgetRemaining: string } | null> {
  const endRes = await fetch(`${cfg.ledgerApiUrl}/v2/state/ledger-end`);
  const { offset } = (await endRes.json()) as { offset: number };
  const acsRes = await post(cfg, "/v2/state/active-contracts", {
    activeAtOffset: offset,
    filter: {
      filtersByParty: {
        [cfg.agentParty]: {
          cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
        },
      },
    },
    verbose: false,
  });
  const acs = (await acsRes.json()) as any[];
  for (const c of acs) {
    const ce = c?.contractEntry?.JsActiveContract?.createdEvent;
    if (ce?.templateId?.endsWith(":AgentMandate")) {
      return { cid: ce.contractId, budgetRemaining: ce.createArgument?.budgetRemaining ?? "?" };
    }
  }
  return null;
}

/**
 * Ask the ledger to authorize `amount` against the agent's mandate. Returns
 * ok=false (never throws for the expected "over budget" case) so the caller can
 * answer the HTTP request cleanly.
 */
export async function authorizeSpend(
  cfg: MandateCheckConfig,
  serviceName: string,
  amount: string,
): Promise<AuthorizeResult> {
  const mandate = await currentMandate(cfg);
  if (!mandate) return { ok: false, reason: "no active mandate for agent" };

  const res = await post(cfg, "/v2/commands/submit-and-wait-for-transaction", {
    commands: {
      userId: "vanton",
      commands: [
        {
          ExerciseCommand: {
            templateId: `${cfg.packageId}:${MODULE}:AgentMandate`,
            contractId: mandate.cid,
            choice: "Mandate_Authorize",
            choiceArgument: { provider: cfg.operatorParty, serviceName, amount },
          },
        },
      ],
      commandId: `vanton-authz-${Date.now()}`,
      actAs: [cfg.agentParty],
      readAs: [],
    },
  });

  if (res.ok) {
    const after = await currentMandate(cfg);
    return { ok: true, remaining: after?.budgetRemaining };
  }
  // A failed assertion in the choice (over budget / cap / expired) comes back as
  // a command rejection — the ledger saying "no", not a transport error.
  return { ok: false, reason: summarizeRejection(await res.text()), remaining: mandate.budgetRemaining };
}

function summarizeRejection(text: string): string {
  if (text.includes("exceeds remaining budget")) return "budget exhausted";
  if (text.includes("exceeds per-call cap")) return "over per-call cap";
  if (text.includes("mandate expired")) return "mandate expired";
  return "not authorized by mandate";
}
