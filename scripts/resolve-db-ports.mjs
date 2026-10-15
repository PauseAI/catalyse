// Gives this worktree its own DB_PORT/TEST_DB_PORT (and patches the matching
// port into DATABASE_URL/TEST_DATABASE_URL) so parallel worktrees never share
// a Postgres container — same idea as other worktree-aware ports on this
// machine, via the `worktree-port` tool (a dedicated pool, so ranges never
// collide with other projects' or other pools' ports).
//
// No-op in a main checkout: worktree-port exits 1, and the defaults baked
// into docker-compose.yml / .env.local.example (5432/5433, TEST_DATABASE_URL
// unset) are left exactly as the maintainers chose them.
//
// In a linked worktree, TEST_DATABASE_URL is forced ON (even if commented out
// or absent) — a worktree used for both a manual/CiC dev session and test
// runs must never have tests silently fall back to DATABASE_URL.
//
// DB_PORT/TEST_DB_PORT go in `.env` (docker compose's own default env file,
// for `docker compose up -d` run bare) as well as `.env.local` (read by the
// app and test scripts via DATABASE_URL/TEST_DATABASE_URL).
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function resolvePort(pool) {
  try {
    return execSync(`worktree-port --pool ${pool}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const devPort = resolvePort("db-dev");
const testPort = resolvePort("db-test");
if (!devPort && !testPort) process.exit(0);

function setVar(path, key, value) {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text}\n${key}=${value}\n`;
  writeFileSync(path, text);
}

if (devPort) setVar(".env", "DB_PORT", devPort);
if (testPort) setVar(".env", "TEST_DB_PORT", testPort);

if (existsSync(".env.local")) {
  let env = readFileSync(".env.local", "utf8");

  function patchUrlPort(key, port, fallbackDbName) {
    // Matches an active OR commented-out line so a disabled
    // `# TEST_DATABASE_URL=...` example gets turned on, not left behind.
    const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
    const match = env.match(re);
    if (match) {
      env = env.replace(
        re,
        match[0]
          .replace(/^#\s*/, "")
          .replace(/((?:localhost|127\.0\.0\.1)):\d+/, `$1:${port}`),
      );
      return;
    }
    const dbUrl = env.match(/^DATABASE_URL=.*$/m);
    if (!dbUrl) return;
    const synthesized = dbUrl[0]
      .replace(/^DATABASE_URL=/, `${key}=`)
      .replace(/((?:localhost|127\.0\.0\.1)):\d+/, `$1:${port}`)
      .replace(/\/[^/?]+$/, `/${fallbackDbName}`);
    env = `${env}\n${synthesized}\n`;
  }

  if (devPort) patchUrlPort("DATABASE_URL", devPort);
  if (testPort) patchUrlPort("TEST_DATABASE_URL", testPort, "catalyse_test");

  writeFileSync(".env.local", env);
}
