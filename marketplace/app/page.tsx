/**
 * Vanton landing — the first thing a visitor sees.
 *
 * Tells a first-time visitor what Vanton is in five seconds, then hands them off
 * to the live marketplace at /app. Static, no data fetching: every real number
 * lives in the dashboard, which reads it from the gateway/ledger. The mockups
 * below are faithful, non-live replicas of the actual product surfaces.
 */

import Link from "next/link";
import { SiteFooter } from "./_components/site-footer";
import { Partners } from "./_components/partners";
import { SplineBackground } from "./_components/spline-background";
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  Coins,
  EyeOff,
  ListPlus,
  Lock,
  Network,
  Search,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from "lucide-react";

const REPO = "https://github.com/NueloSE/vanton";

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-onaccent transition-[background-color,transform] hover:bg-accent/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

const secondaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-md border border-line bg-panel px-5 text-sm font-medium text-text transition-colors hover:border-accent/50 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

const eyebrow =
  "inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-accent";

const FLOW = [
  {
    n: "01",
    icon: ListPlus,
    title: "List a service",
    body: "A provider registers an API or data feed and sets a price per call.",
  },
  {
    n: "02",
    icon: Search,
    title: "An agent discovers it",
    body: "An AI agent reads the marketplace and picks the services its task needs.",
  },
  {
    n: "03",
    icon: Zap,
    title: "It pays per call",
    body: "Each call settles on Canton, under a budget the ledger enforces.",
  },
  {
    n: "04",
    icon: Wallet,
    title: "You earn",
    body: "Payment lands in the provider's wallet on-ledger, seen only by both parties.",
  },
];

export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Sticky top nav — full-bleed, solid (no glass), on-brand. */}
      <header className="sticky top-0 z-40 border-b border-line bg-ink/95">
        <div className="flex items-center justify-between px-5 py-4 md:px-8 lg:px-10">
          <div className="flex items-center gap-3 md:gap-4">
            <Link
              href="/"
              aria-label="Vanton home"
              className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-clean.png" alt="Vanton" className="h-11 w-auto md:h-12" />
            </Link>
            <span className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted sm:inline-flex">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-good" aria-hidden />
              Live on Canton devnet
            </span>
          </div>
          <nav className="flex items-center gap-2 sm:gap-3">
            <a
              href="#how"
              className="hidden h-10 items-center rounded-md px-3 text-sm font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink sm:inline-flex"
            >
              How it works
            </a>
            <Link href="/app" className={`${primaryBtn} h-10`}>
              Launch marketplace
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — decorative floating 3D scene behind the content (Vanton-tinted). */}
        <section className="relative overflow-hidden border-b border-line bg-ink">
          {/* 3D background — pointer-events-none so it never captures scroll/clicks */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ filter: "hue-rotate(-78deg) saturate(1.1) brightness(0.9)" }}
          >
            <SplineBackground />
          </div>
          {/* Even, gentle scrim so the scene reads across the whole hero, plus a
              soft left reinforcement to keep the headline/pills legible. */}
          <div className="pointer-events-none absolute inset-0 z-1 bg-ink/40" />
          <div className="pointer-events-none absolute inset-0 z-1 bg-linear-to-r from-ink/45 via-transparent to-transparent" />

          <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <span
                className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-line bg-panel/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted"
                style={{ animationDelay: "0.05s" }}
              >
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-good" aria-hidden />
                Agent payments on Canton
              </span>
              <h1
                className="animate-fade-up mt-5 text-[clamp(2.5rem,6.5vw,4.25rem)] font-bold leading-[1.05] tracking-tight"
                style={{ animationDelay: "0.12s" }}
              >
                The marketplace where AI agents{" "}
                <span className="text-accent">hire and pay</span> each other.
              </h1>
              <p
                className="animate-fade-up mt-5 max-w-xl text-lg leading-relaxed text-muted"
                style={{ animationDelay: "0.22s" }}
              >
                Agents discover API and data services and pay per call in real
                Canton assets —{" "}
                <span className="font-medium text-text">CC, cBTC, cETH</span> —
                settled on-ledger. Spending limits the ledger enforces, and
                payments only the two parties can see. Private by default, unlike
                public chains.
              </p>
              <div
                className="animate-fade-up mt-8 flex flex-wrap items-center gap-3"
                style={{ animationDelay: "0.32s" }}
              >
                <Link href="/app" className={`${primaryBtn} h-11`}>
                  Launch marketplace
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href="#how" className={`${secondaryBtn} h-11`}>
                  See how it works
                </a>
              </div>
              <div
                className="animate-fade-up mt-9 flex flex-wrap gap-2"
                style={{ animationDelay: "0.42s" }}
              >
                <HeroPill icon={ShieldCheck}>Ledger-enforced budgets</HeroPill>
                <HeroPill icon={Coins}>CC · cBTC · cETH</HeroPill>
                <HeroPill icon={EyeOff}>Private by default</HeroPill>
                <HeroPill icon={Zap}>Real on-ledger settlement</HeroPill>
              </div>
            </div>

            {/* Signature visual: the 402 → 200 wire motif + a live-settlement ticker. */}
            <div
              className="animate-fade-up flex flex-col gap-4"
              style={{ animationDelay: "0.5s" }}
            >
              <WireCard />
              <LiveTicker />
            </div>
          </div>
        </section>

        {/* Two-sided flow */}
        <section className="bg-dotgrid border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <p className={eyebrow}>
              <Network className="h-3.5 w-3.5" aria-hidden />
              A two-sided marketplace
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              Providers list, agents hire.
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
              One side lists paid endpoints; the other spends a budget the ledger
              keeps honest. Four moves take a service from listing to payout.
            </p>
            <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {FLOW.map((step, i) => (
                <FlowStep key={step.n} {...step} last={i === FLOW.length - 1} />
              ))}
            </ol>
          </div>
        </section>

        {/* What runs under every call — alternating feature rows with real mockups */}
        <section id="how" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <div className="max-w-2xl">
              <p className={eyebrow}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                What runs under every call
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                Machine commerce, priced per call — and enforced by the ledger.
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted">
                Four properties public chains can&apos;t give agents. Here&apos;s
                what each one looks like in the product.
              </p>
            </div>

            <div className="mt-14 space-y-16 md:mt-20 md:space-y-24">
              <FeatureRow
                eyebrow="Settle"
                icon={Coins}
                title="Every call is a real payment."
                body="No invoices, no monthly bills. An agent discovers a service, and each call settles a token transfer to the provider on Canton — one real ledger state change per call. The transfer is the receipt."
                mock={<ListingMock />}
              />
              <FeatureRow
                eyebrow="Enforce"
                icon={ShieldCheck}
                title="The ledger stops overspending."
                body="An agent's budget is a Canton mandate, not a setting the app can wave through. Every call is authorized on-ledger against the cap first; when the budget is spent, the network itself refuses the next call — no charge, no exception."
                mock={<MandateMock />}
                reverse
              />
              <FeatureRow
                eyebrow="Privacy"
                icon={EyeOff}
                title="Payments only two parties can see."
                body="Canton's sub-transaction privacy keeps each settlement visible to the payer and the provider — and no one else. There's no public payment graph to scrape: an outsider on the same network sees nothing."
                mock={<PrivacyMock />}
              />
              <FeatureRow
                eyebrow="Assets"
                icon={Boxes}
                title="Settle in CC, cBTC, or cETH."
                body="Price a service in Canton Coin or in wrapped BTC and ETH, and agents pay in the same asset. Each is a real two-party token transfer the gateway verifies on-ledger before the call is served."
                mock={<AssetsMock />}
                reverse
              />
            </div>

            <div className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-8 text-sm text-muted">
              <span className="text-muted/70">Also:</span>
              <Link
                href="/app"
                className="inline-flex items-center gap-1 rounded transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                Run the demo agent
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
              <Link
                href="/app"
                className="inline-flex items-center gap-1 rounded transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                List a service
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                Read the source
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </div>
        </section>

        {/* Ecosystem / partners marquee — full-bleed */}
        <section aria-label="Partners" className="border-t border-line py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-4 text-center md:px-6">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
              Ecosystem
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
              Our partners
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
              Built on the Canton Network, alongside the teams behind HackCanton
              Season 2.
            </p>
          </div>
          <div className="relative mt-12 w-full">
            <Partners />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function HeroPill({
  icon: Icon,
  children,
}: {
  icon: typeof Lock;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel/60 px-3 py-1.5 text-xs font-medium text-muted">
      <Icon className="h-3.5 w-3.5 text-accent" aria-hidden />
      {children}
    </span>
  );
}

/* ---- Hero signature: the 402 → 200 wire motif (amber 402, teal 200). ---- */
function WireCard() {
  return (
    <div className="rounded-xl border border-line bg-panel p-5 font-mono text-sm md:p-6">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted">
          402 settlement · live path
        </span>
        <span className="pulse-dot h-2 w-2 rounded-full bg-good" aria-hidden />
      </div>
      <div className="mt-4 space-y-2.5 text-muted">
        <WireLine actor="agent">
          GET <span className="text-text">/btc-price</span>
        </WireLine>
        <WireLine actor="gateway">
          <span className="text-accent">402 Payment Required</span>
        </WireLine>
        <WireLine actor="agent">
          pays <span className="text-text">0.01 CC</span> on Canton
        </WireLine>
        <WireLine actor="ledger">
          checks mandate · <span className="text-good">authorized</span>
        </WireLine>
        <WireLine actor="gateway">
          <span className="text-good">200 OK</span> + data
        </WireLine>
      </div>
      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
        One real transaction on Canton per paid call — verified on-ledger before
        the service is served.
      </p>
    </div>
  );
}

function WireLine({
  actor,
  children,
}: {
  actor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-16 shrink-0 text-text">{actor}</span>
      <span aria-hidden className="text-muted">
        →
      </span>
      <span>{children}</span>
    </div>
  );
}

function LiveTicker() {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Recent settlements
        </span>
        <span className="pulse-dot h-2 w-2 rounded-full bg-good" aria-hidden />
      </div>
      <div className="mt-3 space-y-2 font-mono text-xs tabular-nums">
        <TickRow service="BTC spot price" amount="0.01" asset="CC" />
        <TickRow service="ETH momentum signal" amount="0.002" asset="cETH" />
      </div>
    </div>
  );
}

function TickRow({
  service,
  amount,
  asset,
}: {
  service: string;
  amount: string;
  asset: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-panel2 px-2.5 py-1.5">
      <span className="truncate text-muted">{service}</span>
      <span className="shrink-0">
        <span className="text-good">{amount}</span>{" "}
        <span className="text-muted">{asset}</span>
      </span>
    </div>
  );
}

/* ---- Alternating feature row: copy on one side, product mockup on the other ---- */
function FeatureRow({
  eyebrow: eyebrowText,
  icon: Icon,
  title,
  body,
  mock,
  reverse = false,
}: {
  eyebrow: string;
  icon: typeof Lock;
  title: string;
  body: string;
  mock: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={reverse ? "lg:order-2" : undefined}>
        <p className={eyebrow}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {eyebrowText}
        </p>
        <h3 className="mt-4 text-2xl font-bold tracking-tight md:text-[2rem] md:leading-[1.15]">
          {title}
        </h3>
        <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
          {body}
        </p>
      </div>
      <div
        className={`flex justify-center lg:justify-end ${
          reverse ? "lg:order-1 lg:justify-start" : ""
        }`}
      >
        <div className="relative w-full max-w-sm">
          {/* Soft amber light behind the mock (subtle depth, not a fill). */}
          <div
            aria-hidden
            className="absolute -inset-5 -z-10 rounded-4xl bg-accent/5 blur-2xl"
          />
          {mock}
        </div>
      </div>
    </div>
  );
}

/* ---- Product mockups (static replicas of the real dashboard surfaces) ---- */

function ListingMock() {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">BTC Spot Price</h4>
          <p className="mt-1 text-sm text-muted">
            Live BTC/USD, refreshed on every call.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-panel2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
          analytics
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 font-mono text-sm tabular-nums">
        <span>
          <span className="font-semibold text-accent">0.01</span>{" "}
          <span className="text-muted">CC / call</span>
        </span>
        <span className="text-xs text-muted">provider::1220…a4f</span>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-good/25 bg-good/5 px-3 py-2 text-xs">
        <Check className="h-3.5 w-3.5 shrink-0 text-good" aria-hidden />
        <span className="text-muted">
          agent paid{" "}
          <span className="font-mono tabular-nums text-good">0.01 CC</span> ·
          settled on Canton
        </span>
      </div>
    </div>
  );
}

function MandateMock() {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Agent budget · on-ledger
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent">
          <Lock className="h-3 w-3" aria-hidden /> mandate
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-4 font-mono tabular-nums">
        <span className="text-2xl font-semibold text-text">
          0.02 <span className="text-sm text-accent">CC</span>
        </span>
        <span className="text-xs text-muted">cap 0.01 / call</span>
      </div>
      <div className="mt-4 space-y-1.5 font-mono text-xs">
        <MockCall label="call 1" amount="0.01 CC" />
        <MockCall label="call 2" amount="0.01 CC" />
        <MockCall label="call 3" rejected />
      </div>
    </div>
  );
}

function MockCall({
  label,
  amount,
  rejected = false,
}: {
  label: string;
  amount?: string;
  rejected?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 ${
        rejected ? "border-bad/30 bg-bad/5" : "border-line bg-panel2"
      }`}
    >
      <span className="text-muted">{label}</span>
      {rejected ? (
        <span className="inline-flex items-center gap-1 text-bad">
          <X className="h-3 w-3" aria-hidden /> rejected · budget spent
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className="tabular-nums text-text">{amount}</span>
          <Check className="h-3 w-3 text-good" aria-hidden />
        </span>
      )}
    </div>
  );
}

function PrivacyMock() {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel p-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          You &amp; the provider see
        </p>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2 px-3 py-2.5 font-mono text-xs tabular-nums">
          <span className="text-muted">ETH signal · 12s ago</span>
          <span>
            <span className="text-good">0.002</span>{" "}
            <span className="text-muted">cETH</span>
          </span>
        </div>
      </div>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          An outsider sees
        </p>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2 px-3 py-2.5 font-mono text-xs tabular-nums">
          <span className="encrypted-blur text-muted" aria-hidden>
            ETH signal · 12s ago
          </span>
          <span className="encrypted-blur" aria-hidden>
            <span className="text-good">0.002</span>{" "}
            <span className="text-muted">cETH</span>
          </span>
        </div>
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted">
          <EyeOff className="h-3 w-3" aria-hidden /> no records · nothing to
          scrape
        </p>
      </div>
    </div>
  );
}

function AssetsMock() {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        Agent wallet
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <AssetChip label="CC" value="128.40" />
        <AssetChip label="cBTC" value="0.0140" />
        <AssetChip label="cETH" value="0.220" />
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-good/25 bg-good/5 px-3 py-2 text-xs">
        <Check className="h-3.5 w-3.5 shrink-0 text-good" aria-hidden />
        <span className="text-muted">
          paid{" "}
          <span className="font-mono tabular-nums text-good">0.0004 cBTC</span> ·
          verified on-ledger
        </span>
      </div>
    </div>
  );
}

function AssetChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 text-center">
      <div className="font-mono text-sm font-semibold tabular-nums text-text">
        {value}
      </div>
      <div className="font-mono text-[11px] text-accent">{label}</div>
    </div>
  );
}

function FlowStep({
  n,
  icon: Icon,
  title,
  body,
  last = false,
}: {
  n: string;
  icon: typeof Lock;
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <li className="relative flex flex-col gap-6 rounded-xl border border-line bg-panel p-6">
      <div className="flex items-center justify-between">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-panel2 text-accent">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="font-mono text-sm font-medium tracking-[0.2em] text-muted/70">
          {n}
        </span>
      </div>
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      </div>
      {!last && (
        <span
          aria-hidden
          className="absolute top-1/2 -right-5 z-10 hidden -translate-y-1/2 lg:block"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full border border-line bg-panel2 text-muted">
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </span>
      )}
    </li>
  );
}
