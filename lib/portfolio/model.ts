import type { ReferenceQuote, ReferenceQuoteSnapshot, ReferenceFreshness } from "@/lib/markets/reference/types";
import { MARKET_PRODUCTS, type MarketProduct } from "@/lib/markets/types";
import { parsePortfolioDecimal, parseValuationPrice, PortfolioDecimal } from "@/lib/portfolio/decimal";

export type PortfolioAccount = {
  id: string;
  createdAt: string;
  startingCapital: string;
  eurBalance: string;
  btcBalance: string;
  ethBalance: string;
  ledgerEntryCount: number;
};

export type AssetValuation = {
  product: MarketProduct;
  symbol: "BTC" | "ETH";
  quantity: string;
  marketValue: string | null;
  allocationPercent: string | null;
  priceStatus: ReferenceFreshness;
  valuationPrice: ReferenceQuote | null;
  priceRequired: boolean;
};

export type PortfolioSummary = PortfolioAccount & {
  calculatedAt: string;
  valuationAt: string;
  valuationStatus: "fresh" | "stale" | "unavailable";
  totalValue: string | null;
  cumulativePnl: string | null;
  cumulativeReturnPercent: string | null;
  eurAllocationPercent: string | null;
  assets: AssetValuation[];
  investedCapital: string;
  realisedPnl: null;
  unrealisedPnl: null;
  cumulativeFees: string | null;
  costBasisStatus: "unavailable";
};

export type PortfolioLoadResult =
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; portfolio: PortfolioSummary };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate the RPC boundary before rendering financial information. RLS is still
// enforced in PostgreSQL; this also rejects unexpected or incomplete responses.
export function readPortfolioAccount(data: unknown, ownerId: string): PortfolioAccount | null {
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
  if (record.ledger_entry_count === 1 && (!eur.eq(starting) || !btc.isZero() || !eth.isZero())) {
    throw new Error("Initial funding does not reconcile");
  }
  return {
    id: record.id,
    createdAt: new Date(record.created_at).toISOString(),
    startingCapital: starting.toFixed(12),
    eurBalance: eur.toFixed(12),
    btcBalance: btc.toFixed(12),
    ethBalance: eth.toFixed(12),
    ledgerEntryCount: record.ledger_entry_count,
  };
}

function percentage(numerator: InstanceType<typeof PortfolioDecimal>, denominator: InstanceType<typeof PortfolioDecimal>) {
  return denominator.isZero() ? null : numerator.dividedBy(denominator).times(100).toFixed(8);
}

export function valuePortfolio(
  account: PortfolioAccount,
  references: ReferenceQuoteSnapshot[],
  calculatedAt: string,
): PortfolioSummary {
  if (!Number.isFinite(Date.parse(calculatedAt))) throw new Error("Invalid valuation timestamp");
  const eur = parsePortfolioDecimal(account.eurBalance);
  const balances = new Map<MarketProduct, InstanceType<typeof PortfolioDecimal>>([
    ["BTC-EUR", parsePortfolioDecimal(account.btcBalance)],
    ["ETH-EUR", parsePortfolioDecimal(account.ethBalance)],
  ]);
  const referenceMap = new Map(references.map((reference) => [reference.product, reference]));
  if (referenceMap.size !== MARKET_PRODUCTS.length || MARKET_PRODUCTS.some((product) => !referenceMap.has(product))) {
    throw new Error("Incomplete valuation references");
  }

  let unavailable = false;
  let stale = false;
  const markTimes: number[] = [];
  const assetValues = new Map<MarketProduct, InstanceType<typeof PortfolioDecimal> | null>();
  const assets = MARKET_PRODUCTS.map((product): AssetValuation => {
    const quantity = balances.get(product)!;
    const reference = referenceMap.get(product)!;
    const priceRequired = !quantity.isZero();
    let marketValue: string | null = "0.000000000000";
    if (priceRequired && (reference.status !== "fresh" || reference.quote === null)) {
      marketValue = null;
      if (reference.status === "stale") stale = true;
      else unavailable = true;
      assetValues.set(product, null);
    } else if (priceRequired) {
      const value = quantity.times(parseValuationPrice(reference.quote!.price));
      marketValue = value.toFixed(12);
      assetValues.set(product, value);
      markTimes.push(Date.parse(reference.quote!.exchangeAt ?? reference.quote!.fetchedAt));
    } else {
      assetValues.set(product, new PortfolioDecimal(0));
    }
    return {
      product,
      symbol: product === "BTC-EUR" ? "BTC" : "ETH",
      quantity: quantity.toFixed(12),
      marketValue,
      allocationPercent: null,
      priceStatus: reference.status,
      valuationPrice: reference.quote,
      priceRequired,
    };
  });

  const valuationStatus = unavailable ? "unavailable" : stale ? "stale" : "fresh";
  const total = valuationStatus === "fresh"
    ? assets.reduce((sum, asset) => sum.plus(assetValues.get(asset.product)!), eur)
    : null;
  if (total !== null) {
    for (const asset of assets) asset.allocationPercent = percentage(assetValues.get(asset.product)!, total);
  }
  const starting = parsePortfolioDecimal(account.startingCapital);
  const pnl = total?.minus(starting) ?? null;
  const valuationAt = markTimes.length === 0
    ? new Date(calculatedAt).toISOString()
    : new Date(Math.min(...markTimes)).toISOString();

  return {
    ...account,
    calculatedAt: new Date(calculatedAt).toISOString(),
    valuationAt,
    valuationStatus,
    totalValue: total?.toFixed(12) ?? null,
    cumulativePnl: pnl?.toFixed(12) ?? null,
    cumulativeReturnPercent: pnl === null ? null : percentage(pnl, starting),
    eurAllocationPercent: total === null ? null : percentage(eur, total),
    assets,
    investedCapital: starting.toFixed(12),
    realisedPnl: null,
    unrealisedPnl: null,
    cumulativeFees: account.ledgerEntryCount === 1 ? "0.000000000000" : null,
    costBasisStatus: "unavailable",
  };
}
