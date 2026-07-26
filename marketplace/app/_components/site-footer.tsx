import { ArrowUpRight } from "lucide-react";

const REPO = "https://github.com/NueloSE/vanton";

// Shared footer for both the landing (/) and the dashboard (/app), so the two
// stay identical. "How it works" points at /#how, which scrolls in place on the
// landing and navigates back to it from the dashboard.
export function SiteFooter() {
  const link =
    "rounded transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink";
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 md:flex-row md:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-clean.png" alt="Vanton" className="h-7 w-auto" />
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted">
          <a href="/#how" className={link}>
            How it works
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1 ${link}`}
          >
            GitHub
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </a>
          <span className="text-xs">HackCanton Season 2</span>
        </div>
      </div>
    </footer>
  );
}
