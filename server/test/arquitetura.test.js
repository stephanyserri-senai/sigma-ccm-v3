import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(serverDir, "src");
const dataDir = join(srcDir, "data");

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : path.endsWith(".js") ? [path] : [];
});

test("Camada de dados: nenhuma query, driver ou conexão fora de src/data", () => {
  const forbidden = [
    [/\bfrom\s+["'](pg|better-sqlite3)["']/, "driver do banco"],
    [/\b(pool|client|database\(\))\.query\b/, "acesso direto à conexão"],
    [/\b(SELECT\s+[\w*(]|INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX)|ALTER\s+TABLE)\b/, "instrução SQL"],
    [/from\s+["'][./]*data\/(connection|bootstrap|repositories\/[\w-]+)(\/index)?\.js["']/, "import interno da camada (use data/index.js)"],
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

test("Documentação do banco (docs/banco-de-dados.md) em dia com as migrações do Supabase", () => {
  const check = spawnSync(process.execPath, ["scripts/gerar-doc-banco.js", "--check"], { cwd: serverDir, encoding: "utf-8" });
  assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
});

test("API exportável para serverless: importar app.js não abre porta nem conecta ao banco", () => {
  const appUrl = new URL("../src/app.js", import.meta.url).href;
  const loaded = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { app } = await import(${JSON.stringify(appUrl)});
    if (typeof app !== "function") throw new Error("app não é um handler Express");
  `], {
    cwd: serverDir, encoding: "utf-8", timeout: 15000,
    env: { ...process.env, DATABASE_URL: "postgresql://postgres:x@127.0.0.1:1/postgres", DATABASE_SSL: "disable", ENV_FILE: join(serverDir, "nao-existe.env") },
  });
  assert.equal(loaded.status, 0, `${loaded.stdout}${loaded.stderr}`);
});

test("Dependências: driver pg presente e SQLite fora do projeto", () => {
  const manifest = JSON.parse(readFileSync(join(serverDir, "package.json"), "utf-8"));
  assert.ok(manifest.dependencies.pg);
  assert.equal(manifest.dependencies["better-sqlite3"], undefined);
});