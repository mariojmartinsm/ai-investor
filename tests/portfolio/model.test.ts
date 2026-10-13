import { describe, expect, it } from "vitest";

import type { ReferenceQuoteSnapshot } from "@/lib/markets/reference/types";
import { parsePortfolioDecimal } from "@/lib/portfolio/decimal";
import { formatAllocation, formatEur, formatPercentage, formatQuantity } from "@/lib/portfolio/format";
import { readPortfolioAccount, valuePortfolio } from "@/lib/portfolio/model";

const ownerId = "a1111111-1111-4111-8111-111111111111";
const row = {
  id: "b1111111-1111-4111-8111-111111111111",
  owner_id: ownerId,
  mode: "DRY_RUN",
  starting_capital: "500.000000000000",
  created_at: "2026-10-13T08:00:00+00:00",
  eur_balance: "500.000000000000",
  btc_balance: "0",
  eth_balance: "0",
  initial_funding_count: 1,
  ledger_entry_count: 1,
};
const now = "2026-10-13T20:00:00.000Z";

function references(status: "fresh" | "stale" | "unavailable" = "fresh"): ReferenceQuoteSnapshot[] {
  return (["BTC-EUR", "ETH-EUR"] as const).map((product, index) => ({
    product,
    status,
    quote: status === "unavailable" ? null : {
      id: `${index + 1}1111111-1111-4111-8111-111111111111`,
      product,
      price: product === "BTC-EUR" ? "60000" : "4000",
      priceKind: product === "BTC-EUR" ? "last_trade" : "reference",
      bid: product === "BTC-EUR" ? "59999" : null,
      ask: product === "BTC-EUR" ? "60001" : null,
      executionReferenceKind: product === "BTC-EUR" ? "public_bid_ask" : "indicative_reference",
      source: "Coinbase Advanced Trade public API",
      exchangeAt: product === "BTC-EUR" ? "2026-10-13T19:59:55.000Z" : null,
      fetchedAt: "2026-10-13T20:00:00.000Z",
      freshUntil: product === "BTC-EUR" ? "2026-10-13T20:01:55.000Z" : "2026-10-13T20:02:00.000Z",
      validationStatus: "validated",
    },
  }));
}

describe("ledger-backed portfolio boundary", () => {
  it("keeps an uninitialized portfolio empty instead of inventing €500", () => {
    expect(readPortfolioAccount([], ownerId)).toBeNull();
  });

  it("recognizes an existing empty unfunded portfolio as ready for initialization", () => {
    expect(readPortfolioAccount([{ ...row, eur_balance: "0", initial_funding_count: 0, ledger_entry_count: 0 }], ownerId)).toBeNull();
  });

  it("reconciles the initial funding without deriving a market value at the database boundary", () => {
    expect(readPortfolioAccount([row], ownerId)).toEqual({
      id: row.id,
      createdAt: "2026-10-13T08:00:00.000Z",
      startingCapital: "500.000000000000",
      eurBalance: "500.000000000000",
      btcBalance: "0.000000000000",
      ethBalance: "0.000000000000",
      ledgerEntryCount: 1,
    });
  });

  it.each([
    null, {}, [null], [row, row],
    [{ ...row, owner_id: "another-owner" }],
    [{ ...row, id: "invalid" }],
    [{ ...row, mode: "LIVE" }],
    [{ ...row, created_at: "invalid" }],
    [{ ...row, starting_capital: "500.000000000001" }],
    [{ ...row, eur_balance: 500 }],
    [{ ...row, eur_balance: "-0.000000000001" }],
    [{ ...row, eur_balance: "Infinity" }],
    [{ ...row, btc_balance: "NaN" }],
    [{ ...row, eth_balance: "0.0000000000001" }],
    [{ ...row, initial_funding_count: 0 }],
    [{ ...row, initial_funding_count: 2 }],
    [{ ...row, ledger_entry_count: 0 }],
    [{ ...row, ledger_entry_count: "1" }],
    [{ ...row, ledger_entry_count: 1.5 }],
    [{ ...row, eur_balance: "499.999999999999" }],
    [{ ...row, btc_balance: "0.1" }],
  ])("fails closed on invalid, cross-owner or unreconciled responses %#", (data) => {
    expect(() => readPortfolioAccount(data, ownerId)).toThrow();
  });
});

describe("decimal-safe portfolio valuation", () => {
  it("values the hosted all-cash shape at €500 with zero return even without market quotes", () => {
    const account = readPortfolioAccount([row], ownerId)!;
    const valuation = valuePortfolio(account, references("unavailable"), now);
    expect(valuation).toMatchObject({
      valuationStatus: "fresh",
      totalValue: "500.000000000000",
      cumulativePnl: "0.000000000000",
      cumulativeReturnPercent: "0.00000000",
      eurAllocationPercent: "100.00000000",
      investedCapital: "500.000000000000",
      realisedPnl: null,
      unrealisedPnl: null,
      cumulativeFees: "0.000000000000",
      costBasisStatus: "unavailable",
    });
    expect(valuation.assets.map((asset) => ({ value: asset.marketValue, allocation: asset.allocationPercent })))
      .toEqual([{ value: "0.000000000000", allocation: "0.00000000" }, { value: "0.000000000000", allocation: "0.00000000" }]);
  });

  it("marks nonzero BTC and ETH to persisted prices with exact allocations and provenance", () => {
    const account = readPortfolioAccount([{
      ...row, eur_balance: "100", btc_balance: "0.005", eth_balance: "0.025", ledger_entry_count: 4,
    }], ownerId)!;
    const valuation = valuePortfolio(account, references(), now);
    expect(valuation).toMatchObject({
      valuationStatus: "fresh",
      valuationAt: "2026-10-13T19:59:55.000Z",
      totalValue: "500.000000000000",
      cumulativePnl: "0.000000000000",
      cumulativeReturnPercent: "0.00000000",
      eurAllocationPercent: "20.00000000",
      cumulativeFees: null,
    });
    expect(valuation.assets).toMatchObject([
      { product: "BTC-EUR", marketValue: "300.000000000000", allocationPercent: "60.00000000", priceStatus: "fresh",
        valuationPrice: { price: "60000", priceKind: "last_trade", executionReferenceKind: "public_bid_ask" } },
      { product: "ETH-EUR", marketValue: "100.000000000000", allocationPercent: "20.00000000", priceStatus: "fresh",
        valuationPrice: { price: "4000", priceKind: "reference", executionReferenceKind: "indicative_reference" } },
    ]);
    expect(account).toMatchObject({ eurBalance: "100.000000000000", btcBalance: "0.005000000000", ethBalance: "0.025000000000" });
  });

  it("preserves decimal precision and changes valuations without mutating balances", () => {
    const account = readPortfolioAccount([{
      ...row, eur_balance: "0", btc_balance: "0.000000000001", ledger_entry_count: 2,
    }], ownerId)!;
    const firstReferences = references();
    firstReferences[0].quote!.price = "9007199254740993.123456789012345678";
    const first = valuePortfolio(account, firstReferences, now);
    const secondReferences = references();
    secondReferences[0].quote!.price = "1";
    const second = valuePortfolio(account, secondReferences, now);
    expect(first.assets[0].marketValue).toBe("9007.199254740993");
    expect(second.assets[0].marketValue).toBe("0.000000000001");
    expect(account.btcBalance).toBe("0.000000000001");
  });

  it.each(["stale", "unavailable"] as const)("withholds NAV for a nonzero holding with a %s price", (status) => {
    const account = readPortfolioAccount([{ ...row, btc_balance: "0.1", ledger_entry_count: 2 }], ownerId)!;
    const valuation = valuePortfolio(account, references(status), now);
    expect(valuation).toMatchObject({ valuationStatus: status, totalValue: null, cumulativePnl: null, cumulativeReturnPercent: null, eurAllocationPercent: null });
    expect(valuation.assets[0].marketValue).toBeNull();
    expect(valuation.assets[1].marketValue).toBe("0.000000000000");
  });

  it("requires one reference state for each supported product", () => {
    const account = readPortfolioAccount([row], ownerId)!;
    expect(() => valuePortfolio(account, references().slice(0, 1), now)).toThrow("Incomplete valuation references");
  });
});

describe("decimal precision and display", () => {
  it("preserves quantities and large EUR values", () => {
    expect(formatQuantity("0.000000000001")).toBe("0.000000000001");
    expect(formatQuantity("0.100000000000")).toBe("0.1");
    expect(formatEur("9007199254740993.120000000000")).toBe("€9,007,199,254,740,993.12");
  });
  it("uses explicit half-up formatting", () => {
    expect(formatEur("500.005000000000")).toBe("€500.01");
    expect(formatEur("-0.005000000000")).toBe("−€0.01");
    expect(formatPercentage("1.23500000")).toBe("+1.24%");
    expect(formatAllocation("33.33500000")).toBe("33.34%");
  });
  it("reconciles signed decimal postings exactly", () => {
    const total = ["500", "0.1", "0.2", "-0.3", "-0.000000000001"]
      .reduce((sum, posting) => sum.plus(parsePortfolioDecimal(posting)), parsePortfolioDecimal("0"));
    expect(total.toFixed(12)).toBe("499.999999999999");
  });
  it.each([500, "NaN", "Infinity", "1e2", " 500", "01.0", "0.0000000000001", "10000000000000000"])
    ("rejects unsafe portfolio decimal inputs %#", (value) => expect(() => parsePortfolioDecimal(value)).toThrow());
});
