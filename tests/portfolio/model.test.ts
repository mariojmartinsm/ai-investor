import { describe, expect, it } from "vitest";

import { parsePortfolioDecimal } from "@/lib/portfolio/decimal";
import { formatEur, formatQuantity } from "@/lib/portfolio/format";
import { readPortfolioSummary } from "@/lib/portfolio/model";

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

describe("ledger-backed portfolio boundary", () => {
  it("keeps an uninitialized portfolio empty instead of inventing €500", () => {
    expect(readPortfolioSummary([], ownerId)).toBeNull();
  });

  it("recognizes an existing empty unfunded portfolio as ready for initialization", () => {
    expect(readPortfolioSummary([{
      ...row, eur_balance: "0", initial_funding_count: 0, ledger_entry_count: 0,
    }], ownerId)).toBeNull();
  });

  it("reconciles the initial funding to €500 EUR, zero crypto and zero P&L", () => {
    expect(readPortfolioSummary([row], ownerId)).toEqual({
      id: row.id,
      createdAt: "2026-10-13T08:00:00.000Z",
      startingCapital: "500.000000000000",
      eurBalance: "500.000000000000",
      btcBalance: "0.000000000000",
      ethBalance: "0.000000000000",
      totalValue: "500.000000000000",
      cumulativePnl: "0.000000000000",
    });
  });

  it("subtracts capital exactly without floating-point P&L drift", () => {
    const result = readPortfolioSummary([{ ...row, eur_balance: "499.999999999999", ledger_entry_count: 2 }], ownerId);
    expect(result?.totalValue).toBe("499.999999999999");
    expect(result?.cumulativePnl).toBe("-0.000000000001");
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
  ])("fails closed on invalid, cross-owner or unreconciled responses %#", (data) => {
    expect(() => readPortfolioSummary(data, ownerId)).toThrow();
  });

  it.each(["btc_balance", "eth_balance"])("does not fabricate NAV for unpriced %s", (currency) => {
    expect(() => readPortfolioSummary([{ ...row, [currency]: "0.000000000001", ledger_entry_count: 2 }], ownerId))
      .toThrow("Market valuation is unavailable");
  });
});

describe("decimal precision and display", () => {
  it("preserves the database's smallest asset increment", () => {
    expect(formatQuantity("0.000000000001")).toBe("0.000000000001");
    expect(formatQuantity("0.100000000000")).toBe("0.1");
    expect(formatQuantity("0.000000000000")).toBe("0");
  });

  it("preserves cents beyond the JavaScript safe integer range", () => {
    expect(formatEur("9007199254740993.120000000000")).toBe("€9,007,199,254,740,993.12");
    expect(formatQuantity("9007199254740993.000000000001")).toBe("9007199254740993.000000000001");
  });

  it("uses explicit half-up display rounding without changing the source balance", () => {
    const value = "500.005000000000";
    expect(formatEur(value)).toBe("€500.01");
    expect(formatEur("-0.005000000000")).toBe("−€0.01");
    expect(formatEur("-0.000000000001")).toBe("€0.00");
    expect(parsePortfolioDecimal(value).toFixed(12)).toBe(value);
  });

  it("reconciles signed decimal postings exactly", () => {
    const total = ["500", "0.1", "0.2", "-0.3", "-0.000000000001"]
      .reduce((sum, posting) => sum.plus(parsePortfolioDecimal(posting)), parsePortfolioDecimal("0"));
    expect(total.toFixed(12)).toBe("499.999999999999");
  });

  it.each([500, "NaN", "Infinity", "1e2", " 500", "01.0", "0.0000000000001", "10000000000000000"])
    ("rejects unsafe decimal inputs %#", (value) => {
      expect(() => parsePortfolioDecimal(value)).toThrow("Invalid portfolio decimal");
    });
});
