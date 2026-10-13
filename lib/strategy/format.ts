import Decimal from "decimal.js";

import { formatMarketEur, formatMarketTime } from "@/lib/markets/format";

const decimal = (value: string) => new Decimal(value);

export const formatIndicatorPrice = formatMarketEur;
export const formatIndicatorTime = formatMarketTime;
export const formatRsi = (value: string) => decimal(value).toFixed(2);
export const formatSignedPercent = (value: string) => {
  const amount = decimal(value).toDecimalPlaces(2);
  const sign = amount.isZero() ? "" : amount.isNegative() ? "−" : "+";
  return `${sign}${amount.abs().toFixed(2)}%`;
};
export const formatUnsignedPercent = (value: string) => `${decimal(value).toDecimalPlaces(2).toFixed(2)}%`;
