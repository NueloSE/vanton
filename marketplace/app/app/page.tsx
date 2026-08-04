"use client";

/**
 * Vanton marketplace — one screen, three jobs:
 *   1. Browse the services agents can buy (gateway /listings).
 *   2. Let a provider list a new service (gateway POST /listings).
 *   3. Watch real payments settle on Canton, live (gateway /activity, polled).
 *
 * Every number shown is read from the gateway, which reads the ledger — no
 * fabricated data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, Lock, Plus, RefreshCw, Search, Server, Wallet, X, Zap } from "lucide-react";
import { SiteFooter } from "../_components/site-footer";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3402";
const POLL_MS = 5000;
const SERVICES_CAP = 6; // services shown before the "Show all" toggle
const ACTIVITY_CAP = 20; // activity rows shown before the "View all" toggle

// The gateway's state-changing endpoints (set-budget, run-agent, list service)
// require the operator key. We send it if we have one, and only prompt on a 401
// (so local dev with an unprotected gateway is never interrupted). The key is
// remembered for the session so the operator enters it once.
const ADMIN_KEY_LS = "vanton_admin_key";
const getAdminKey = () =>
  typeof window === "undefined" ? "" : window.localStorage.getItem(ADMIN_KEY_LS) ?? "";

// The dashboard registers a themed key prompt here so adminFetch can ask for the
// operator key in-theme (not the browser's generic dialog). Falls back to
// window.prompt if the UI hasn't mounted yet.
let requestOperatorKey: (() => Promise<string>) | null = null;

async function adminFetch(url: string, init: RequestInit): Promise<Response> {
  const withKey = (k: string): RequestInit => ({
    ...init,
    headers: { "content-type": "application/json", ...(k ? { "x-admin-key": k } : {}) },
  });
  let res = await fetch(url, withKey(getAdminKey()));
  if (res.status === 401 && typeof window !== "undefined") {
    const k = requestOperatorKey
      ? await requestOperatorKey()
      : window.prompt("Operator key required for this action:") ?? "";
    if (k) {
      window.localStorage.setItem(ADMIN_KEY_LS, k);
      res = await fetch(url, withKey(k));
    }
  }
  return res;
}

interface Listing {
  id: string;
  name: string;
  provider: string;
  priceAmount: string;
  priceAsset: string;
  category: string;
  endpoint: string;
  description: string;
}

interface Settled {
  reference: string;
  price: string;
  service: string;
  settledAt: string;
  eventId: string;
  sender?: string;
  asset?: string;
}

type Phase = "loading" | "error" | "ready";

const shortParty = (p?: string) => (p ? `${p.slice(0, 10)}…${p.slice(-6)}` : "—");
const shortEvent = (e: string) => `${e.slice(0, 14)}…`;
const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [listings, setListings] = useState<Listing[]>([]);
  const [activity, setActivity] = useState<Settled[]>([]);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [showList, setShowList] = useState(false);
  const [walletParty, setWalletParty] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [agentTask, setAgentTask] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentOutput, setAgentOutput] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ CC: number; cBTC: number; cETH: number } | null>(null);
  const [budgetCC, setBudgetCC] = useState("0.05");
  const [budgetCBTC, setBudgetCBTC] = useState("0.005");
  const [budgetCETH, setBudgetCETH] = useState("0.05");
  const [settingBudget, setSettingBudget] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const keyResolver = useRef<((k: string) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [serviceQuery, setServiceQuery] = useState("");
  const [serviceCategory, setServiceCategory] = useState("all");
  const [showAllServices, setShowAllServices] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, a, b] = await Promise.all([
        fetch(`${GATEWAY}/listings`).then((r) => r.json()),
        fetch(`${GATEWAY}/activity`).then((r) => r.json()),
        fetch(`${GATEWAY}/balances`).then((r) => r.json()).catch(() => null),
      ]);
      setListings(l.listings ?? []);
      setActivity(a.activity ?? []);
      setBalances(b && !b.error ? b : null);
      setLastFetch(new Date());
      setPhase("ready");
    } catch {
      setPhase((p) => (p === "ready" ? p : "error"));
    }
  }, []);

  // Connect a Canton wallet (Console Wallet et al.) via the official dApp SDK.
  // Loaded lazily — it's a browser-only SDK (web components), so it must never
  // run during SSR.
  const connectWallet = useCallback(async () => {
    setConnecting(true);
    setWalletError(null);
    try {
      const sdk = await import("@canton-network/dapp-sdk");
      // Register the default adapters/gateways so the picker shows the full
      // wallet list (Console Wallet, Send, WalletConnect, …), not just a bare gateway.
      await sdk.init?.();
      await sdk.connect();
      const accounts = await sdk.listAccounts();
      const party = accounts?.[0]?.partyId;
      if (!party) throw new Error("Wallet returned no account");
      setWalletParty(party);
    } catch (e) {
      setWalletError(
        ((e as Error)?.message || "Wallet connection failed") + " — or just paste your party ID when listing.",
      );
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    try {
      const sdk = await import("@canton-network/dapp-sdk");
      await sdk.disconnect?.();
    } catch {
      /* ignore */
    }
    setWalletParty(null);
  }, []);

  // Set / refill the agent's on-ledger spending limit (creates fresh mandates).
  const setLimit = useCallback(async () => {
    setSettingBudget(true);
    try {
      await adminFetch(`${GATEWAY}/set-budget`, {
        method: "POST",
        body: JSON.stringify({ budgetCC, budgetCBTC, budgetCETH }),
      });
      load();
    } catch {
      /* ignore */
    } finally {
      setSettingBudget(false);
    }
  }, [budgetCC, budgetCBTC, budgetCETH, load]);

  // Trigger a full agent run on the backend (the "click and watch" test path).
  const runAgent = useCallback(async () => {
    setAgentRunning(true);
    setAgentOutput(null);
    try {
      const r = await adminFetch(`${GATEWAY}/run-agent`, {
        method: "POST",
        body: JSON.stringify({
          task: agentTask || "Get me the current BTC price, then a premium ETH momentum signal.",
        }),
      });
      if (r.status === 401) {
        setAgentOutput("Operator key required to run the agent.");
        return;
      }
      const d = await r.json();
      setAgentOutput(d.output || "(no output)");
      load();
    } catch (e) {
      setAgentOutput("Couldn't reach the agent: " + (e as Error).message);
    } finally {
      setAgentRunning(false);
    }
  }, [agentTask, load]);


  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  // Let module-level adminFetch ask this component for the operator key via a
  // themed modal, resolving the promise when the operator submits or cancels.
  useEffect(() => {
    requestOperatorKey = () =>
      new Promise<string>((resolve) => {
        keyResolver.current = resolve;
        setShowKeyModal(true);
      });
    return () => {
      requestOperatorKey = null;
    };
  }, []);

  const resolveKey = useCallback((k: string) => {
    setShowKeyModal(false);
    keyResolver.current?.(k);
    keyResolver.current = null;
  }, []);

  const stats = useMemo(() => {
    // Volume is CC-only (assets don't sum); per-asset totals live in the wallet strip.
    const ccVolume = activity
      .filter((x) => (x.asset ?? "CC") === "CC")
      .reduce((s, x) => s + Number(x.price || 0), 0);
    return {
      calls: activity.length,
      volume: ccVolume.toFixed(2),
      services: listings.length,
      latest: activity[0]?.settledAt,
    };
  }, [activity, listings]);

  // Client-side spend-limit check: a mandate is a ceiling, so authorizing more
  // than you currently hold is allowed — we only warn, never block. Formats match
  // the balances shown in the wallet strip.
  const fmtCC = balances ? balances.CC.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
  const fmtCBTC = balances ? balances.cBTC.toFixed(4) : "";
  const fmtCETH = balances ? balances.cETH.toFixed(3) : "";
  const overCC = balances != null && Number(budgetCC) > balances.CC;
  const overCBTC = balances != null && Number(budgetCBTC) > balances.cBTC;
  const overCETH = balances != null && Number(budgetCETH) > balances.cETH;
  const limitWarnings = [
    overCC ? `exceeds your ${fmtCC} CC balance` : null,
    overCBTC ? `exceeds your ${fmtCBTC} cBTC balance` : null,
    overCETH ? `exceeds your ${fmtCETH} cETH balance` : null,
  ].filter(Boolean);

  // Presentational only: filter + window the already-fetched lists so the sections
  // stay compact as the number of services / settlements grows. No data is refetched.
  const categories = useMemo(
    () => Array.from(new Set(listings.map((l) => l.category).filter(Boolean))).sort(),
    [listings],
  );
  const filteredListings = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    return listings.filter((l) => {
      const inCategory = serviceCategory === "all" || l.category === serviceCategory;
      const inQuery =
        !q ||
        l.name.toLowerCase().includes(q) ||
        (l.description ?? "").toLowerCase().includes(q) ||
        (l.category ?? "").toLowerCase().includes(q);
      return inCategory && inQuery;
    });
  }, [listings, serviceQuery, serviceCategory]);
  const visibleListings = showAllServices
    ? filteredListings
    : filteredListings.slice(0, SERVICES_CAP);
  const visibleActivity = showAllActivity ? activity : activity.slice(0, ACTIVITY_CAP);

  return (
    <div className="bg-dotgrid flex min-h-dvh flex-col">
      <Header
        live={phase === "ready"}
        lastFetch={lastFetch}
        walletParty={walletParty}
        connecting={connecting}
        walletError={walletError}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6 md:py-12">
        {phase === "loading" && <PageSkeleton />}

      {phase === "error" && (
        <div className="mt-10 flex flex-col items-start gap-3 rounded-lg border border-bad/30 bg-bad/5 p-5">
          <p className="text-sm font-medium text-bad">Can&apos;t reach the Vanton gateway</p>
          <p className="text-sm text-muted">
            The gateway at <span className="font-mono">{GATEWAY}</span> isn&apos;t responding. Start
            it with <span className="font-mono">npm run dev</span> in{" "}
            <span className="font-mono">gateway/</span>, then retry.
          </p>
          <button
            type="button"
            onClick={load}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-onaccent transition-colors hover:bg-accent/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry
          </button>
        </div>
      )}

      {phase === "ready" && (
        <>
          <div className="mb-10">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Marketplace
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
              Live agent-payment marketplace.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted md:text-base">
              Set a budget the ledger enforces, run the agent, and watch every
              call settle on Canton devnet — every number here is read from the
              ledger.
            </p>
          </div>

          <section aria-label="Network stats" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={Zap} label="Calls settled" value={String(stats.calls)} accent />
            <Stat icon={Wallet} label="Volume (CC)" value={stats.volume} />
            <Stat icon={Server} label="Services listed" value={String(stats.services)} />
            <Stat
              icon={Activity}
              label="Last settlement"
              value={stats.latest ? timeAgo(stats.latest) : "—"}
            />
          </section>

          {balances && (
            <section aria-label="Agent wallet" className="mt-4">
              <div className="rounded-xl border border-line bg-panel p-5 md:p-6">
                <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
                  {/* On-ledger balances */}
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                        Agent wallet
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted/60">
                        on-ledger balance
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <BalanceItem label="CC" value={balances.CC.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
                      <BalanceItem label="cBTC" value={balances.cBTC.toFixed(4)} />
                      <BalanceItem label="cETH" value={balances.cETH.toFixed(3)} />
                    </div>
                  </div>

                  {/* Ledger-enforced spend limits */}
                  <div className="lg:border-l lg:border-line lg:pl-10">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                        Spend limits
                      </span>
                      <button
                        type="button"
                        onClick={setLimit}
                        disabled={settingBudget}
                        aria-busy={settingBudget}
                        className="inline-flex h-8 items-center rounded-md border border-line bg-panel2 px-3 text-xs font-medium text-text transition-colors hover:border-accent/50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {settingBudget ? "Setting…" : "Set / refill"}
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <LimitInput label="CC" value={budgetCC} onChange={setBudgetCC} over={overCC} />
                      <LimitInput label="cBTC" value={budgetCBTC} onChange={setBudgetCBTC} over={overCBTC} />
                      <LimitInput label="cETH" value={budgetCETH} onChange={setBudgetCETH} over={overCETH} />
                    </div>
                    {limitWarnings.length > 0 && (
                      <p className="mt-2.5 font-mono text-[11px] leading-relaxed text-accent/90">
                        {limitWarnings.join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section aria-label="Run the AI agent" className="mt-8">
            <div className="rounded-xl border border-line bg-panel p-5 md:p-6">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel2 text-accent">
                  <Zap className="h-5 w-5" aria-hidden />
                </span>
                <h2 className="text-lg font-bold tracking-tight">Run the AI agent</h2>
              </div>
              <p className="mt-3 text-sm text-muted">
                Give it a task — it discovers services, pays on Canton in the right asset, and answers.
                Settlements appear in the feed below.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <label htmlFor="agent-task" className="sr-only">
                  Agent task
                </label>
                <input
                  id="agent-task"
                  value={agentTask}
                  onChange={(e) => setAgentTask(e.target.value)}
                  className={`${inputCls} flex-1`}
                  placeholder="e.g. Get me the current BTC price, then a premium ETH signal."
                />
                <button
                  type="button"
                  onClick={runAgent}
                  disabled={agentRunning}
                  aria-busy={agentRunning}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-onaccent transition-colors hover:bg-accent/90 active:translate-y-px disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                >
                  {agentRunning ? "Running…" : "Run agent"}
                </button>
              </div>
              {agentRunning && !agentOutput && (
                <p className="mt-3 text-sm text-muted">The agent is working — buying services and settling on Canton…</p>
              )}
              {agentOutput && (
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel2 p-3 font-mono text-xs text-muted">
                  {agentOutput}
                </pre>
              )}
            </div>
          </section>

          <section aria-label="Service listings" className="mt-10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionTitle>Services</SectionTitle>
                <p className="mt-1 text-sm text-muted">
                  APIs and data feeds agents can pay for, per call.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowList(true)}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-onaccent transition-colors hover:bg-accent/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                <Plus className="h-4 w-4" aria-hidden />
                List a service
              </button>
            </div>
            {listings.length === 0 ? (
              <div className="mt-4">
                <EmptyListings onList={() => setShowList(true)} />
              </div>
            ) : (
              <>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative w-full sm:max-w-xs">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={serviceQuery}
                      onChange={(e) => {
                        setServiceQuery(e.target.value);
                        setShowAllServices(false);
                      }}
                      placeholder="Search services…"
                      aria-label="Search services"
                      className="h-9 w-full rounded-md border border-line bg-panel2 pl-9 pr-3 text-sm text-text placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>
                  {categories.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CategoryChip
                        label="All"
                        active={serviceCategory === "all"}
                        onClick={() => {
                          setServiceCategory("all");
                          setShowAllServices(false);
                        }}
                      />
                      {categories.map((c) => (
                        <CategoryChip
                          key={c}
                          label={c}
                          active={serviceCategory === c}
                          onClick={() => {
                            setServiceCategory(c);
                            setShowAllServices(false);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  {filteredListings.length === 0 ? (
                    <div className="rounded-xl border border-line bg-panel py-10 text-center text-sm text-muted">
                      No services match
                      {serviceQuery ? ` “${serviceQuery.trim()}”` : ""}
                      {serviceCategory !== "all" ? ` in ${serviceCategory}` : ""}.
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {visibleListings.map((l) => (
                        <ListingCard key={l.id} listing={l} />
                      ))}
                    </div>
                  )}
                </div>

                {filteredListings.length > SERVICES_CAP && (
                  <div className="mt-5 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShowAllServices((v) => !v)}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel2 px-4 text-sm font-medium text-text transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                    >
                      {showAllServices
                        ? "Show less"
                        : `Show all ${filteredListings.length}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section aria-label="Live settlement activity" className="mt-10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionTitle>Live activity</SectionTitle>
                <p className="mt-1 text-sm text-muted">
                  Every row is a real transaction on Canton devnet, verified on-ledger before the service was served.
                </p>
              </div>
              {activity.length > 0 && (
                <span className="mt-1 shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                  {showAllActivity
                    ? `${activity.length} settled`
                    : `Latest ${Math.min(ACTIVITY_CAP, activity.length)} · ${activity.length} settled`}
                </span>
              )}
            </div>
            <div className="mt-4">
              {activity.length === 0 ? (
                <EmptyActivity />
              ) : (
                <ActivityTable rows={visibleActivity} />
              )}
            </div>
            {activity.length > ACTIVITY_CAP && (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllActivity((v) => !v)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel2 px-4 text-sm font-medium text-text transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                >
                  {showAllActivity ? "Show latest" : `View all ${activity.length}`}
                </button>
              </div>
            )}
          </section>
        </>
      )}
      </main>

      <SiteFooter />

      {showList && (
        <ListServiceModal
          gateway={GATEWAY}
          defaultProvider={walletParty ?? ""}
          onClose={() => setShowList(false)}
          onListed={() => {
            setShowList(false);
            load();
          }}
        />
      )}

      {showKeyModal && (
        <OperatorKeyModal onSubmit={(k) => resolveKey(k)} onCancel={() => resolveKey("")} />
      )}
    </div>
  );
}

// A themed replacement for the browser's window.prompt — asked for on a 401 from
// a privileged action so the operator can supply the key in-theme.
function OperatorKeyModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (k: string) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="key-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-line bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel2 text-accent">
            <Lock className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="key-title" className="text-lg font-bold tracking-tight">
            Operator key
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          This action changes on-ledger state and moves funds, so it needs the operator key.
          Browsing the marketplace stays open without it.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(key.trim());
          }}
          className="mt-4 flex flex-col gap-3"
        >
          <label htmlFor="operator-key" className="sr-only">
            Operator key
          </label>
          <input
            id="operator-key"
            ref={inputRef}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste the operator key"
            autoComplete="off"
            className={`${inputCls} font-mono text-xs`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-10 items-center rounded-md border border-line bg-panel2 px-4 text-sm font-medium text-text transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!key.trim()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-onaccent transition-colors hover:bg-accent/90 active:translate-y-px disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              <Lock className="h-4 w-4" aria-hidden />
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Header({
  live,
  lastFetch,
  walletParty,
  connecting,
  walletError,
  onConnect,
  onDisconnect,
}: {
  live: boolean;
  lastFetch: Date | null;
  walletParty: string | null;
  connecting: boolean;
  walletError: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/95">
      <h1 className="sr-only">Vanton</h1>
      <div className="flex items-center justify-between gap-4 px-5 py-4 md:px-8 lg:px-10">
        <Link
          href="/"
          aria-label="Vanton home"
          className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-clean.png" alt="Vanton" className="h-11 w-auto md:h-12" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 sm:flex">
            <span
              className={`pulse-dot h-2 w-2 rounded-full ${live ? "bg-good" : "bg-muted"}`}
              aria-hidden
            />
            <span className="font-mono text-xs text-muted">
              {live
                ? `devnet · updated ${lastFetch ? timeAgo(lastFetch.toISOString()) : "now"}`
                : "connecting…"}
            </span>
          </div>
          {walletParty ? (
            <button
              type="button"
              onClick={onDisconnect}
              title={walletParty}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-good/40 bg-good/10 px-3 text-sm font-medium text-good transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-good focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              <span className="h-2 w-2 rounded-full bg-good" aria-hidden />
              <span className="font-mono text-xs">{shortParty(walletParty)}</span>
              <span className="text-muted">·</span>
              <span className="text-xs">Disconnect</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              disabled={connecting}
              aria-busy={connecting}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-panel px-4 text-sm font-medium text-text transition-colors hover:border-accent/50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              <Wallet className="h-4 w-4" aria-hidden />
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
      {walletError && (
        <div className="border-t border-line px-5 py-2.5 md:px-8 lg:px-10">
          <p className="text-xs text-bad">{walletError}</p>
        </div>
      )}
    </header>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold tracking-tight">{children}</h2>;
}

function Stat({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p
        className={`mt-3 font-mono text-3xl font-semibold tabular-nums ${accent ? "text-accent" : "text-text"}`}
      >
        {value}
      </p>
    </div>
  );
}

function BalanceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2.5">
      <div className="truncate font-mono text-lg font-semibold tabular-nums text-text" title={value}>
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-accent">{label}</div>
    </div>
  );
}

function LimitInput({
  label,
  value,
  onChange,
  over = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  over?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] text-accent">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-label={`${label} limit`}
        className={`h-9 w-full rounded-md border bg-panel2 px-2.5 font-mono text-sm tabular-nums text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          over ? "border-accent/70" : "border-line"
        }`}
      />
    </label>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 items-center rounded-full border px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-line bg-panel2 text-muted hover:border-accent/40 hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-5 transition-colors hover:border-accent/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold tracking-tight">{listing.name}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">{listing.description || "—"}</p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-panel2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
          {listing.category}
        </span>
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-line pt-3.5">
        <span className="font-mono text-sm tabular-nums">
          <span className="text-base font-semibold text-accent">{listing.priceAmount}</span>{" "}
          <span className="text-muted">{listing.priceAsset} / call</span>
        </span>
        <span className="font-mono text-xs text-muted" title={listing.provider}>
          {shortParty(listing.provider)}
        </span>
      </div>
    </article>
  );
}

function ActivityTable({ rows }: { rows: Settled[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-160 border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-panel2 text-left">
            {["Settled", "Service", "Amount", "Payer", "On-ledger event"].map((h) => (
              <th
                key={h}
                className="px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.reference}
              className="border-b border-line bg-panel transition-colors last:border-b-0 hover:bg-panel2/50"
            >
              <td className="px-4 py-3.5 font-mono text-xs tabular-nums text-muted">
                {timeAgo(r.settledAt)}
              </td>
              <td className="px-4 py-3.5 font-medium">{r.service}</td>
              <td className="px-4 py-3.5 font-mono tabular-nums">
                <span className="text-good">{r.price}</span> <span className="text-muted">{r.asset ?? "CC"}</span>
              </td>
              <td className="px-4 py-3.5 font-mono text-xs text-muted" title={r.sender}>
                {shortParty(r.sender)}
              </td>
              <td className="px-4 py-3.5 font-mono text-xs text-muted" title={r.eventId || "settled on-ledger"}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" aria-hidden />
                  {r.eventId ? shortEvent(r.eventId) : "settled"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyActivity() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-panel py-14 text-center">
      <Activity className="h-8 w-8 text-muted" aria-hidden />
      <div>
        <p className="text-sm font-medium">No settlements yet</p>
        <p className="mt-1 text-sm text-muted">
          Run the demo agent to watch payments land here:{" "}
          <span className="font-mono text-xs">cd agent &amp;&amp; npm start</span>
        </p>
      </div>
    </div>
  );
}

function EmptyListings({ onList }: { onList: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-panel py-14 text-center">
      <Server className="h-8 w-8 text-muted" aria-hidden />
      <div>
        <p className="text-sm font-medium">No services listed yet</p>
        <p className="mt-1 text-sm text-muted">
          Be the first to list an API agents can pay for, per call.
        </p>
      </div>
      <button
        type="button"
        onClick={onList}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel2 px-3.5 text-sm font-medium text-text transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      >
        <Plus className="h-4 w-4" aria-hidden />
        List a service
      </button>
    </div>
  );
}

function ListServiceModal({
  gateway,
  defaultProvider,
  onClose,
  onListed,
}: {
  gateway: string;
  defaultProvider: string;
  onClose: () => void;
  onListed: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    provider: defaultProvider,
    priceAmount: "",
    priceAsset: "CC",
    category: "",
    targetUrl: "",
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await adminFetch(`${gateway}/listings`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          res.status === 401
            ? "Operator key required to list a service."
            : data.error || `Request failed (${res.status})`,
        );
      }
      onListed();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="list-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-line bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="list-title" className="text-lg font-bold tracking-tight">
              List a service
            </h2>
            <p className="mt-1 text-sm text-muted">
              Register an API agents can pay for, per call, on Canton.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-2 text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <Field label="Service name" htmlFor="name">
            <input
              id="name"
              required
              value={form.name}
              onChange={set("name")}
              placeholder="Canton Stats API"
              className={inputCls}
            />
          </Field>

          <Field
            label="Your Canton party ID"
            htmlFor="provider"
            hint="Connect your wallet above to fill this, or paste it — you receive payments here."
          >
            <input
              id="provider"
              required
              value={form.provider}
              onChange={set("provider")}
              placeholder="yourname::1220…"
              autoComplete="off"
              className={`${inputCls} font-mono text-xs`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Price / call" htmlFor="price">
              <input
                id="price"
                required
                inputMode="decimal"
                value={form.priceAmount}
                onChange={set("priceAmount")}
                placeholder="0.01"
                className={`${inputCls} font-mono tabular-nums`}
              />
            </Field>
            <Field label="Asset" htmlFor="asset">
              <select id="asset" value={form.priceAsset} onChange={set("priceAsset")} className={inputCls}>
                <option value="CC">CC</option>
                <option value="cBTC">cBTC</option>
                <option value="cETH">cETH</option>
              </select>
            </Field>
          </div>

          <Field label="Category" htmlFor="category">
            <input
              id="category"
              value={form.category}
              onChange={set("category")}
              placeholder="analytics"
              className={inputCls}
            />
          </Field>

          <Field label="Description" htmlFor="description" hint="What does this service do? Shown on the listing card and read by agents.">
            <textarea
              id="description"
              value={form.description}
              onChange={set("description")}
              placeholder="Live weather for any city, refreshed hourly."
              rows={2}
              className={`${inputCls} h-auto resize-none py-2`}
            />
          </Field>

          <Field
            label="Your API URL"
            htmlFor="targetUrl"
            hint="The gateway calls this after an agent pays. Try the demo one below to test."
          >
            <input
              id="targetUrl"
              required
              value={form.targetUrl}
              onChange={set("targetUrl")}
              placeholder="http://localhost:3402/free-sample"
              className={`${inputCls} font-mono text-xs`}
            />
          </Field>

          {error && (
            <p className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
            className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-onaccent transition-colors hover:bg-accent/90 active:translate-y-px disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            {submitting ? "Listing…" : "List service"}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-md border border-line bg-panel2 px-3 text-sm text-text placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-10" aria-hidden>
      <div className="h-16 w-full max-w-md rounded-xl bg-panel motion-safe:animate-pulse" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-panel motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-36 rounded-xl bg-panel motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-panel motion-safe:animate-pulse" />
    </div>
  );
}
