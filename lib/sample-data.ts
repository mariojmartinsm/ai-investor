// Display-only fixtures. No persisted portfolio or financial arithmetic exists in M0.
export const samplePortfolio = {
  value: "€500.00",
  cash: "€500.00",
  cryptoValue: "€0.00",
} as const;

export const sampleAssets = [
  {
    name: "Bitcoin",
    symbol: "BTC",
    product: "BTC-EUR",
    holdings: "0.00000000 BTC",
    value: "€0.00",
  },
  {
    name: "Ethereum",
    symbol: "ETH",
    product: "ETH-EUR",
    holdings: "0.00000000 ETH",
    value: "€0.00",
  },
] as const;
