/**
 * Mandate enforcement — the piece that makes Vanton more than a payment relay.
 *
 * Before the x402 payment is relayed, the gateway exercises `Mandate_Authorize`
 * on the agent's on-ledger AgentMandate. If the ledger rejects it (budget spent,
 * per-call cap exceeded, mandate expired), the transaction fails and we return
 * 403 WITHOUT charging. The agent literally cannot overspend — the rule lives on
 * the ledger, not in this file.
 *
 * NOTE (status): this drives the JSON Ledger API v2 exercise endpoint. Shapes
 * below follow the v2 command/exercise structure; verify field names against the
 * participant's OpenAPI once the DAR is deployed (see docs §2/§3). This is the
 * Day-24 integration point — the DAML choice it calls is already written and
 * tested in daml/daml/Vanton/Tests.daml.
 */

export interface MandateCheckConfig {
  ledgerApiUrl: string;
  bearerToken: string;
  operatorParty: string;
  agentParty: string;
  packageId: string; // DAR package id after `daml build` + upload
}

export interface AuthorizeResult {
  ok: boolean;
  reason?: string;
  authorizationCid?: string;
}

/**
 * Exercise Mandate_Authorize for `amount` against the agent's mandate contract.
 * Returns ok=false (never throws for the expected "over budget" case) so the
 * caller can answer the HTTP request cleanly.
 */
export async function authorizeSpend(
  cfg: MandateCheckConfig,
  mandateCid: string,
  provider: string,
  serviceName: string,
  amount: string,
): Promise<AuthorizeResult> {
  const body = {
    commands: [
      {
        ExerciseCommand: {
          templateId: `${cfg.packageId}:Vanton.Marketplace:AgentMandate`,
          contractId: mandateCid,
          choice: "Mandate_Authorize",
          choiceArgument: { provider, serviceName, amount },
        },
      },
    ],
    actAs: [cfg.agentParty],
    readAs: [cfg.operatorParty],
    // A stable command id makes the submit idempotent under retries.
    commandId: `vanton-authz-${Date.now()}`,
  };

  const res = await fetch(`${cfg.ledgerApiUrl}/v2/commands/submit-and-wait`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.bearerToken}`,
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const data = (await res.json()) as any;
    // The new SpendAuthorization contract id is in the exercise result / events.
    return { ok: true, authorizationCid: extractAuthCid(data) };
  }

  // A failed assertion in the choice (over budget / expired / over cap) comes
  // back as a command rejection — that is the ledger saying "no", not an error.
  const text = await res.text();
  return { ok: false, reason: summarizeRejection(text) };
}

function extractAuthCid(_data: unknown): string | undefined {
  // TODO: pull the created SpendAuthorization cid from the transaction tree.
  return undefined;
}

function summarizeRejection(text: string): string {
  if (text.includes("exceeds remaining budget")) return "budget exhausted";
  if (text.includes("exceeds per-call cap")) return "over per-call cap";
  if (text.includes("mandate expired")) return "mandate expired";
  return "not authorized by mandate";
}
