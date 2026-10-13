// Postgres em memória (PGlite) exposto por socket para os testes de integração.
// Aplica as migrações reais de supabase/migrations e, por padrão, roda o bootstrap oficial (scripts/db-bootstrap.js).
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const serverDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const migrationsDir = join(serverDir, "..", "supabase", "migrations");

// COUNT(*) e afins voltam como bigint; os testes comparam com números.
const numberify = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function applyMigrations(db) {
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf-8"));
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING", [`supabase/${file}`]);
  }
}

export function runScript(script, env, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join("scripts", script), ...args], {
      cwd: serverDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

// extraEnv alimenta o bootstrap (ex.: SIGMA_DEMO). Com bootstrap:false só o schema é criado.
export async function startPostgres(extraEnv = {}, { bootstrap = true, migrate = true } = {}) {
  const db = await PGlite.create();
  if (migrate) await applyMigrations(db);
  const port = await freePort();
  const socket = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 4 });
  await socket.start();
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  const env = { DATABASE_URL: url, DATABASE_SSL: "disable", DATABASE_POOL_MAX: "1" };
  const handle = {
    url,
    env,
    query: async (text, values) => (await db.query(text, values)).rows.map(numberify),
    exec: (text) => db.exec(text),
    runBootstrap: (more = {}) => runScript("db-bootstrap.js", { ...env, ...extraEnv, ...more }),
    runMigrate: (more = {}) => runScript("db-migrate.js", { ...env, ...more }),
    async close() {
      await socket.stop();
      await db.close();
    },
  };
  if (bootstrap) {
    const result = await handle.runBootstrap();
    if (result.code !== 0) {
      await handle.close();
      throw new Error(`Bootstrap de teste falhou:\n${result.output}`);
    }
  }
  return handle;
}