import {
  ArrowLeftRight,
  Bot,
  ChartNoAxesCombined,
  LayoutDashboard,
  Settings,
  TrendingUp,
} from "lucide-react";

export const navigationItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: TrendingUp },
  { href: "/agent", label: "AI Agent", icon: Bot },
  { href: "/trades", label: "Trades", icon: ArrowLeftRight },
  { href: "/performance", label: "Performance", icon: ChartNoAxesCombined },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;
