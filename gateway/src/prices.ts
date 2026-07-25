/**
 * Real market data for the demo provider services (btc-price, eth-signal).
 * Pulls live BTC/ETH USD prices from CoinGecko (free, no key), cached 30s with a
 * graceful fallback so a rate-limit or outage never breaks a paid call.
 */

let cache = { btc: 0, eth: 0, prevEth: 0, ts: 0 };

async function fetchPrices() {
  if (cache.btc && Date.now() - cache.ts < 30_000) return cache;
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(8000) },
    );
    const d = (await r.json()) as { bitcoin?: { usd: number }; ethereum?: { usd: number } };
    if (d.bitcoin?.usd && d.ethereum?.usd) {
      cache = { btc: d.bitcoin.usd, eth: d.ethereum.usd, prevEth: cache.eth || d.ethereum.usd, ts: Date.now() };
    }
  } catch {
    /* keep last good cache */
  }
  return cache;
}

export async function btcPrice() {
  const p = await fetchPrices();
  return { service: "btc-price", btcUsd: p.btc || null, paidIn: "cBTC", source: "coingecko" };
}

export async function ethSignal() {
  const p = await fetchPrices();
  const dir = p.eth >= p.prevEth ? "up" : "down";
  return {
    service: "eth-signal",
    ethUsd: p.eth || null,
    signal: p.eth ? `ETH $${p.eth.toLocaleString()} — momentum ${dir}` : "unavailable",
    paidIn: "cETH",
    source: "coingecko",
  };
}
