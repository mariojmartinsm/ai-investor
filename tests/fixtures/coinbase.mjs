import { createServer } from "node:http";

// Test-only public Coinbase contract. Production code keeps its fixed official
// origin; only the isolated E2E process forwards these four allowlisted URLs.
const products = {
  "BTC-EUR": {
    name: "Bitcoin",
    symbol: "BTC",
    price: "65000.12345678",
    change: "2.3456",
    volume: "123.456789123456",
    bid: "65000.12000000",
    ask: "65000.13000000",
  },
  "ETH-EUR": {
    name: "Ethereum",
    symbol: "ETH",
    price: "3200.45678912",
    change: "-1.2345",
    volume: "4567.123456789123",
    bid: "3200.45000000",
    ask: "3200.46000000",
  },
};

export function publicCoinbasePath(url) {
  if (url.origin !== "https://api.coinbase.com") return false;
  return /^\/api\/v3\/brokerage\/market\/products\/(BTC-EUR|ETH-EUR)(\/ticker)?$/.test(url.pathname);
}

export async function startCoinbaseFixture(port) {
  const statistics = { requests: 0, products: 0, tickers: 0, paths: [] };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");
    const send = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method === "GET" && url.pathname === "/__test/stats") {
      send(200, statistics);
      return;
    }
    const match = /^\/api\/v3\/brokerage\/market\/products\/(BTC-EUR|ETH-EUR)(\/ticker)?$/.exec(url.pathname);
    if (request.method !== "GET" || !match) {
      send(404, { error: "Unsupported public Coinbase fixture endpoint" });
      return;
    }
    const productId = match[1];
    const product = products[productId];
    statistics.requests += 1;
    statistics.paths.push(url.pathname);
    if (match[2]) {
      statistics.tickers += 1;
      send(200, {
        trades: [{
          trade_id: "1000",
          product_id: productId,
          price: product.price,
          size: "0.00100000",
          // Use the exchange clock, deliberately distinct from the later
          // application fetch timestamp. Never a fixed stale fixture date.
          time: new Date(Date.now() - 2_000).toISOString(),
          side: "BUY",
        }],
        best_bid: product.bid,
        best_ask: product.ask,
      });
      return;
    }
    statistics.products += 1;
    send(200, {
      product_id: productId,
      price: product.price,
      price_percentage_change_24h: product.change,
      volume_24h: product.volume,
      base_currency_id: product.symbol,
      quote_currency_id: "EUR",
      base_name: product.name,
      quote_name: "Euro",
      product_type: "SPOT",
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

export function installCoinbaseFixtureFetch(port) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!publicCoinbasePath(url)) return originalFetch(input, init);
    const local = `http://127.0.0.1:${port}${url.pathname}${url.search}`;
    const forwarded = input instanceof Request ? new Request(local, input) : local;
    return originalFetch(forwarded, init);
  };
}
