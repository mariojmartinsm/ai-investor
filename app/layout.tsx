import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI Investor", template: "%s | AI Investor" },
  description: "AI Investor local prototype. A sample virtual portfolio in Dry Run mode. Live mode is unavailable.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
