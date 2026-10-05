import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(serverDir, "src");
const dataDir = join(srcDir, "data");

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : path.endsWith(".js") ? [path] : [];
});

test("Camada de dados: nenhuma query, driver ou conexão fora de src/data", () => {
  const forbidden = [
    [/\bbetter-sqlite3\b/, "driver do banco"],
    [/\bdb\.(prepare|exec|transaction|pragma)\b/, "acesso direto à conexão"],
    [/\b(SELECT\s+[\w*(]|INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX)|ALTER\s+TABLE)\b/, "instrução SQL"],
    [/from\s+["'][./]*data\/(connection|migrations|repositories\/[\w-]+)\.js["']/, "import interno da camada (use data/index.js)"],
  ];
  const violations = [];
  for (const file of files(srcDir).filter((path) => !path.startsWith(dataDir))) {
    readFileSync(file, "utf-8").split("\n").forEach((line, index) => {
      for (const [pattern, reason] of forbidden) {
        if (pattern.test(line)) violations.push(`${relative(serverDir, file)}:${index + 1} (${reason}) ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(violations, [], `SQL/acesso ao banco fora de src/data:\n${violations.join("\n")}`);
});

test("Documentação do banco (docs/) em dia e DDL consolidado equivalente às migrações", () => {
  const check = spawnSync(process.execPath, ["scripts/gerar-doc-banco.js", "--check"], { cwd: serverDir, encoding: "utf-8" });
  assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);

  // O schema-completo.sql, aplicado num banco vazio, gera exatamente as mesmas tabelas, colunas e chaves.
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-ddl-"));
  try {
    const fromDocs = new Database(join(tempDir, "docs.db"));
    fromDocs.exec(readFileSync(join(serverDir, "..", "docs", "schema-completo.sql"), "utf-8"));
    const migrated = spawnSync(process.execPath, ["--input-type=module", "-e", `
      process.env.DB_PATH = ${JSON.stringify(join(tempDir, "migrado.db"))};
      process.env.ENV_FILE = ${JSON.stringify(join(tempDir, "sem-env"))};
      const { migrate } = await import(${JSON.stringify(new URL("../src/data/migrations.js", import.meta.url).href)});
      migrate();
    `], { cwd: serverDir, encoding: "utf-8" });
    assert.equal(migrated.status, 0, migrated.stderr);
    const fromMigrations = new Database(join(tempDir, "migrado.db"), { readonly: true });
    const shape = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => ({
        name,
        columns: db.prepare(`PRAGMA table_info("${name}")`).all().map(({ name: column, type, notnull, dflt_value: dflt, pk }) => ({ column, type, notnull, dflt, pk })),
        fks: db.prepare(`PRAGMA foreign_key_list("${name}")`).all().map(({ table, from, to, on_delete: onDelete }) => ({ table, from, to, onDelete })),
        indexes: db.prepare(`PRAGMA index_list("${name}")`).all().map(({ unique }) => unique).sort(),
      }));
    assert.deepEqual(shape(fromDocs), shape(fromMigrations));
    fromDocs.close();
    fromMigrations.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
