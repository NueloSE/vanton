"use client";

/**
 * Vanton marketplace — one screen, two jobs:
 *   1. Browse the services agents can buy (from the gateway /listings).
 *   2. Watch real payments settle on Canton, live (from /activity, polled).
 *
 * Everything shown is read from the gateway, which reads the ledger — no
 * fabricated numbers anywhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, RefreshCw, Server, Wallet, Zap } from "lucide-react";

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
      setPhase((p) => (p === "ready" ? p : "error")); // keep data if we had it
    }
  }, []);

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
      <Header live={phase === "ready"} lastFetch={lastFetch} />

      {phase === "loading" && <PageSkeleton />}

      {phase === "error" && (
        <div className="mt-10 flex flex-col items-start gap-3 rounded-lg border border-bad/30 bg-bad/5 p-5">
          <p className="text-sm font-medium text-bad">Can&apos;t reach the Vanton gateway</p>
          <p className="text-sm text-muted">
            The gateway at <span className="font-mono">{GATEWAY}</span> isn&apos;t responding. Start
            it with <span className="font-mono">npm run dev</span> in <span className="font-mono">gateway/</span>, then retry.
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

          <section aria-label="Service listings" className="mt-10">
            <SectionTitle>Services</SectionTitle>
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
    </main>
  );
}

function Header({ live, lastFetch }: { live: boolean; lastFetch: Date | null }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          Agent payments on Canton
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight md:text-4xl">Vanton</h1>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5">
        <span
          className={`pulse-dot h-2 w-2 rounded-full ${live ? "bg-good" : "bg-muted"}`}
          aria-hidden
        />
        <span className="font-mono text-xs text-muted">
          {live ? `devnet · updated ${lastFetch ? timeAgo(lastFetch.toISOString()) : "now"}` : "connecting…"}
        </span>
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
          <p className="mt-1 text-sm text-muted">{listing.description}</p>
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
      <table className="w-full min-w-[640px] border-collapse text-sm">
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
                <span className="text-good">{r.price}</span>{" "}
                <span className="text-muted">CC</span>
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
          <span className="font-mono text-xs">cd agent && npm start</span>
        </p>
      </div>
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
