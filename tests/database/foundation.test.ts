import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER_A = "00000000-0000-4000-8000-000000000001";
const OWNER_B = "00000000-0000-4000-8000-000000000002";
const PORTFOLIO_A = "10000000-0000-4000-8000-000000000001";
const PORTFOLIO_B = "10000000-0000-4000-8000-000000000002";
const LEDGER_A = "20000000-0000-4000-8000-000000000001";
const LEDGER_B = "20000000-0000-4000-8000-000000000002";

type ApplicationRole = "anon" | "authenticated" | "service_role";
type TableName = "portfolios" | "portfolio_ledger";

const tables: TableName[] = ["portfolios", "portfolio_ledger"];
let database: PGlite;
let initialRowCounts: number[];

// Each role exercise is a real PostgreSQL transaction. ROLLBACK also restores
// temporary test grants and removes fixtures inserted by an allowed operation.
async function asRole<T>(
  role: ApplicationRole,
  userId: string | null,
  operation: () => Promise<T>,
  setupSql?: string,
): Promise<T> {
  await database.exec("begin");
  try {
    if (setupSql) await database.exec(setupSql);
    await database.exec(`set local role ${role}`);
    await database.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId ?? "",
    ]);
    return await operation();
  } finally {
    await database.exec("rollback");
  }
}

async function denied(sql: string, parameters: unknown[] = []) {
  await expect(database.query(sql, parameters)).rejects.toMatchObject({
    code: "42501",
  });
}

beforeAll(async () => {
  database = new PGlite();
  const shim = await readFile(
    fileURLToPath(new URL("./support/supabase-auth-shim.sql", import.meta.url)),
    "utf8",
  );
  await database.exec(shim);

  const directory = fileURLToPath(
    new URL("../../supabase/migrations/", import.meta.url),
  );
  const migrations = (await readdir(directory))
    // Preserve foundation constraint coverage independently of later immutable
    // ledger triggers; all-migration compatibility is covered by initialization.
    .filter((name) => name.endsWith("_ai_002_auth_database_foundation.sql"))
    .sort();
  expect(migrations.length).toBeGreaterThan(0);
  for (const migration of migrations) {
    await database.exec(await readFile(`${directory}/${migration}`, "utf8"));
  }

  initialRowCounts = [];
  for (const table of tables) {
    const { rows } = await database.query<{ count: number }>(
      `select count(*)::integer as count from public.${table}`,
    );
    initialRowCounts.push(rows[0].count);
  }

  // Synthetic users and financial rows exist only in this disposable database.
  await database.query("insert into auth.users (id) values ($1), ($2)", [
    OWNER_A,
    OWNER_B,
  ]);
  await database.query(
    "insert into public.portfolios (id, owner_id) values ($1, $2), ($3, $4)",
    [PORTFOLIO_A, OWNER_A, PORTFOLIO_B, OWNER_B],
  );
  await database.query(
    `insert into public.portfolio_ledger
      (id, portfolio_id, transaction_type, currency, amount,
       reference_type, reference_id, idempotency_key)
     values ($1, $2, 'INITIAL_CAPITAL', 'EUR', '500', 'TEST_FIXTURE', 'a', 'fixture-a'),
            ($3, $4, 'INITIAL_CAPITAL', 'EUR', '500', 'TEST_FIXTURE', 'b', 'fixture-b')`,
    [LEDGER_A, PORTFOLIO_A, LEDGER_B, PORTFOLIO_B],
  );
}, 30_000);

afterAll(async () => {
  await database?.close();
});

describe("database foundation", () => {
  it("executes hosted verification SQL and rolls every fixture back", async () => {
    const sql = await readFile(
      fileURLToPath(new URL("./hosted-rls.sql", import.meta.url)),
      "utf8",
    );
    const result = await database.exec(sql);
    expect(result.at(-1)?.rows).toEqual([{
      result: "AI-002 hosted RLS verification passed; all fixtures rolled back",
    }]);
    for (const table of ["auth.users", "public.portfolios", "public.portfolio_ledger"]) {
      const { rows } = await database.query<{ count: number }>(
        `select count(*)::integer as count from ${table}`,
      );
      expect(rows[0].count).toBe(2);
    }
  });

  it("does not initialize financial data in the migration", () => {
    expect(initialRowCounts).toEqual([0, 0]);
  });

  it("enables RLS on every exposed application table", async () => {
    const { rows } = await database.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'
       order by relname`,
    );
    expect(rows).toEqual([
      { relname: "portfolio_ledger", relrowsecurity: true },
      { relname: "portfolios", relrowsecurity: true },
    ]);
  });

  it("stores financial values in numeric(28,12)", async () => {
    const { rows } = await database.query(
      `select table_name, column_name, data_type, numeric_precision, numeric_scale
       from information_schema.columns where table_schema = 'public'
       and column_name in ('starting_capital', 'amount') order by table_name`,
    );
    expect(rows).toEqual([
      {
        table_name: "portfolio_ledger",
        column_name: "amount",
        data_type: "numeric",
        numeric_precision: 28,
        numeric_scale: 12,
      },
      {
        table_name: "portfolios",
        column_name: "starting_capital",
        data_type: "numeric",
        numeric_precision: 28,
        numeric_scale: 12,
      },
    ]);
  });

  it("indexes ownership and portfolio timeline lookups", async () => {
    const { rows } = await database.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public'",
    );
    expect(rows.some(({ indexdef }) => indexdef.includes("(owner_id, mode)")))
      .toBe(true);
    expect(
      rows.some(({ indexdef }) =>
        indexdef.includes("(portfolio_id, occurred_at DESC, id)"),
      ),
    ).toBe(true);
  });
});

describe("owner reads and access denial", () => {
  for (const [owner, portfolioId, ledgerId, otherPortfolio, otherLedger] of [
    [OWNER_A, PORTFOLIO_A, LEDGER_A, PORTFOLIO_B, LEDGER_B],
    [OWNER_B, PORTFOLIO_B, LEDGER_B, PORTFOLIO_A, LEDGER_A],
  ]) {
    it(`allows only the authenticated owner's rows (${owner})`, async () => {
      await asRole("authenticated", owner, async () => {
        const portfolios = await database.query("select id from public.portfolios");
        const ledger = await database.query("select id from public.portfolio_ledger");
        expect(portfolios.rows).toEqual([{ id: portfolioId }]);
        expect(ledger.rows).toEqual([{ id: ledgerId }]);

        expect(
          (await database.query("select * from public.portfolios where id = $1", [
            otherPortfolio,
          ])).rows,
        ).toEqual([]);
        expect(
          (await database.query(
            "select * from public.portfolio_ledger where id = $1", [otherLedger],
          )).rows,
        ).toEqual([]);
      });
    });
  }

  for (const table of tables) {
    it(`denies anonymous SELECT on ${table}`, async () => {
      await asRole("anon", null, () => denied(`select * from public.${table}`));
    });

    it(`exposes no ${table} rows with an authenticated role but no identity`, async () => {
      await asRole("authenticated", null, async () => {
        expect((await database.query(`select * from public.${table}`)).rows)
          .toEqual([]);
      });
    });

    it(`RLS still denies anonymous ${table} reads if SELECT is mistakenly granted`, async () => {
      await asRole("anon", OWNER_A, async () => {
        expect((await database.query(`select * from public.${table}`)).rows)
          .toEqual([]);
      }, `grant select on public.${table} to anon`);
    });
  }
});

describe("financial write protection", () => {
  const writes: [TableName, string, unknown[]][] = [
    ["portfolios", "insert into public.portfolios (owner_id) values ($1)", [OWNER_A]],
    ["portfolios", "update public.portfolios set owner_id = $1 where id = $2", [OWNER_B, PORTFOLIO_A]],
    ["portfolios", "delete from public.portfolios where id = $1", [PORTFOLIO_A]],
    ["portfolios", "truncate public.portfolios cascade", []],
    ["portfolio_ledger", `insert into public.portfolio_ledger
      (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
      values ($1, 'INITIAL_CAPITAL', 'EUR', '500', 'TEST', 'test', 'forged-entry')`, [PORTFOLIO_A]],
    ["portfolio_ledger", "update public.portfolio_ledger set amount = '999' where id = $1", [LEDGER_A]],
    ["portfolio_ledger", "delete from public.portfolio_ledger where id = $1", [LEDGER_A]],
    ["portfolio_ledger", "truncate public.portfolio_ledger", []],
  ];

  for (const [table, sql, parameters] of writes) {
    const operation = sql.trim().split(/\s+/)[0].toUpperCase();
    it(`denies direct authenticated ${operation} on ${table}`, async () => {
      await asRole("authenticated", OWNER_A, () => denied(sql, parameters));
    });
  }

  for (const table of tables) {
    const insert = writes.find(([target, sql]) => target === table && sql.startsWith("insert"))!;
    it(`RLS rejects ${table} inserts even if INSERT is mistakenly granted`, async () => {
      await asRole("authenticated", OWNER_A, () => denied(insert[1], insert[2]),
        `grant insert on public.${table} to authenticated`);
    });

    for (const operation of ["update", "delete"] as const) {
      const write = writes.find(([target, sql]) => target === table && sql.startsWith(operation))!;
      it(`RLS prevents ${table} ${operation} even if privilege is mistakenly granted`, async () => {
        await asRole("authenticated", OWNER_A, async () => {
          const result = await database.query(write[1], write[2]);
          expect(result.affectedRows).toBe(0);
        }, `grant ${operation} on public.${table} to authenticated`);
      });
    }
  }

  for (const operation of ["update", "delete", "truncate"]) {
    const write = writes.find(([table, sql]) => table === "portfolio_ledger" && sql.startsWith(operation))!;
    it(`denies service-role ${operation} of existing ledger records`, async () => {
      await asRole("service_role", null, () => denied(write[1], write[2]));
    });
  }

  it("permits a privileged future writer to append a precise signed posting", async () => {
    await asRole("service_role", null, async () => {
      const { rows } = await database.query<{ amount: string }>(
        `insert into public.portfolio_ledger
         (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
         values ($1, 'ADJUSTMENT', 'BTC', '-0.000000000001', 'TEST', 'precision', 'precision')
         returning amount::text`,
        [PORTFOLIO_A],
      );
      expect(rows).toEqual([{ amount: "-0.000000000001" }]);
    });
  });
});

describe("schema invariants", () => {
  async function rejectsConstraint(sql: string, parameters: unknown[], code: string) {
    await database.exec("begin");
    try {
      await expect(database.query(sql, parameters)).rejects.toMatchObject({ code });
    } finally {
      await database.exec("rollback");
    }
  }

  for (const [column, value] of [
    ["mode", "LIVE"],
    ["starting_currency", "USD"],
    ["starting_capital", "499.999999999999"],
    ["starting_capital", "500.000000000001"],
    ["starting_capital", "NaN"],
  ]) {
    it(`rejects invalid portfolio ${column}=${value}`, async () => {
      await rejectsConstraint(
        `update public.portfolios set ${column} = $1 where id = $2`,
        [value, PORTFOLIO_A], "23514",
      );
    });
  }

  it("prevents duplicate owner/mode portfolios", async () => {
    await rejectsConstraint("insert into public.portfolios (owner_id) values ($1)",
      [OWNER_A], "23505");
  });

  it("requires a real Auth owner", async () => {
    await rejectsConstraint("insert into public.portfolios (owner_id) values ($1)",
      ["00000000-0000-4000-8000-000000000099"], "23503");
  });

  it("retains financial history when a portfolio deletion is attempted", async () => {
    await rejectsConstraint("delete from public.portfolios where id = $1",
      [PORTFOLIO_A], "23001");
  });

  it("retains financial history when an Auth owner deletion is attempted", async () => {
    await rejectsConstraint("delete from auth.users where id = $1", [OWNER_A], "23001");
  });

  for (const [column, value] of [
    ["currency", "XRP"],
    ["transaction_type", "UNKNOWN"],
    ["amount", "0"],
    ["amount", "NaN"],
    ["reference_type", " "],
    ["reference_id", " "],
    ["idempotency_key", " "],
  ]) {
    it(`rejects invalid ledger ${column}=${value}`, async () => {
      await rejectsConstraint(
        `update public.portfolio_ledger set ${column} = $1 where id = $2`,
        [value, LEDGER_A], "23514",
      );
    });
  }

  it("rejects repeated posting idempotency keys", async () => {
    await rejectsConstraint(
      `insert into public.portfolio_ledger
       (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
       values ($1, 'INITIAL_CAPITAL', 'EUR', '500', 'TEST', 'duplicate', 'fixture-a')`,
      [PORTFOLIO_A], "23505",
    );
  });

  it("requires a real portfolio for every ledger record", async () => {
    await rejectsConstraint(
      `insert into public.portfolio_ledger
       (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
       values ($1, 'INITIAL_CAPITAL', 'EUR', '500', 'TEST', 'orphan', 'orphan')`,
      ["10000000-0000-4000-8000-000000000099"], "23503",
    );
  });
});
