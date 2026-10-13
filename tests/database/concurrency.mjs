// Real PostgreSQL integration checks. Creates its OWN local disposable cluster;
// never connects to a configured application/Supabase database or reads secrets.
// PG_TEST_BIN=/absolute/path/to/bin (initdb, pg_ctl, psql), or binaries on PATH.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const workspace = await realpath(process.cwd());
const temporaryRoot = path.join(workspace, ".tmp");
const extension = process.platform === "win32" ? ".exe" : "";
const executable = (name) => process.env.PG_TEST_BIN
  ? path.join(process.env.PG_TEST_BIN, `${name}${extension}`) : `${name}${extension}`;
const children = new Set();
let clusterDirectory;
let started = false;
let port;

async function run(name, args) {
  return executeFile(executable(name), args, {
    windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 20_000,
  });
}
const psqlArguments = () => ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
  "-p", String(port), "-U", "postgres", "-d", "postgres"];
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
async function sql(query) { return (await run("psql", [...psqlArguments(), "-c", query])).stdout.trim(); }
const authSql = (owner) => `set request.jwt.claim.sub = ${sqlLiteral(owner)};
  set request.jwt.claims = ${sqlLiteral(JSON.stringify({ sub: owner, role: "authenticated", is_anonymous: false }))};
  set role authenticated;`;
const initializeSql = (owner) => `select 'SNAPSHOT:' || row_to_json(s)::text
  from public.initialize_dry_run_portfolio(${sqlLiteral(owner)}::uuid) as s;`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function session() {
  const child = spawn(executable("psql"), psqlArguments(), { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  const lines = [];
  const waiters = [];
  let pending = "";
  let errors = "";
  let finished = false;
  let failure;
  const deadline = setTimeout(() => {
    failure = new Error("Native PostgreSQL test session exceeded its 30-second deadline");
    child.kill();
  }, 30_000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const acceptLine = (line) => {
    lines.push(line);
    for (const waiter of [...waiters]) {
      if (line.startsWith(waiter.prefix)) {
        clearTimeout(waiter.timer);
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(line);
      }
    }
  };
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const complete = pending.split(/\r?\n/);
    pending = complete.pop() ?? "";
    for (const line of complete) acceptLine(line);
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(deadline);
      finished = true;
      children.delete(child);
      if (pending) acceptLine(pending);
      if (code !== 0 && !failure) failure = new Error(`psql test session failed (${code}): ${errors.trim()}`);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(failure ?? new Error(`psql ended before ${waiter.prefix}`));
      }
      if (failure) reject(failure); else resolve(lines);
    });
  });
  // The same promise remains rejected and is awaited below; attaching a handler
  // only prevents an early subprocess failure becoming an unhandled rejection.
  void done.catch(() => {});
  return {
    done,
    get finished() { return finished; },
    send(query) { child.stdin.write(`${query}\n`); },
    end(query) { child.stdin.end(`${query}\n`); },
    waitFor(prefix) {
      const existing = lines.find((line) => line.startsWith(prefix));
      if (existing) return Promise.resolve(existing);
      if (finished) return Promise.reject(failure ?? new Error(`psql ended before ${prefix}`));
      return new Promise((resolve, reject) => {
        const waiter = { prefix, resolve, reject, timer: undefined };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for psql marker ${prefix}: ${errors}`));
        }, 10_000);
        waiters.push(waiter);
      });
    },
  };
}

function snapshots(lines) {
  return lines.filter((line) => line.startsWith("SNAPSHOT:"))
    .map((line) => JSON.parse(line.slice("SNAPSHOT:".length)));
}
function assertFunded(snapshot, owner) {
  assert.equal(snapshot.owner_id, owner);
  assert.equal(snapshot.mode, "DRY_RUN");
  assert.equal(snapshot.starting_capital, "500.000000000000");
  assert.equal(snapshot.eur_balance, "500.000000000000");
  assert.equal(snapshot.btc_balance, "0.000000000000");
  assert.equal(snapshot.eth_balance, "0.000000000000");
  assert.equal(snapshot.initial_funding_count, 1);
  assert.equal(snapshot.ledger_entry_count, 1);
}
async function storedState(owner) {
  return JSON.parse(await sql(`select row_to_json(state) from (
    select count(distinct p.id)::integer as portfolios, count(l.id)::integer as ledger_entries,
      count(l.id) filter (where l.transaction_type = 'INITIAL_CAPITAL')::integer as funding_entries,
      coalesce(sum(l.amount) filter (where l.currency = 'EUR'), 0::numeric(28,12))::text as eur
    from public.portfolios p left join public.portfolio_ledger l on l.portfolio_id = p.id
    where p.owner_id = ${sqlLiteral(owner)}::uuid) as state;`));
}

async function race(firstOutcome) {
  const owner = randomUUID();
  await sql(`insert into auth.users (id) values (${sqlLiteral(owner)}::uuid);`);
  const first = session();
  first.send(`begin;\n${authSql(owner)}\n${initializeSql(owner)}\nselect 'FIRST_READY:' || pg_backend_pid();`);
  const firstPid = Number((await first.waitFor("FIRST_READY:")).split(":")[1]);
  const initial = JSON.parse((await first.waitFor("SNAPSHOT:")).slice("SNAPSHOT:".length));
  assertFunded(initial, owner);

  // Separate native PostgreSQL sessions must wait for the first owner's lock.
  const contenders = [session(), session()];
  for (const contender of contenders) {
    contender.end(`begin;\n${authSql(owner)}\nselect 'CONTENDER_READY:' || pg_backend_pid();
      ${initializeSql(owner)}\ncommit;\n\\q`);
  }
  const contenderPids = await Promise.all(contenders.map(async (contender) =>
    Number((await contender.waitFor("CONTENDER_READY:")).split(":")[1])));
  assert.equal(new Set([firstPid, ...contenderPids]).size, 3, "three independent backend sessions required");

  let observed;
  const deadline = Date.now() + 10_000;
  do {
    observed = JSON.parse(await sql(`select coalesce(json_agg(waiting), '[]'::json)
      from (select pid, wait_event_type, pg_blocking_pids(pid) as blockers
        from pg_stat_activity where pid in (${contenderPids.join(",")})) as waiting;`));
    if (observed.length === 2 && observed.every((row) => row.wait_event_type === "Lock" && row.blockers.length > 0)) break;
    await sleep(25);
  } while (Date.now() < deadline);
  assert.equal(observed.length, 2);
  assert.ok(observed.every((row) => row.wait_event_type === "Lock" && row.blockers.length > 0),
    "both initialization requests must be observed waiting on PostgreSQL locks");
  assert.ok(observed.some((row) => row.blockers.includes(firstPid)), "first session must hold a blocking lock");
  assert.ok(contenders.every((contender) => !contender.finished), "contenders cannot finish before lock release");

  first.end(`${firstOutcome};\n\\q`);
  await first.done;
  const results = (await Promise.all(contenders.map((contender) => contender.done))).flatMap(snapshots);
  assert.equal(results.length, 2);
  for (const result of results) assertFunded(result, owner);
  assert.equal(results[0].id, results[1].id);
  if (firstOutcome === "commit") assert.equal(results[0].id, initial.id);
  else assert.notEqual(results[0].id, initial.id, "rolled-back portfolio must not survive");
  assert.deepEqual(await storedState(owner), { portfolios: 1, ledger_entries: 1, funding_entries: 1, eur: "500.000000000000" });

  const retry = session();
  retry.end(`${authSql(owner)}\n${initializeSql(owner)}\n\\q`);
  const retried = snapshots(await retry.done)[0];
  assertFunded(retried, owner);
  assert.equal(retried.id, results[0].id, "later transaction retries must reuse the committed portfolio");
  console.log(`PASS: native PostgreSQL lock contention, first ${firstOutcome}, two contenders, retry, exactly one EUR500 funding`);
}

async function fundingFailureRetry() {
  const owner = randomUUID();
  await sql(`insert into auth.users (id) values (${sqlLiteral(owner)}::uuid);
    create function private.test_funding_failure() returns trigger
    language plpgsql security invoker set search_path = '' as $$ begin
      raise exception 'TEST_FUNDING_FAILURE'; end; $$;
    create trigger test_funding_failure before insert on public.portfolio_ledger
      for each row execute function private.test_funding_failure();`);
  let failed = false;
  try { await sql(`${authSql(owner)} select * from public.initialize_dry_run_portfolio(${sqlLiteral(owner)}::uuid);`); }
  catch (error) { failed = true; assert.match(String(error), /TEST_FUNDING_FAILURE/); }
  assert.ok(failed, "injected funding failure must reach the caller");
  assert.deepEqual(await storedState(owner), { portfolios: 0, ledger_entries: 0, funding_entries: 0, eur: "0.000000000000" });
  await sql("drop trigger test_funding_failure on public.portfolio_ledger; drop function private.test_funding_failure();");
  const retry = session();
  retry.end(`${authSql(owner)}\n${initializeSql(owner)}\n\\q`);
  assertFunded(snapshots(await retry.done)[0], owner);
  console.log("PASS: native PostgreSQL funding failure rolls back portfolio and ledger; retry initializes once");
}

try {
  try { await Promise.all([run("initdb", ["--version"]), run("pg_ctl", ["--version"]), run("psql", ["--version"])]); }
  catch { throw new Error("Real PostgreSQL binaries unavailable. Set PG_TEST_BIN to a directory containing initdb, pg_ctl and psql; this check is never substituted with serialized PGlite."); }
  await mkdir(temporaryRoot, { recursive: true });
  clusterDirectory = await mkdtemp(path.join(temporaryRoot, "ai003-pg-concurrency-"));
  const dataDirectory = path.join(clusterDirectory, "data");
  await run("initdb", ["-D", dataDirectory, "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--locale=C"]);
  const socket = createServer();
  port = await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => resolve(socket.address().port));
  });
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  // Packaged Unix builds may default sockets to /var/run/postgresql, which
  // isn't writable by an unprivileged CI user. Keep sockets in this fixture.
  const serverOptions = `-h 127.0.0.1 -p ${port}`
    + (process.platform === "win32" ? "" : ` -k "${clusterDirectory}"`);
  await run("pg_ctl", ["-D", dataDirectory, "-l", path.join(clusterDirectory, "postgres.log"),
    "-o", serverOptions, "-w", "-t", "15", "start"]);
  started = true;
  await sql(await readFile(path.join(workspace, "tests/database/support/supabase-auth-shim.sql"), "utf8"));
  const migrationDirectory = path.join(workspace, "supabase/migrations");
  for (const migration of (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort()) {
    await sql(await readFile(path.join(migrationDirectory, migration), "utf8"));
  }
  // Exercise the deployment acceptance scripts on native PostgreSQL as well
  // as PGlite; each script rolls back its synthetic owners and ledger rows.
  for (const script of ["hosted-rls.sql", "hosted-portfolio.sql"]) {
    const result = await sql(await readFile(path.join(workspace, "tests/database", script), "utf8"));
    assert.match(result, /verification passed; all fixtures rolled back/);
    assert.equal(await sql("select count(*) from public.portfolios;"), "0");
    assert.equal(await sql("select count(*) from public.portfolio_ledger;"), "0");
    console.log(`PASS: native PostgreSQL ${script}, authorization and fixture rollback`);
  }
  await race("commit");
  await race("rollback");
  await fundingFailureRetry();
  console.log("All real PostgreSQL concurrency/atomicity checks passed.");
} finally {
  for (const child of children) child.kill();
  if (started) await run("pg_ctl", ["-D", path.join(clusterDirectory, "data"), "-m", "fast", "-w", "stop"]);
  if (clusterDirectory) {
    const resolved = await realpath(clusterDirectory);
    const expectedParent = path.join(workspace, ".tmp");
    assert.equal(path.dirname(resolved).toLowerCase(), expectedParent.toLowerCase(), "cleanup must stay inside workspace .tmp");
    assert.ok(path.basename(resolved).startsWith("ai003-pg-concurrency-"), "cleanup must target this disposable cluster");
    await rm(resolved, { recursive: true, force: true });
  }
}
