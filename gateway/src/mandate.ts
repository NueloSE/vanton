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
  getToken?: () => Promise<string>; // set for the shared devnet node; omit for a local sandbox
}

export interface AuthorizeResult {
  ok: boolean;
  reason?: string;
  remaining?: string;
}

const MODULE = "Vanton.Marketplace";

async function headers(cfg: MandateCheckConfig): Promise<Record<string, string>> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (cfg.getToken) h.authorization = `Bearer ${await cfg.getToken()}`;
  return h;
}

/** The ledger checks command rights for the token's user, so the command's
 *  userId must be that user. Local sandbox (no token) accepts any userId. */
async function commandUserId(cfg: MandateCheckConfig): Promise<string> {
  if (!cfg.getToken) return "vanton";
  try {
    const payload = (await cfg.getToken()).split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64").toString()).sub as string;
  } catch {
    return "vanton";
  }
}

async function post(cfg: MandateCheckConfig, path: string, body: unknown): Promise<Response> {
  return fetch(`${cfg.ledgerApiUrl}${path}`, {
    method: "POST",
    headers: await headers(cfg),
    body: JSON.stringify(body),
  });
}

/** The agent's current (unconsumed) AgentMandate contract, with its budget. */
async function currentMandate(
  cfg: MandateCheckConfig,
): Promise<{ cid: string; budgetRemaining: string } | null> {
  const endRes = await fetch(`${cfg.ledgerApiUrl}/v2/state/ledger-end`, { headers: await headers(cfg) });
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
      userId: await commandUserId(cfg),
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
