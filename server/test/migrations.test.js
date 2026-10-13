import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { migrationsDir, startPostgres } from "./helpers/postgres.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const INITIAL = "20261013000000_initial_schema.sql";

function waitForApi(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`API startup timed out:\n${output}`)), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("SIGMA-CCM API em")) {
        clearTimeout(timer);
        resolve(output);
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`API saiu com código ${code}:\n${output}`)); });
  });
}

async function startApi(pg, port) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, ...pg.env, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "migration-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const output = await waitForApi(child);
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", senha: "admin123" }),
    });
    assert.equal(response.status, 200, `Login falhou apos subir a API:\n${output}`);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}

async function snapshot(pg) {
  const tables = ["usuarios", "equipes", "equipamentos", "colaboradores", "notas", "ordens", "apontamentos", "sinalizacoes_ia", "formularios_modelos", "parametros_kpi", "schema_migrations"];
  const counts = {};
  for (const table of tables) counts[table] = (await pg.query(`SELECT COUNT(*) AS total FROM "${table}"`))[0].total;
  const migrationIds = (await pg.query("SELECT id FROM schema_migrations ORDER BY id")).map(({ id }) => id);
  return { counts, migrationIds };
}

const publicTables = async (pg) => (await pg.query("SELECT COUNT(*) AS total FROM pg_tables WHERE schemaname = 'public'"))[0].total;

test("db:migrate aplica as migrações do Supabase em ordem e é idempotente", async () => {
  const pg = await startPostgres({}, { bootstrap: false, migrate: false });
  try {
    const first = await pg.runMigrate();
    assert.equal(first.code, 0, first.output);
    assert.match(first.output, /20261013000000_initial_schema\.sql/);
    assert.match(first.output, /20261013000100_double_precision_hours\.sql/);
    assert.match(first.output, /20261013000200_work_order_priority_flow\.sql/);
    assert.match(first.output, /20261013000300_priority_shutdown_confirmation\.sql/);
    assert.equal(await publicTables(pg), 38);
    const ids = (await pg.query("SELECT id FROM schema_migrations WHERE id LIKE 'supabase/%' ORDER BY id")).map(({ id }) => id);
    assert.deepEqual(ids, [
      "supabase/20261013000000_initial_schema.sql",
      "supabase/20261013000100_double_precision_hours.sql",
      "supabase/20261013000200_work_order_priority_flow.sql",
      "supabase/20261013000300_priority_shutdown_confirmation.sql",
    ]);

    const second = await pg.runMigrate();
    assert.equal(second.code, 0, second.output);
    assert.doesNotMatch(second.output, /Migração aplicada/);

    const rls = await pg.query("SELECT COUNT(*) AS total FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity");
    assert.equal(rls[0].total, 0, "todas as tabelas públicas precisam de RLS");
    const types = await pg.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'relatorios_execucao' AND column_name = 'tempo_reparo_horas'");
    assert.equal(types[0].data_type, "double precision");
  } finally {
    await pg.close();
  }
});

test("db:migrate reconhece o esquema inicial já criado (SQL Editor/CLI) sem reexecutá-lo", async () => {
  const pg = await startPostgres({}, { bootstrap: false, migrate: false });
  try {
    await pg.exec(readFileSync(join(migrationsDir, INITIAL), "utf-8"));
    await pg.query("DELETE FROM schema_migrations");
    const result = await pg.runMigrate();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /registrado sem reexecutar/);
    assert.match(result.output, /20261013000100_double_precision_hours\.sql/);
    assert.match(result.output, /20261013000200_work_order_priority_flow\.sql/);
    assert.match(result.output, /20261013000300_priority_shutdown_confirmation\.sql/);
    assert.equal(await publicTables(pg), 38);
  } finally {
    await pg.close();
  }
});

test("bootstrap é explícito e idempotente; a API inicia várias vezes sem migrar nem repovoar", async () => {
  const pg = await startPostgres({ SIGMA_DEMO: "0" }, { bootstrap: false });
  try {
    await startApi(pg, 31471).then(
      () => assert.fail("o login deveria falhar: a API não popula o banco ao iniciar"),
      (error) => assert.match(error.message, /Login falhou/),
    );
    assert.equal((await snapshot(pg)).counts.usuarios, 0);

    const boot = await pg.runBootstrap();
    assert.equal(boot.code, 0, boot.output);
    const afterBootstrap = await snapshot(pg);
    assert.equal(afterBootstrap.counts.usuarios, 3);
    assert.equal(afterBootstrap.counts.formularios_modelos, 3);
    assert.equal((await pg.query("SELECT valor FROM parametros_kpi WHERE chave = 'meta_disponibilidade'"))[0].valor, 95);
    // Cada usuário tem um colaborador vinculado (colaborador = usuário).
    assert.equal((await pg.query("SELECT COUNT(*) AS total FROM usuarios u WHERE NOT EXISTS (SELECT 1 FROM colaboradores c WHERE c.usuario_id = u.id)"))[0].total, 0);

    const again = await pg.runBootstrap();
    assert.equal(again.code, 0, again.output);
    assert.deepEqual(await snapshot(pg), afterBootstrap);

    await startApi(pg, 31472);
    await startApi(pg, 31473);
    assert.deepEqual(await snapshot(pg), afterBootstrap);
  } finally {
    await pg.close();
  }
});