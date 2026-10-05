import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));

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
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`API saiu com código ${code}:\n${output}`));
    });
  });
}

async function startApi(port, dbPath) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), JWT_SECRET: "migration-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const output = await waitForApi(child);
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", senha: "admin123" }),
    });
    assert.equal(response.status, 200, `Login falhou após subir a API:\n${output}`);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}

function readCounts(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = [
      "usuarios", "equipes", "equipamentos", "colaboradores", "notas",
      "ordens", "apontamentos", "sinalizacoes_ia", "schema_migrations",
    ];
    const counts = Object.fromEntries(tables.map((table) => [
      table,
      db.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get().total,
    ]));
    const migrationIds = db.prepare("SELECT id FROM schema_migrations ORDER BY id")
      .all().map(({ id }) => id);
    return { counts, migrationIds };
  } finally {
    db.close();
  }
}

test("API inicia duas vezes sem repetir migrações ou seed", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-migrations-"));
  const dbPath = join(tempDir, "test.db");

  try {
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        papel TEXT NOT NULL DEFAULT 'EXECUTANTE',
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const adminHash = bcrypt.hashSync("admin123", 4);
    legacyDb.prepare(
      "INSERT INTO usuarios (id, nome, username, senha_hash, papel) VALUES (7, ?, ?, ?, ?)"
    ).run("Ana Souza", "admin", adminHash, "CCM");
    legacyDb.close();

    await startApi(31471, dbPath);
    const firstStart = readCounts(dbPath);
    await startApi(31472, dbPath);
    const secondStart = readCounts(dbPath);
    const migratedDb = new Database(dbPath, { readonly: true });
    const preservedAdmin = migratedDb.prepare(
      "SELECT id, senha_hash, email, ativo FROM usuarios WHERE username = ?"
    ).get("admin");
    try {
      assert.deepEqual(secondStart, firstStart);
      assert.equal(firstStart.counts.usuarios, 3);
      assert.equal(firstStart.counts.schema_migrations, 13);
      assert.equal(migratedDb.prepare("SELECT valor FROM parametros_kpi WHERE chave = 'antecedencia_preventiva_dias'").get().valor, 7);
      assert.equal(migratedDb.prepare("SELECT COUNT(*) AS total FROM formularios_modelos").get().total, 3);
      assert.ok(migratedDb.pragma("table_info(ordens)").some((column) => column.name === "exige_pt"));
      assert.equal(migratedDb.prepare("SELECT valor FROM parametros_kpi WHERE chave = 'carga_maxima'").get().valor, 100);
      assert.equal(migratedDb.pragma("table_info(passagens_turno)").length, 10);
      assert.equal(migratedDb.prepare("SELECT valor FROM parametros_kpi WHERE chave = 'meta_disponibilidade'").get().valor, 95);
      assert.ok(migratedDb.pragma("table_info(ordens)").some((column) => column.name === "data_fim_programada"));
      assert.ok(firstStart.migrationIds.includes("2026-10-02_users_as_collaborators"));
      // Cada usuário tem um colaborador vinculado (colaborador = usuário).
      assert.equal(migratedDb.prepare("SELECT COUNT(*) AS total FROM usuarios u WHERE NOT EXISTS (SELECT 1 FROM colaboradores c WHERE c.usuario_id = u.id)").get().total, 0);
      assert.ok(firstStart.migrationIds.includes("2026-10-02_labor_availability_and_user_team"));
      assert.ok(firstStart.migrationIds.includes("2026-10-02_om_execution_timer"));
      assert.ok(migratedDb.pragma("table_info(usuarios)").some((column) => column.name === "equipe_id"));
      assert.ok(migratedDb.pragma("table_info(ocorrencias_hh)").some((column) => column.name === "horas_dia"));
      assert.equal(migratedDb.pragma("table_info(hh_disponivel)").length, 6);
      assert.ok(firstStart.migrationIds.includes("2026-10-02_equipment_tag_unique_index"));
      assert.ok(firstStart.migrationIds.includes("2026-10-02_reliability_duration_fields"));
      assert.equal(preservedAdmin.id, 7);
      assert.equal(preservedAdmin.senha_hash, adminHash);
      assert.equal(preservedAdmin.email, null);
      assert.equal(preservedAdmin.ativo, 1);
      const reportColumns = migratedDb.pragma("table_info(relatorios_execucao)").map((column) => column.name);
      assert.ok(reportColumns.includes("indisponibilidade_horas"));
      assert.ok(reportColumns.includes("tempo_reparo_horas"));
    } finally {
      migratedDb.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});