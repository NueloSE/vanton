"use client";

import { Component, lazy, Suspense, type ReactNode } from "react";

// Browser-only WebGL embed — lazy-loaded client-side so it never blocks first
// paint. Loaded via React.lazy (not next/dynamic) to resolve cleanly under the
// package's export conditions. The caller wraps this in a pointer-events-none
// layer so the scene is purely decorative and can't capture scroll or clicks.
const Spline = lazy(() => import("@splinetool/react-spline"));

// The project's own 3D scene (shared with confidium).
const SCENE = "https://prod.spline.design/Slk6b8kz3LRlKiyk/scene.splinecode";

// If the runtime or scene fails to load, render nothing — the hero still reads
// well on the solid ink background beneath it.
class SafeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function SplineBackground() {
  return (
    <SafeBoundary>
      <Suspense fallback={<div className="h-full w-full bg-ink" />}>
        <Spline scene={SCENE} className="h-full w-full" />
      </Suspense>
    </SafeBoundary>
  );
}
