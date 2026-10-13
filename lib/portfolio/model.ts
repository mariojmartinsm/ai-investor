import { parsePortfolioDecimal } from "@/lib/portfolio/decimal";

export type PortfolioSummary = {
  id: string;
  createdAt: string;
  startingCapital: string;
  eurBalance: string;
  btcBalance: string;
  ethBalance: string;
  totalValue: string;
  cumulativePnl: string;
};

export type PortfolioLoadResult =
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; portfolio: PortfolioSummary };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate the RPC boundary before rendering financial information. RLS is still
// enforced in PostgreSQL; this also rejects unexpected or incomplete responses.
export function readPortfolioSummary(data: unknown, ownerId: string): PortfolioSummary | null {
  if (!Array.isArray(data) || data.length > 1) throw new Error("Invalid portfolio response");
  if (data.length === 0) return null;
  const row: unknown = data[0];
  if (!row || typeof row !== "object") throw new Error("Invalid portfolio row");
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || !uuid.test(record.id) || record.owner_id !== ownerId || record.mode !== "DRY_RUN") {
    throw new Error("Invalid portfolio ownership or mode");
  }
  if (typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at))) {
    throw new Error("Invalid portfolio timestamp");
  }
  const starting = parsePortfolioDecimal(record.starting_capital);
  const eur = parsePortfolioDecimal(record.eur_balance);
  const btc = parsePortfolioDecimal(record.btc_balance);
  const eth = parsePortfolioDecimal(record.eth_balance);
  if (!starting.eq("500") || eur.isNegative() || btc.isNegative() || eth.isNegative()) {
    throw new Error("Invalid portfolio balances");
  }
  if (record.initial_funding_count === 0 && record.ledger_entry_count === 0 &&
      eur.isZero() && btc.isZero() && eth.isZero()) {
    return null; // An existing, empty foundation row is safe to initialize too.
  }
  if (record.initial_funding_count !== 1 || typeof record.ledger_entry_count !== "number" ||
      !Number.isInteger(record.ledger_entry_count) || record.ledger_entry_count < 1) {
    throw new Error("Portfolio funding is not reconciled");
  }
  // M1 can value an all-cash portfolio without inventing BTC/ETH market prices.
  // M2 must supply timestamped quotes before any nonzero crypto can be valued.
  if (!btc.isZero() || !eth.isZero()) throw new Error("Market valuation is unavailable");
  if (record.ledger_entry_count === 1 && !eur.eq(starting)) {
    throw new Error("Initial funding does not reconcile");
  }
  return {
    id: record.id,
    createdAt: new Date(record.created_at).toISOString(),
    startingCapital: starting.toFixed(12),
    eurBalance: eur.toFixed(12),
    btcBalance: btc.toFixed(12),
    ethBalance: eth.toFixed(12),
    totalValue: eur.toFixed(12),
    cumulativePnl: eur.minus(starting).toFixed(12),
  };
}
