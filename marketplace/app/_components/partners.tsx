"use client";

/**
 * Ecosystem / sponsor marquee, built on React Bits' LogoLoop.
 *
 * Logos live in marketplace/public/partners/ (sponsor1..sponsor11). They are
 * light marks on solid black, so the `partner-loop` class (see globals.css)
 * applies `mix-blend-mode: lighten` to drop the black backgrounds.
 */

import { LogoLoop } from "./logo-loop";

const partners = [
  { src: "/partners/sponsor1.png", alt: "Canton", title: "Canton" },
  { src: "/partners/sponsor2.png", alt: "Canton Foundation", title: "Canton Foundation" },
  { src: "/partners/sponsor3.png", alt: "Bitsafe", title: "Bitsafe" },
  { src: "/partners/sponsor4.png", alt: "cBTC by Bitsafe", title: "cBTC" },
  { src: "/partners/sponsor5.png", alt: "onRails", title: "onRails" },
  { src: "/partners/sponsor6.png", alt: "cETH", title: "cETH" },
  { src: "/partners/sponsor7.png", alt: "PixelPlex", title: "PixelPlex" },
  { src: "/partners/sponsor8.png", alt: "CC View", title: "CC View" },
  { src: "/partners/sponsor9.png", alt: "Console Wallet", title: "Console Wallet" },
  { src: "/partners/sponsor10.png", alt: "Ginie", title: "Ginie" },
  { src: "/partners/sponsor11.png", alt: "Dev Web3 Dogda", title: "Dev Web3 Dogda" },
];

export function Partners() {
  return (
    <LogoLoop
      logos={partners}
      speed={32}
      direction="left"
      logoHeight={40}
      gap={64}
      fadeOut
      fadeOutColor="#0a0f1c"
      scaleOnHover
      ariaLabel="Vanton ecosystem partners"
      className="partner-loop overflow-hidden"
    />
  );
}
