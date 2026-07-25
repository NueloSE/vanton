import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vanton — Agent Payments on Canton",
  description:
    "The marketplace where AI agents discover services and pay per call on Canton, under spend limits the ledger enforces.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
