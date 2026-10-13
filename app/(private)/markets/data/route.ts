import { getMarkets } from "@/lib/markets/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getMarkets(), {
    headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" },
  });
}
