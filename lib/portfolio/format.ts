import { parsePortfolioDecimal, PortfolioDecimal } from "@/lib/portfolio/decimal";

export function formatEur(value: string) {
  const rounded = parsePortfolioDecimal(value).toDecimalPlaces(2, PortfolioDecimal.ROUND_HALF_UP);
  // Formatting decimal strings preserves amounts beyond Number.MAX_SAFE_INTEGER.
  const fixed = rounded.abs().toFixed(2);
  const [integer, fraction] = fixed.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded.isNegative() && !rounded.isZero() ? "−" : ""}€${grouped}.${fraction}`;
}

export function formatQuantity(value: string) {
  return parsePortfolioDecimal(value).toFixed(12).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

export function formatPercentage(value: string) {
  const decimal = new PortfolioDecimal(value).toDecimalPlaces(2, PortfolioDecimal.ROUND_HALF_UP);
  const sign = decimal.isZero() ? "" : decimal.isNegative() ? "−" : "+";
  return `${sign}${decimal.abs().toFixed(2)}%`;
}

export function formatAllocation(value: string) {
  return `${new PortfolioDecimal(value).toDecimalPlaces(2, PortfolioDecimal.ROUND_HALF_UP).toFixed(2)}%`;
}
