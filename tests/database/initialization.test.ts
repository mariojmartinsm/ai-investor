import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER_A = "30000000-0000-4000-8000-000000000001";
const OWNER_B = "30000000-0000-4000-8000-000000000002";
const ANONYMOUS_OWNER = "30000000-0000-4000-8000-000000000003";
const MISSING_OWNER = "30000000-0000-4000-8000-000000000099";
const EXISTING_PORTFOLIO = "40000000-0000-4000-8000-000000000001";
const ZERO = "0.000000000000";
const CAPITAL = "500.000000000000";

type Role = "anon" | "authenticated" | "service_role";
type Snapshot = {
  id: string; owner_id: string; mode: string; starting_capital: string;
  created_at: Date; eur_balance: string; btc_balance: string; eth_balance: string;
  initial_funding_count: number; ledger_entry_count: number;
};
let database: PGlite;

beforeAll(async () => {
  database = new PGlite();
  await database.exec(await readFile(
    fileURLToPath(new URL("./support/supabase-auth-shim.sql", import.meta.url)), "utf8",
  ));
  const directory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
  for (const migration of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    await database.exec(await readFile(`${directory}/${migration}`, "utf8"));
  }
  await database.query("insert into auth.users (id, is_anonymous) values ($1, false), ($2, false), ($3, true)",
    [OWNER_A, OWNER_B, ANONYMOUS_OWNER]);
}, 30_000);
afterAll(async () => { await database?.close(); });

async function asRole<T>(role: Role, userId: string | null, operation: () => Promise<T>,
  setup?: () => Promise<unknown>, anonymousClaim = false): Promise<T> {
  await database.exec("begin");
  try {
    if (setup) await setup();
    await database.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await database.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userId, role, is_anonymous: anonymousClaim })]);
    await database.exec(`set local role ${role}`);
    return await operation();
  } finally { await database.exec("rollback"); }
}

async function snapshot(ownerId: string = OWNER_A, initialize = false) {
  const fn = initialize ? "initialize_dry_run_portfolio" : "get_dry_run_portfolio";
  return (await database.query<Snapshot>(`select * from public.${fn}($1)`, [ownerId])).rows;
}

function expectInitialized(row: Snapshot) {
  expect(row).toMatchObject({ owner_id: OWNER_A, mode: "DRY_RUN", starting_capital: CAPITAL,
    eur_balance: CAPITAL, btc_balance: ZERO, eth_balance: ZERO,
    initial_funding_count: 1, ledger_entry_count: 1 });
  expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
}

describe("atomic dry-run initialization", () => {
  it("creates no portfolios or money merely by applying migrations", async () => {
    expect((await database.query("select * from public.portfolios")).rows).toEqual([]);
    expect((await database.query("select * from public.portfolio_ledger")).rows).toEqual([]);
  });

  it("returns an empty read result for an uninitialized owner", async () => {
    await asRole("authenticated", OWNER_A, async () => expect(await snapshot()).toEqual([]));
  });

  it("creates exactly one 500 EUR entry and zero BTC/ETH", async () => {
    await asRole("authenticated", OWNER_A, async () => {
      const rows = await snapshot(OWNER_A, true);
      expect(rows).toHaveLength(1); expectInitialized(rows[0]);
      const { rows: ledger } = await database.query(
        `select transaction_type, currency, amount::text, reference_type, reference_id, idempotency_key
         from public.portfolio_ledger`,
      );
      expect(ledger).toEqual([{ transaction_type: "INITIAL_CAPITAL", currency: "EUR", amount: CAPITAL,
        reference_type: "PORTFOLIO_INITIALIZATION", reference_id: rows[0].id,
        idempotency_key: "INITIAL_CAPITAL:EUR" }]);
    });
  });

  it("repeated initialization preserves the portfolio UUID, funding and timestamp", async () => {
    await asRole("authenticated", OWNER_A, async () => {
      const first = (await snapshot(OWNER_A, true))[0];
      for (let attempt = 0; attempt < 5; attempt++) {
        expect((await snapshot(OWNER_A, true))[0]).toEqual(first);
      }
      expectInitialized((await snapshot())[0]);
    });
  });

  it("completes an empty preexisting portfolio without replacing its UUID", async () => {
    await asRole("authenticated", OWNER_A, async () => {
      const row = (await snapshot(OWNER_A, true))[0];
      expect(row.id).toBe(EXISTING_PORTFOLIO); expectInitialized(row);
    }, () => database.query("insert into public.portfolios (id, owner_id) values ($1, $2)",
      [EXISTING_PORTFOLIO, OWNER_A]));
  });

  it("fails closed on financial history without initial funding instead of topping it up", async () => {
    await asRole("authenticated", OWNER_A, async () => {
      await expect(snapshot(OWNER_A, true)).rejects.toMatchObject({
        code: "23514", message: "PORTFOLIO_INITIALIZATION_INTEGRITY",
      });
    }, async () => {
      await database.query("insert into public.portfolios (id, owner_id) values ($1, $2)",
        [EXISTING_PORTFOLIO, OWNER_A]);
      await database.query(`insert into public.portfolio_ledger
        (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
        values ($1, 'ADJUSTMENT', 'EUR', '499', 'TEST', 'conflict', 'INITIAL_CAPITAL:EUR')`, [EXISTING_PORTFOLIO]);
    });
  });

  it("rolls back portfolio creation on funding failure and succeeds on a later retry", async () => {
    await asRole("authenticated", OWNER_A, async () => {
      await database.exec("savepoint funding_attempt");
      await expect(snapshot(OWNER_A, true)).rejects.toMatchObject({
        code: "P0001", message: "TEST_FUNDING_FAILURE",
      });
      await database.exec("rollback to savepoint funding_attempt");
      expect(await snapshot()).toEqual([]);
      expect((await database.query("select * from public.portfolio_ledger")).rows).toEqual([]);
      await database.exec("reset role; drop trigger test_reject_funding on public.portfolio_ledger; set local role authenticated");
      expectInitialized((await snapshot(OWNER_A, true))[0]);
    }, () => database.exec(`create function private.test_reject_funding() returns trigger
      language plpgsql security invoker set search_path = '' as $$ begin
        raise exception 'TEST_FUNDING_FAILURE'; end; $$;
      create trigger test_reject_funding before insert on public.portfolio_ledger
        for each row execute function private.test_reject_funding()`));
  });

  it("derives exact decimal balances from signed ledger entries and never resets existing funds", async () => {
    await asRole("authenticated", OWNER_A, async () => {
      const first = (await snapshot(OWNER_A, true))[0];
      await database.exec("reset role");
      await database.query(`insert into public.portfolio_ledger
        (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
        values ($1, 'ADJUSTMENT', 'EUR', '-0.000000000001', 'TEST', 'precision', 'eur-delta'),
               ($1, 'ADJUSTMENT', 'BTC', '0.000000000001', 'TEST', 'precision', 'btc-delta'),
               ($1, 'ADJUSTMENT', 'ETH', '0.123456789012', 'TEST', 'precision', 'eth-delta')`, [first.id]);
      await database.exec("set local role authenticated");
      const read = (await snapshot())[0];
      expect(read).toMatchObject({ eur_balance: "499.999999999999", btc_balance: "0.000000000001",
        eth_balance: "0.123456789012", initial_funding_count: 1, ledger_entry_count: 4 });
      expect((await snapshot(OWNER_A, true))[0]).toEqual(read);
    });
  });

  it("keeps the original hosted RLS verification compatible with all migrations", async () => {
    const sql = await readFile(fileURLToPath(new URL("./hosted-rls.sql", import.meta.url)), "utf8");
    const results = await database.exec(sql);
    expect(results.at(-1)?.rows).toEqual([{ result: "AI-002 hosted RLS verification passed; all fixtures rolled back" }]);
    expect((await database.query("select * from public.portfolios")).rows).toEqual([]);
  });

  it("executes the new hosted portfolio verification and rolls every fixture back", async () => {
    const sql = await readFile(fileURLToPath(new URL("./hosted-portfolio.sql", import.meta.url)), "utf8");
    const results = await database.exec(sql);
    expect(results.at(-1)?.rows).toEqual([{ result: "AI-003 hosted portfolio verification passed; all fixtures rolled back" }]);
    expect((await database.query("select * from public.portfolios")).rows).toEqual([]);
    expect((await database.query("select * from public.portfolio_ledger")).rows).toEqual([]);
    expect((await database.query("select count(*)::integer as count from auth.users")).rows).toEqual([{ count: 3 }]);
  });
});

describe("RPC authorization and privileges", () => {
  for (const functionName of ["public.initialize_dry_run_portfolio", "private.initialize_dry_run_portfolio", "public.get_dry_run_portfolio"]) {
    for (const [label, caller, target] of [
      ["cross-owner", OWNER_A, OWNER_B], ["missing identity", null, OWNER_A], ["null owner argument", OWNER_A, null],
    ] as const) {
      it(`rejects ${label} calls to ${functionName}`, async () => {
        await asRole("authenticated", caller, async () => {
          await expect(database.query(`select * from ${functionName}($1)`, [target])).rejects.toMatchObject({ code: "42501" });
        });
      });
    }
    for (const role of ["anon", "service_role"] as const) {
      it(`does not grant ${role} execution of ${functionName}`, async () => {
        await asRole(role, OWNER_A, async () => {
          await expect(database.query(`select * from ${functionName}($1)`, [OWNER_A])).rejects.toMatchObject({ code: "42501" });
        });
      });
    }
  }

  for (const functionName of ["public.initialize_dry_run_portfolio", "private.initialize_dry_run_portfolio"]) {
    it(`rejects nonexistent Auth owners in ${functionName}`, async () => {
      await asRole("authenticated", MISSING_OWNER, async () => {
        await expect(database.query(`select * from ${functionName}($1)`, [MISSING_OWNER])).rejects.toMatchObject({ code: "42501" });
      });
    });
    it(`independently rejects an anonymous Auth database owner in ${functionName}`, async () => {
      await asRole("authenticated", ANONYMOUS_OWNER, async () => {
        await expect(database.query(`select * from ${functionName}($1)`, [ANONYMOUS_OWNER])).rejects.toMatchObject({ code: "42501" });
      });
    });
  }

  for (const initialize of [true, false]) {
    it(`rejects trusted anonymous JWT claims on ${initialize ? "initialize" : "read"} RPC`, async () => {
      await asRole("authenticated", OWNER_A, async () => {
        await expect(snapshot(OWNER_A, initialize)).rejects.toMatchObject({ code: "42501" });
      }, undefined, true);
    });
  }

  it("uses an isolated definer only for the private initializer and fixes all search paths", async () => {
    const { rows } = await database.query(`select n.nspname as schema, p.proname as name,
      p.prosecdef as definer, p.proconfig as settings from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'private' and p.proname in ('initialize_dry_run_portfolio', 'reject_ledger_mutation'))
         or (n.nspname = 'public' and p.proname in ('initialize_dry_run_portfolio', 'get_dry_run_portfolio'))
      order by n.nspname, p.proname`);
    expect(rows).toEqual([
      { schema: "private", name: "initialize_dry_run_portfolio", definer: true, settings: ['search_path=""'] },
      { schema: "private", name: "reject_ledger_mutation", definer: false, settings: ['search_path=""'] },
      { schema: "public", name: "get_dry_run_portfolio", definer: false, settings: ['search_path=""'] },
      { schema: "public", name: "initialize_dry_run_portfolio", definer: false, settings: ['search_path=""'] },
    ]);
  });
});

describe("immutable financial invariants", () => {
  for (const [currency, amount] of [["EUR", "499.999999999999"], ["EUR", "500.000000000001"], ["BTC", "500"], ["ETH", "500"]]) {
    it(`rejects INITIAL_CAPITAL ${amount} ${currency}`, async () => {
      await asRole("service_role", null, async () => {
        await expect(database.query(`insert into public.portfolio_ledger
          (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
          values ($1, 'INITIAL_CAPITAL', $2, $3, 'TEST', 'invalid', 'invalid')`,
        [EXISTING_PORTFOLIO, currency, amount])).rejects.toMatchObject({ code: "23514" });
      }, () => database.query("insert into public.portfolios (id, owner_id) values ($1, $2)", [EXISTING_PORTFOLIO, OWNER_A]));
    });
  }

  it("prevents a second initial funding even with a different idempotency key", async () => {
    await asRole("authenticated", OWNER_A, async () => {
      const row = (await snapshot(OWNER_A, true))[0]; await database.exec("reset role");
      await expect(database.query(`insert into public.portfolio_ledger
        (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
        values ($1, 'INITIAL_CAPITAL', 'EUR', 500, 'TEST', 'duplicate', 'different-key')`, [row.id]))
        .rejects.toMatchObject({ code: "23505" });
    });
  });

  for (const command of ["update public.portfolio_ledger set amount = 999", "delete from public.portfolio_ledger", "truncate public.portfolio_ledger"]) {
    it(`blocks privileged ${command.split(" ")[0]} of ledger history`, async () => {
      await asRole("authenticated", OWNER_A, async () => {
        await snapshot(OWNER_A, true); await database.exec("reset role");
        await expect(database.exec(command)).rejects.toMatchObject({ code: "55000", message: "LEDGER_APPEND_ONLY" });
      });
    });
  }
});
