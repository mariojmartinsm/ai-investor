import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER = "70000000-0000-4000-8000-000000000001";
const OTHER = "70000000-0000-4000-8000-000000000002";
type Role = "anon" | "authenticated" | "service_role";
let database: PGlite;

function indicators() {
  return {
    version: "TECHNICAL_V1", cutoff: "2026-10-13T00:00:00.000Z", latestCandleStart: "2026-10-12T00:00:00.000Z",
    latestClose: "65000.000000000000", sma20: "64000.000000000000", sma50: "63000.000000000000",
    rsi14: "55.00000000", momentum7: "2.00000000", momentum30: "5.00000000",
    volatility30Annualized: "35.00000000", inputCount: 90,
    inputStart: "2026-07-15T00:00:00.000Z", inputEnd: "2026-10-12T00:00:00.000Z",
  };
}

function preview(change: Record<string, unknown> = {}) {
  return [{
    product_id: "BTC-EUR", strategy_id: "BASELINE_V1", calculation_version: "TECHNICAL_V1",
    analysis_mode: "PREVIEW_ONLY", analysis_date: "2026-10-13", cutoff: "2026-10-13T00:00:00.000Z",
    latest_candle_start: "2026-10-12T00:00:00.000Z", signal: "BUY", indicators: indicators(),
    proposed_notional: "25.000000000000", proposed_quantity: null,
    explanation: "BUY candidate fixture", reason_codes: ["BUY_CONDITIONS_MET"],
    data_quality: "VALID", freshness: "CURRENT", input_count: 90,
    input_start: "2026-07-15T00:00:00.000Z", input_end: "2026-10-12T00:00:00.000Z",
    source: "Coinbase Advanced Trade public API", ai_status: "NOT_REQUESTED", risk_status: "NOT_EVALUATED", outcome: "ANALYSIS_ONLY",
    idempotency_key: "PREVIEW_ONLY:BASELINE_V1:BTC-EUR:2026-10-13T00:00:00.000Z", ...change,
  }];
}

async function asRole<T>(role: Role, userId: string | null, operation: () => Promise<T>, anonymous = false) {
  await database.exec("begin");
  try {
    await database.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [userId ?? "", JSON.stringify({ sub: userId, role, is_anonymous: anonymous })]);
    await database.exec(`set local role ${role}`);
    return await operation();
  } finally { await database.exec("rollback"); }
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(await readFile(fileURLToPath(new URL("./support/supabase-auth-shim.sql", import.meta.url)), "utf8"));
  const directory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
  for (const migration of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    await database.exec(await readFile(`${directory}/${migration}`, "utf8"));
  }
  await database.query("insert into auth.users (id) values ($1), ($2)", [OWNER, OTHER]);
  await database.query("insert into public.portfolios (owner_id) values ($1), ($2)", [OWNER, OTHER]);
}, 30_000);
afterAll(async () => database?.close());

describe("strategy preview persistence and security", () => {
  it("executes the hosted rollback fixture", async () => {
    const sql = await readFile(fileURLToPath(new URL("./hosted-strategy-analysis.sql", import.meta.url)), "utf8");
    const result = await database.exec(sql);
    expect(result.at(-1)?.rows).toEqual([{ result: "AI-007 hosted strategy analysis verification passed; all fixtures rolled back" }]);
  });

  it("inserts once, skips an identical preview and rejects conflicting replay", async () => {
    await asRole("service_role", null, async () => {
      const payload = preview();
      expect((await database.query("select * from public.store_strategy_analysis_previews($1::uuid, $2::jsonb)", [OWNER, JSON.stringify(payload)])).rows[0])
        .toEqual({ inserted_count: 1, skipped_count: 0 });
      expect((await database.query("select * from public.store_strategy_analysis_previews($1::uuid, $2::jsonb)", [OWNER, JSON.stringify(payload)])).rows[0])
        .toEqual({ inserted_count: 0, skipped_count: 1 });
      await expect(database.query("select * from public.store_strategy_analysis_previews($1::uuid, $2::jsonb)", [OWNER, JSON.stringify(preview({ explanation: "Changed" }))]))
        .rejects.toMatchObject({ code: "23505" });
    });
  });

  it("persists HOLD as analysis without changing portfolio or ledger", async () => {
    const before = (await database.query("select count(*)::integer as portfolios, (select count(*)::integer from public.portfolio_ledger) as ledger from public.portfolios")).rows[0];
    await database.exec("begin");
    try {
      await database.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role", is_anonymous: false })]);
      await database.exec("set local role service_role");
      const hold = preview({
        product_id: "ETH-EUR", signal: "HOLD", indicators: null, proposed_notional: null,
        latest_candle_start: null, reason_codes: ["INSUFFICIENT_HISTORY"], data_quality: "INSUFFICIENT_HISTORY",
        freshness: "UNAVAILABLE", input_count: 0, input_start: null, input_end: null,
        explanation: "At least 60 candles required", idempotency_key: "PREVIEW_ONLY:BASELINE_V1:ETH-EUR:2026-10-13T00:00:00.000Z",
      });
      expect((await database.query("select * from public.store_strategy_analysis_previews($1::uuid, $2::jsonb)", [OWNER, JSON.stringify(hold)])).rows[0])
        .toEqual({ inserted_count: 1, skipped_count: 0 });
      await database.exec("reset role");
      expect((await database.query("select signal, reason_codes, outcome from public.strategy_analysis_runs where product_id = 'ETH-EUR'")).rows[0])
        .toEqual({ signal: "HOLD", reason_codes: ["INSUFFICIENT_HISTORY"], outcome: "ANALYSIS_ONLY" });
      expect((await database.query("select count(*)::integer as portfolios, (select count(*)::integer from public.portfolio_ledger) as ledger from public.portfolios")).rows[0]).toEqual(before);
    } finally { await database.exec("rollback"); }
  });

  it("allows only the authenticated owner to read latest previews", async () => {
    await database.exec("begin");
    try {
      await database.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role", is_anonymous: false })]);
      await database.exec("set local role service_role");
      const eth = preview({ product_id: "ETH-EUR", idempotency_key: "PREVIEW_ONLY:BASELINE_V1:ETH-EUR:2026-10-13T00:00:00.000Z" })[0];
      await database.query("select * from public.store_strategy_analysis_previews($1::uuid, $2::jsonb)", [OWNER, JSON.stringify([preview()[0], eth])]);
      await database.exec("reset role");
      await database.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [OWNER, JSON.stringify({ sub: OWNER, role: "authenticated", is_anonymous: false })]);
      await database.exec("set local role authenticated");
      const rows = (await database.query("select * from public.get_latest_strategy_analysis_previews($1::uuid)", [OWNER])).rows;
      expect(rows.map((row) => (row as { product_id: string }).product_id)).toEqual(["BTC-EUR", "ETH-EUR"]);
      expect(rows[0]).toMatchObject({ owner_id: OWNER, strategy_id: "BASELINE_V1", outcome: "ANALYSIS_ONLY" });
    } finally { await database.exec("rollback"); }
    await asRole("authenticated", OTHER, async () => expect(database.query("select * from public.get_latest_strategy_analysis_previews($1::uuid)", [OWNER])).rejects.toMatchObject({ code: "42501" }));
    await asRole("authenticated", OWNER, async () => expect(database.query("select * from public.get_latest_strategy_analysis_previews($1::uuid)", [OWNER])).rejects.toMatchObject({ code: "42501" }), true);
  });

  it("denies direct writes and privileged function execution to browser roles", async () => {
    await asRole("authenticated", OWNER, async () => expect(database.query("delete from public.strategy_analysis_runs")).rejects.toMatchObject({ code: "42501" }));
    await asRole("authenticated", OWNER, async () => expect(database.query("select * from public.store_strategy_analysis_previews($1::uuid, $2::jsonb)", [OWNER, JSON.stringify(preview())])).rejects.toMatchObject({ code: "42501" }));
    await asRole("service_role", null, async () => expect(database.query("insert into public.strategy_analysis_runs (owner_id) values ($1)", [OWNER])).rejects.toMatchObject({ code: "42501" }));
  });

  it.each([
    { signal: "HOLD" }, { proposed_notional: "26" }, { product_id: "SOL-EUR" },
    { data_quality: "VALID", indicators: null }, { outcome: "EXECUTED" },
  ])("rejects invalid protected preview values %#", async (change) => {
    await asRole("service_role", null, async () => expect(database.query("select * from public.store_strategy_analysis_previews($1::uuid, $2::jsonb)", [OTHER, JSON.stringify(preview({ ...change, idempotency_key: `invalid-${JSON.stringify(change)}` }))])).rejects.toMatchObject({ code: "23514" }));
  });
});
