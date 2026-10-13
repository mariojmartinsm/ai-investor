import Decimal from "decimal.js";

const MarketDecimal = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });

export function marketDecimal(value: string) {
  if (!/^-?(?:0|[1-9]\d{0,19})(?:\.\d{1,20})?$/.test(value)) throw new Error("Invalid market decimal");
  return new MarketDecimal(value);
}

function group(value: string) {
  const [integer, fraction] = value.split(".");
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
}

export function formatMarketEur(value: string) {
  const decimal = marketDecimal(value);
  if (!decimal.gt("0")) throw new Error("Invalid market price");
  // Preserve tiny positive prices rather than rendering a misleading zero.
  return `€${group(decimal.gte("0.01") ? decimal.toFixed(2) : decimal.toFixed())}`;
}

export function formatMarketChange(value: string) {
  const decimal = marketDecimal(value).toDecimalPlaces(2);
  return `${decimal.isZero() ? "" : decimal.isNegative() ? "−" : "+"}${group(decimal.abs().toFixed(2))}%`;
}

export function formatMarketVolume(value: string) {
  const decimal = marketDecimal(value);
  if (decimal.isNegative()) throw new Error("Invalid market volume");
  return group(decimal.toFixed());
}

export function formatMarketTime(value: string | null) {
  if (value === null) return "Not provided";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid market timestamp");
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
