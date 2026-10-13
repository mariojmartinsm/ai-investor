import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER_A = "50000000-0000-4000-8000-000000000001";
const OWNER_B = "50000000-0000-4000-8000-000000000002";
type Role = "anon" | "authenticated" | "service_role";
let database: PGlite;

function candle(close = "105.123456789012345678") {
  return [{ product_id: "BTC-EUR", granularity: "ONE_DAY", candle_start: "2026-10-11T00:00:00.000Z", open_price: "100.000000000000000001", high_price: "110", low_price: "90", close_price: close, volume: "12.5", source: "Coinbase Advanced Trade public API", fetched_at: "2026-10-13T12:00:00.000Z" }];
}

async function asRole<T>(role: Role, userId: string | null, operation: () => Promise<T>, anonymous = false, setup?: () => Promise<unknown>) {
  await database.exec("begin");
  try {
    if (setup) await setup();
    await database.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [userId ?? "", JSON.stringify({ sub: userId, role, is_anonymous: anonymous })]);
    await database.exec(`set local role ${role}`);
    return await operation();
  } finally { await database.exec("rollback"); }
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(await readFile(fileURLToPath(new URL("./support/supabase-auth-shim.sql", import.meta.url)), "utf8"));
  const directory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
  for (const migration of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) await database.exec(await readFile(`${directory}/${migration}`, "utf8"));
  await database.query("insert into auth.users (id) values ($1), ($2)", [OWNER_A, OWNER_B]);
}, 30_000);
afterAll(async () => database?.close());

describe("historical market database security and idempotency", () => {
  it("executes the hosted security verification and rolls back all fixtures", async () => {
    const sql = await readFile(fileURLToPath(new URL("./hosted-market-history.sql", import.meta.url)), "utf8");
    const result = await database.exec(sql);
    expect(result.at(-1)?.rows).toEqual([{ result: "AI-004 hosted market history verification passed; all fixtures rolled back" }]);
  });

  it("imports once, skips an identical replay and updates an exchange correction", async () => {
    await asRole("service_role", null, async () => {
      expect((await database.query("select * from public.upsert_market_candles($1::jsonb)", [JSON.stringify(candle())])).rows[0]).toEqual({ imported_count: 1, updated_count: 0, skipped_count: 0 });
      expect((await database.query("select * from public.upsert_market_candles($1::jsonb)", [JSON.stringify(candle())])).rows[0]).toEqual({ imported_count: 0, updated_count: 0, skipped_count: 1 });
      expect((await database.query("select * from public.upsert_market_candles($1::jsonb)", [JSON.stringify(candle("106"))])).rows[0]).toEqual({ imported_count: 0, updated_count: 1, skipped_count: 0 });
      expect((await database.query("select count(*)::integer as count from public.market_candles")).rows[0]).toEqual({ count: 1 });
    });
  });

  it.each([
    { open_price: "0" }, { high_price: "99" }, { low_price: "101" }, { volume: "-1" },
    { candle_start: "2026-10-11T00:00:01.000Z" }, { product_id: "SOL-EUR" },
  ])("rejects invalid persisted candle %#", async (change) => {
    await asRole("service_role", null, async () => {
      await expect(database.query("select * from public.upsert_market_candles($1::jsonb)", [JSON.stringify([{ ...candle()[0], ...change }])])).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("denies direct browser writes and RPC upserts while allowing authenticated decimal-string reads", async () => {
    await asRole("authenticated", OWNER_A, async () =>
      expect(database.query("insert into public.market_candles select * from public.market_candles")).rejects.toMatchObject({ code: "42501" }));
    await asRole("authenticated", OWNER_A, async () =>
      expect(database.query("select * from public.upsert_market_candles($1::jsonb)", [JSON.stringify(candle())])).rejects.toMatchObject({ code: "42501" }));
    await asRole("authenticated", OWNER_A, async () => {
      const rows = (await database.query("select * from public.get_market_candles('BTC-EUR', 730)")).rows;
      expect(rows[0]).toMatchObject({ product_id: "BTC-EUR", close_price: "105.123456789012345678" });
    }, false, () => database.query("select * from public.upsert_market_candles($1::jsonb)", [JSON.stringify(candle())]));
  });

  it("denies anonymous reads and anonymous Auth users", async () => {
    await asRole("anon", null, async () => expect(database.query("select * from public.market_candles")).rejects.toMatchObject({ code: "42501" }));
    await asRole("authenticated", OWNER_A, async () => expect(database.query("select * from public.get_market_candles('BTC-EUR', 10)")).rejects.toMatchObject({ code: "42501" }), true);
  });

  it("scopes import audit records to their owner", async () => {
    await database.query("insert into public.market_data_import_runs (owner_id, status) values ($1, 'RUNNING')", [OWNER_A]);
    await asRole("authenticated", OWNER_A, async () => expect((await database.query("select owner_id from public.market_data_import_runs")).rows).toEqual([{ owner_id: OWNER_A }]));
    await asRole("authenticated", OWNER_B, async () => expect((await database.query("select owner_id from public.market_data_import_runs")).rows).toEqual([]));
  });
});
