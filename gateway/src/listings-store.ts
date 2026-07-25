/**
 * Persist user-listed services so they survive a gateway restart. The 3 built-in
 * demo listings are always seeded in code; only listings added via POST /listings
 * are written here (data/listings.json, gitignored).
 */

import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "listings.json");

export interface StoredListing {
  id: string;
  name: string;
  provider: string;
  priceAmount: string;
  priceAsset: string;
  category: string;
  endpoint: string;
  description: string;
}

export function loadUserListings(): { listings: StoredListing[]; targets: Array<[string, string]> } {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { listings: [], targets: [] };
  }
}

export function saveUserListings(listings: StoredListing[], targets: Map<string, string>): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ listings, targets: [...targets] }, null, 2));
  } catch (e) {
    console.error("[gateway] could not persist listings:", (e as Error).message);
  }
}
