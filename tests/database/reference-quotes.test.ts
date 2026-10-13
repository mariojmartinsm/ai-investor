import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER = "60000000-0000-4000-8000-000000000001";
type Role = "anon" | "authenticated" | "service_role";
let database: PGlite;

function quote(change: Record<string, unknown> = {}) {
  const fetchedAt = new Date(Date.now() - 5_000).toISOString();
  return [{
    product_id: "BTC-EUR", price: "74244.812345678901234567", price_kind: "last_trade",
    bid: "74240.41", ask: "74247.84", source: "Coinbase Advanced Trade public API",
    exchange_at: new Date(Date.now() - 6_000).toISOString(), fetched_at: fetchedAt, ...change,
  }];
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
  for (const migration of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    await database.exec(await readFile(`${directory}/${migration}`, "utf8"));
  }
  await database.query("insert into auth.users (id) values ($1)", [OWNER]);
}, 30_000);
afterAll(async () => database?.close());

describe("reference quote persistence and security", () => {
  it("executes the hosted verification script and rolls every fixture back", async () => {
    const sql = await readFile(fileURLToPath(new URL("./hosted-reference-quotes.sql", import.meta.url)), "utf8");
    const result = await database.exec(sql);
    expect(result.at(-1)?.rows).toEqual([{ result: "AI-006 hosted reference quote verification passed; all fixtures rolled back" }]);
  });

  it("inserts once, skips an identical replay and rejects a conflicting replay", async () => {
    await asRole("service_role", null, async () => {
      const payload = quote();
      expect((await database.query("select * from public.store_market_reference_quotes($1::jsonb)", [JSON.stringify(payload)])).rows[0])
        .toEqual({ inserted_count: 1, skipped_count: 0 });
      expect((await database.query("select * from public.store_market_reference_quotes($1::jsonb)", [JSON.stringify(payload)])).rows[0])
        .toEqual({ inserted_count: 0, skipped_count: 1 });
      expect((await database.query("select count(*)::integer as count from public.market_reference_quotes")).rows[0]).toEqual({ count: 1 });
      await expect(database.query("select * from public.store_market_reference_quotes($1::jsonb)", [JSON.stringify([{ ...payload[0], price: "75000" }])]))
        .rejects.toMatchObject({ code: "23505" });
    });
  });

  it("classifies a complete public spread and an unavailable spread without fabricating sides", async () => {
    await asRole("service_role", null, async () => {
      const payload = [quote()[0], quote({ product_id: "ETH-EUR", price_kind: "reference", bid: null, ask: null, exchange_at: null })[0]];
      await database.query("select * from public.store_market_reference_quotes($1::jsonb)", [JSON.stringify(payload)]);
      expect((await database.query("select product_id, execution_reference_kind, bid::text, ask::text from public.market_reference_quotes order by product_id")).rows)
        .toEqual([
          { product_id: "BTC-EUR", execution_reference_kind: "public_bid_ask", bid: "74240.410000000000000000", ask: "74247.840000000000000000" },
          { product_id: "ETH-EUR", execution_reference_kind: "indicative_reference", bid: null, ask: null },
        ]);
    });
  });

  it.each([
    () => quote({ fetched_at: new Date(Date.now() - 120_001).toISOString(), exchange_at: null }),
    () => quote({ fetched_at: new Date(Date.now() + 60_000).toISOString(), exchange_at: null }),
    () => quote({ exchange_at: new Date(Date.now() - 120_001).toISOString() }),
  ])("rejects stale or future quote input %#", async (payload) => {
    await asRole("service_role", null, async () => {
      await expect(database.query("select * from public.store_market_reference_quotes($1::jsonb)", [JSON.stringify(payload())]))
        .rejects.toMatchObject({ code: "22023" });
    });
  });

  it.each([{ price: "0" }, { bid: "75000", ask: "74000" }, { product_id: "SOL-EUR" }, { source: "Unknown" }])
    ("rejects invalid persisted values %#", async (change) => {
      await asRole("service_role", null, async () => {
        await expect(database.query("select * from public.store_market_reference_quotes($1::jsonb)", [JSON.stringify(quote(change))]))
          .rejects.toMatchObject({ code: "23514" });
      });
    });

  it("returns decimal strings and dynamic freshness only to authenticated nonanonymous users", async () => {
    await asRole("authenticated", OWNER, async () => {
      const rows = (await database.query("select * from public.get_latest_market_reference_quotes()")).rows;
      expect(rows[0]).toMatchObject({ product_id: "BTC-EUR", price: "74244.812345678901234567", validation_status: "validated", freshness_status: "fresh" });
    }, false, () => {
      const payload = quote()[0];
      return database.query(`insert into public.market_reference_quotes
        (product_id, price, price_kind, bid, ask, execution_reference_kind, source,
         exchange_at, fetched_at, fresh_until, validation_status)
        values ($1,$2,$3,$4,$5,'public_bid_ask',$6,$7,$8,$9,'validated')`, [
        payload.product_id, payload.price, payload.price_kind, payload.bid, payload.ask, payload.source,
        payload.exchange_at, payload.fetched_at,
        new Date(Date.parse(payload.exchange_at as string) + 120_000).toISOString(),
      ]);
    });
    await asRole("authenticated", OWNER, async () => expect(database.query("select * from public.get_latest_market_reference_quotes()")).rejects.toMatchObject({ code: "42501" }), true);
    await asRole("anon", null, async () => expect(database.query("select * from public.market_reference_quotes")).rejects.toMatchObject({ code: "42501" }));
  });

  it("denies browser inserts and privileged RPC execution", async () => {
    await asRole("authenticated", OWNER, async () => expect(database.query("insert into public.market_reference_quotes (product_id, price, price_kind, execution_reference_kind, source, fetched_at, fresh_until, validation_status) values ('BTC-EUR', 1, 'reference', 'indicative_reference', 'Coinbase Advanced Trade public API', now(), now() + interval '120 seconds', 'validated')"))
      .rejects.toMatchObject({ code: "42501" }));
    await asRole("authenticated", OWNER, async () => expect(database.query("select * from public.store_market_reference_quotes($1::jsonb)", [JSON.stringify(quote())]))
      .rejects.toMatchObject({ code: "42501" }));
  });

  it("denies updates and deletes even to the application service role", async () => {
    await asRole("service_role", null, async () => expect(database.query("update public.market_reference_quotes set price = price")).rejects.toMatchObject({ code: "42501" }));
    await asRole("service_role", null, async () => expect(database.query("delete from public.market_reference_quotes")).rejects.toMatchObject({ code: "42501" }));
  });
});
