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
import { Activity, Plus, RefreshCw, Server, Wallet, X, Zap } from "lucide-react";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3402";
const POLL_MS = 5000;

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
  const [agentTask, setAgentTask] = useState("Get me the current BTC price, then a premium ETH momentum signal.");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentOutput, setAgentOutput] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([
        fetch(`${GATEWAY}/listings`).then((r) => r.json()),
        fetch(`${GATEWAY}/activity`).then((r) => r.json()),
      ]);
      setListings(l.listings ?? []);
      setActivity(a.activity ?? []);
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

  // Trigger a full agent run on the backend (the "click and watch" test path).
  const runAgent = useCallback(async () => {
    setAgentRunning(true);
    setAgentOutput(null);
    try {
      const r = await fetch(`${GATEWAY}/run-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: agentTask }),
      });
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

  const stats = useMemo(() => {
    const volume = activity.reduce((s, x) => s + Number(x.price || 0), 0);
    return {
      calls: activity.length,
      volume: volume.toFixed(2),
      services: listings.length,
      latest: activity[0]?.settledAt,
    };
  }, [activity, listings]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <Header
        live={phase === "ready"}
        lastFetch={lastFetch}
        walletParty={walletParty}
        connecting={connecting}
        walletError={walletError}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
      />

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
            onClick={load}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-onaccent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry
          </button>
        </div>
      )}

      {phase === "ready" && (
        <>
          <section aria-label="Network stats" className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={Zap} label="Calls settled" value={String(stats.calls)} accent />
            <Stat icon={Wallet} label="Volume (CC)" value={stats.volume} />
            <Stat icon={Server} label="Services listed" value={String(stats.services)} />
            <Stat
              icon={Activity}
              label="Last settlement"
              value={stats.latest ? timeAgo(stats.latest) : "—"}
            />
          </section>

          <section aria-label="Run the AI agent" className="mt-8">
            <div className="rounded-lg border border-line bg-panel p-5">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent" aria-hidden />
                <h2 className="text-lg font-bold tracking-tight">Run the AI agent</h2>
              </div>
              <p className="mt-1 text-sm text-muted">
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
                  placeholder="Get me the current BTC price…"
                />
                <button
                  onClick={runAgent}
                  disabled={agentRunning}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-onaccent disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
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
            <div className="flex items-center justify-between gap-4">
              <SectionTitle>Services</SectionTitle>
              <button
                onClick={() => setShowList(true)}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-onaccent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                <Plus className="h-4 w-4" aria-hidden />
                List a service
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {listings.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          </section>

          <section aria-label="Live settlement activity" className="mt-10">
            <SectionTitle>Live activity</SectionTitle>
            <p className="mt-1 text-sm text-muted">
              Every row is a real transaction on Canton devnet, verified in the merchant wallet.
            </p>
            <div className="mt-4">
              {activity.length === 0 ? <EmptyActivity /> : <ActivityTable rows={activity} />}
            </div>
          </section>
        </>
      )}

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
    </main>
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
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Vanton" className="h-12 w-auto md:h-14" />
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          Agent payments on Canton
        </p>
        <h1 className="sr-only">Vanton</h1>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5">
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
            onClick={onDisconnect}
            title={walletParty}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-good/40 bg-good/10 px-3 text-sm font-medium text-good focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-good focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            <span className="h-2 w-2 rounded-full bg-good" aria-hidden />
            <span className="font-mono text-xs">{shortParty(walletParty)}</span>
            <span className="text-muted">·</span>
            <span className="text-xs">Disconnect</span>
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={connecting}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-panel px-4 text-sm font-medium text-text hover:border-accent/50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            <Wallet className="h-4 w-4" aria-hidden />
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}
        {walletError && <p className="max-w-56 text-right text-xs text-bad">{walletError}</p>}
      </div>
    </header>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold tracking-tight">{children}</h2>;
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
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p
        className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${accent ? "text-accent" : "text-text"}`}
      >
        {value}
      </p>
    </div>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{listing.name}</h3>
          <p className="mt-1 text-sm text-muted">{listing.description || "—"}</p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-panel2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
          {listing.category}
        </span>
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
        <span className="font-mono text-sm tabular-nums">
          <span className="font-semibold text-accent">{listing.priceAmount}</span>{" "}
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
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-160 border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-panel2 text-left">
            {["Settled", "Service", "Amount", "Payer", "On-ledger event"].map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reference} className="border-b border-line bg-panel last:border-b-0">
              <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                {timeAgo(r.settledAt)}
              </td>
              <td className="px-4 py-3 font-medium">{r.service}</td>
              <td className="px-4 py-3 font-mono tabular-nums">
                <span className="text-good">{r.price}</span> <span className="text-muted">CC</span>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted" title={r.sender}>
                {shortParty(r.sender)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted" title={r.eventId}>
                {shortEvent(r.eventId)}
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
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-panel py-12 text-center">
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

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${gateway}/listings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
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
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-2 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-onaccent disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
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
    <div className="mt-8 space-y-10" aria-hidden>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-panel motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-36 rounded-lg bg-panel motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-lg bg-panel motion-safe:animate-pulse" />
    </div>
  );
}
