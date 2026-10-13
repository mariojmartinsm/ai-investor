import Decimal from "decimal.js";

// Keep database numeric values as strings. The local constructor avoids changing
// decimal.js configuration for unrelated modules or requests.
export const PortfolioDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

export function parsePortfolioDecimal(value: unknown) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,12})?$/.test(value)) {
    throw new Error("Invalid portfolio decimal");
  }
  return new PortfolioDecimal(value);
}

export function parseValuationPrice(value: unknown) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/.test(value)) {
    throw new Error("Invalid valuation price");
  }
  const decimal = new PortfolioDecimal(value);
  if (!decimal.isFinite() || !decimal.gt(0)) throw new Error("Invalid valuation price");
  return decimal;
}
