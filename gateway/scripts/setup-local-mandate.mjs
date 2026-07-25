/**
 * Set up the on-ledger mandate on a local Canton sandbox (no auth).
 *
 * Allocates parties, creates an AgentMandate (budget the ledger enforces), and
 * prints the env the gateway needs. Prereq: a sandbox with the vanton DAR and
 * the JSON API on :7575 —
 *   cd daml && daml sandbox --dar .daml/dist/vanton-0.1.0.dar --json-api-port 7575
 *
 * Usage:  node gateway/scripts/setup-local-mandate.mjs
 */

const L = process.env.LOCAL_LEDGER ?? "http://localhost:7575";
const PKG = process.env.VANTON_PKG ?? "322deec212e394ac80e87c3d69503d76eb4d01311fe1168d57e3e17e12a56b5f";
const M = "Vanton.Marketplace";

const BUDGET = process.env.BUDGET_CC ?? "0.03";
const PER_CALL = process.env.PER_CALL_CC ?? "0.02";

async function j(path, init) {
  const r = await fetch(`${L}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(d)}`);
  return d;
}

async function allocate(hint) {
  const d = await j("/v2/parties", { method: "POST", body: JSON.stringify({ partyIdHint: hint }) });
  return d.partyDetails.party;
}

async function submit(actAs, command) {
  const body = {
    commands: {
      userId: "vanton",
      commands: [command],
      commandId: `setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actAs: Array.isArray(actAs) ? actAs : [actAs],
      readAs: [],
    },
  };
  return j("/v2/commands/submit-and-wait-for-transaction", { method: "POST", body: JSON.stringify(body) });
}

async function activeCid(party, templateEndsWith) {
  const end = await j("/v2/state/ledger-end");
  const acs = await j("/v2/state/active-contracts", {
    method: "POST",
    body: JSON.stringify({
      activeAtOffset: end.offset,
      filter: { filtersByParty: { [party]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } },
      verbose: false,
    }),
  });
  for (const c of acs) {
    const ce = c?.contractEntry?.JsActiveContract?.createdEvent;
    if (ce?.templateId?.endsWith(templateEndsWith)) return ce.contractId;
  }
  return null;
}

const run = async () => {
  const rid = Date.now().toString(36);
  const operator = await allocate(`operator-${rid}`);
  const owner = await allocate(`owner-${rid}`);
  const agent = await allocate(`agent-${rid}`);
  console.error(`allocated:\n  operator ${operator}\n  owner    ${owner}\n  agent    ${agent}`);

  // owner proposes a mandate for the agent
  const validUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  await submit(owner, {
    CreateCommand: {
      templateId: `${PKG}:${M}:MandateProposal`,
      createArguments: { operator, owner, agent, budgetTotal: BUDGET, perCallCap: PER_CALL, asset: "CC", validUntil },
    },
  });
  const proposalCid = await activeCid(owner, ":MandateProposal");
  if (!proposalCid) throw new Error("MandateProposal not found after create");
  console.error(`mandate proposal: ${proposalCid.slice(0, 20)}…`);

  // agent accepts -> AgentMandate
  await submit(agent, {
    ExerciseCommand: {
      templateId: `${PKG}:${M}:MandateProposal`,
      contractId: proposalCid,
      choice: "MandateProposal_Accept",
      choiceArgument: {},
    },
  });
  const mandateCid = await activeCid(agent, ":AgentMandate");
  if (!mandateCid) throw new Error("AgentMandate not found after accept");

  console.error(`\nAgentMandate created (budget ${BUDGET} CC, per-call cap ${PER_CALL} CC).\n`);
  // print env for the gateway (stdout)
  console.log(`# --- paste into gateway/.env for live on-ledger mandate ---`);
  console.log(`VANTON_PACKAGE_ID=${PKG}`);
  console.log(`LOCAL_LEDGER_API_URL=${L}`);
  console.log(`VANTON_OPERATOR_PARTY=${operator}`);
  console.log(`VANTON_AGENT_PARTY=${agent}`);
  console.log(`VANTON_MANDATE_CID=${mandateCid}`);
};

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
