import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Isolated, test-only GoTrue HTTP contract fixture. Production code never imports
// this module. Real @supabase/ssr clients still parse, refresh and verify sessions.
export const TEST_EMAIL = "owner@example.test";
export const TEST_PASSWORD = "fixture-password-only";
export const TEST_PUBLISHABLE_KEY = "sb_publishable_auth_e2e_fixture";

const ownerId = "a1111111-1111-4111-8111-111111111111";
const otherOwnerId = "b2222222-2222-4222-8222-222222222222";
const signingKey = randomBytes(32);

function signJwt(claims, key = signingKey) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const content = `${header}.${payload}`;
  return `${content}.${createHmac("sha256", key).update(content).digest("base64url")}`;
}

async function readBody(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}

export async function startSupabaseAuthFixture(port, { onShutdown } = {}) {
  // Financial responses come from the version-controlled PostgreSQL migrations,
  // including their real authorization, RLS, numeric arithmetic and constraints.
  const shim = await readFile(new URL("../database/support/supabase-auth-shim.sql", import.meta.url), "utf8");
  const migrationDirectory = new URL("../../supabase/migrations/", import.meta.url);
  const migrationNames = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const migrations = await Promise.all(migrationNames.map((name) => readFile(new URL(name, migrationDirectory), "utf8")));
  async function createDatabase() {
    const instance = new PGlite();
    await instance.exec(shim);
    for (const migration of migrations) await instance.exec(migration);
    await instance.query("insert into auth.users (id, aud, role) values ($1, 'authenticated', 'authenticated'), ($2, 'authenticated', 'authenticated')", [ownerId, otherOwnerId]);
    return instance;
  }
  let database = await createDatabase();
  let databaseQueue = Promise.resolve();
  function withDatabase(operation) {
    // PGlite uses one connection; serialize transaction contexts rather than
    // allowing one HTTP request's SET LOCAL ROLE to affect another request.
    const result = databaseQueue.then(() => operation(database));
    databaseQueue = result.catch(() => {});
    return result;
  }
  let rpcControl = { readFailures: 0, initializeFailures: 0, readDelay: 0, initializeDelay: 0 };
  const sessions = new Map();
  const refreshTokens = new Map();
  const statistics = { password: 0, refresh: 0, user: 0, logout: 0, rejected: 0 };

  function createSession({ expired = false, forged = false, disabled = false, anonymous = false, invalidRefresh = false, otherOwner = false } = {}) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const sessionId = randomUUID();
    const refreshToken = randomUUID();
    const expiresAt = expired ? issuedAt - 120 : issuedAt + 3600;
    const user = {
      id: otherOwner ? otherOwnerId : ownerId,
      aud: "authenticated",
      role: "authenticated",
      email: TEST_EMAIL,
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
      confirmed_at: "2026-01-01T00:00:00.000Z",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      is_anonymous: anonymous,
    };
    const accessToken = signJwt({
      iss: `http://127.0.0.1:${port}/auth/v1`,
      sub: user.id,
      aud: "authenticated",
      exp: expiresAt,
      iat: issuedAt - (expired ? 3720 : 0),
      role: "authenticated",
      email: TEST_EMAIL,
      aal: "aal1",
      amr: [{ method: "password", timestamp: issuedAt }],
      session_id: sessionId,
      is_anonymous: anonymous,
    }, forged ? randomBytes(32) : signingKey);
    const session = {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expired ? -120 : 3600,
      expires_at: expiresAt,
      refresh_token: refreshToken,
      user,
    };
    sessions.set(sessionId, { user, disabled });
    if (!invalidRefresh) refreshTokens.set(refreshToken, sessionId);
    return session;
  }

  function verifyToken(token) {
    const [header, payload, signature, extra] = (token ?? "").split(".");
    if (!header || !payload || !signature || extra) return null;
    try {
      if (JSON.parse(Buffer.from(header, "base64url").toString("utf8")).alg !== "HS256") return null;
      const actual = Buffer.from(signature, "base64url");
      const expected = createHmac("sha256", signingKey).update(`${header}.${payload}`).digest();
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      const record = sessions.get(claims.session_id);
      if (claims.exp <= Math.floor(Date.now() / 1000) || !record || record.disabled || claims.sub !== record.user.id) return null;
      return { ...record, sessionId: claims.session_id, claims };
    } catch {
      return null;
    }
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-supabase-api-version");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Cache-Control", "no-store");
    const send = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const deny = (message = "Invalid authentication session", code = "bad_jwt") => {
      statistics.rejected += 1;
      send(401, { msg: message, error_code: code });
    };

    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      // Fixture control endpoints exist only on this dedicated loopback server.
      if (url.pathname === "/__test/session" && request.method === "POST") {
        send(200, createSession(await readBody(request)));
        return;
      }
      if (url.pathname === "/__test/stats") {
        send(200, statistics);
        return;
      }
      if (url.pathname === "/__test/portfolio/reset" && request.method === "POST") {
        await withDatabase(async (instance) => {
          await instance.close();
          database = await createDatabase();
          rpcControl = { readFailures: 0, initializeFailures: 0, readDelay: 0, initializeDelay: 0 };
        });
        send(200, { reset: true });
        return;
      }
      if (url.pathname === "/__test/portfolio/control" && request.method === "POST") {
        const options = await readBody(request);
        for (const name of Object.keys(rpcControl)) {
          if (Number.isInteger(options[name]) && options[name] >= 0 && options[name] <= 5000) rpcControl[name] = options[name];
        }
        send(200, { configured: true });
        return;
      }
      if (url.pathname === "/__test/portfolio/unfunded" && request.method === "POST") {
        await withDatabase((instance) => instance.query("insert into public.portfolios (owner_id) values ($1)", [ownerId]));
        send(200, { created: true });
        return;
      }
      if (url.pathname === "/__test/portfolio/stats") {
        const result = await withDatabase((instance) => instance.query(`
          select (select count(*)::integer from public.portfolios) as portfolios,
            count(*)::integer as ledger_entries,
            count(*) filter (where transaction_type = 'INITIAL_CAPITAL')::integer as initial_funding_entries,
            coalesce(sum(amount) filter (where currency = 'EUR'), 0)::text as eur_balance
          from public.portfolio_ledger
        `));
        send(200, result.rows[0]);
        return;
      }
      if (url.pathname === "/__test/shutdown" && request.method === "POST" && onShutdown) {
        send(200, { stopped: true });
        setImmediate(onShutdown);
        return;
      }
      if (request.headers.apikey !== TEST_PUBLISHABLE_KEY) {
        deny("Invalid fixture publishable key");
        return;
      }
      if (url.pathname === "/auth/v1/token" && request.method === "POST") {
        const body = await readBody(request);
        if (url.searchParams.get("grant_type") === "password") {
          statistics.password += 1;
          if (body.email !== TEST_EMAIL || body.password !== TEST_PASSWORD) {
            send(400, { msg: "Invalid login credentials", error_code: "invalid_credentials" });
          } else {
            send(200, createSession());
          }
          return;
        }
        if (url.searchParams.get("grant_type") === "refresh_token") {
          statistics.refresh += 1;
          const sessionId = refreshTokens.get(body.refresh_token);
          const session = sessions.get(sessionId);
          if (!session || session.disabled) {
            deny("Invalid Refresh Token", "refresh_token_not_found");
          } else {
            refreshTokens.delete(body.refresh_token);
            send(200, createSession({ anonymous: session.user.is_anonymous, otherOwner: session.user.id === otherOwnerId }));
          }
          return;
        }
      }
      if (url.pathname === "/auth/v1/user" && request.method === "GET") {
        statistics.user += 1;
        const record = verifyToken(request.headers.authorization?.replace(/^Bearer\s+/i, ""));
        if (!record) deny();
        else send(200, record.user);
        return;
      }
      if (url.pathname === "/auth/v1/logout" && request.method === "POST") {
        statistics.logout += 1;
        const record = verifyToken(request.headers.authorization?.replace(/^Bearer\s+/i, ""));
        if (!record) {
          deny();
        } else {
          // Supabase logout revokes refresh tokens. A previously issued access
          // JWT can remain valid until expiry; do not claim immediate revocation.
          for (const [token, sessionId] of refreshTokens) {
            if (sessionId === record.sessionId) refreshTokens.delete(token);
          }
          response.writeHead(204);
          response.end();
        }
        return;
      }
      if (request.method === "POST" && ["/rest/v1/rpc/get_dry_run_portfolio", "/rest/v1/rpc/initialize_dry_run_portfolio"].includes(url.pathname)) {
        const record = verifyToken(request.headers.authorization?.replace(/^Bearer\s+/i, ""));
        if (!record) {
          deny();
          return;
        }
        const initialize = url.pathname.endsWith("/initialize_dry_run_portfolio");
        const failureKey = initialize ? "initializeFailures" : "readFailures";
        const delayKey = initialize ? "initializeDelay" : "readDelay";
        const delay = rpcControl[delayKey];
        rpcControl[delayKey] = 0;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if (rpcControl[failureKey] > 0) {
          rpcControl[failureKey] -= 1;
          send(503, { code: "FIXTURE_DATABASE_UNAVAILABLE", message: "Synthetic database outage detail must never be shown in the UI" });
          return;
        }
        const body = await readBody(request);
        try {
          const result = await withDatabase(async (instance) => {
            await instance.exec("begin; set local role authenticated;");
            try {
              await instance.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [record.user.id, JSON.stringify(record.claims)]);
              const functionName = initialize ? "initialize_dry_run_portfolio" : "get_dry_run_portfolio";
              const result = await instance.query(`select * from public.${functionName}($1::uuid)`, [body.p_owner_id]);
              await instance.exec("commit");
              return result;
            } catch (error) {
              await instance.exec("rollback");
              throw error;
            }
          });
          send(200, result.rows);
        } catch (error) {
          send(error.code === "42501" ? 403 : 400, { code: error.code, message: error.message, details: null, hint: null });
        }
        return;
      }
      send(404, { msg: `Unsupported test Auth endpoint: ${request.method} ${url.pathname}` });
    } catch (error) {
      send(500, { msg: error instanceof Error ? error.message : "Fixture request failed" });
    }
  });
  let databaseClosePromise;
  server.closeDatabase = () => {
    databaseClosePromise ??= withDatabase((instance) => instance.close());
    return databaseClosePromise;
  };
  server.once("close", () => { void server.closeDatabase(); });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
