// Gera a documentação completa do banco a partir do esquema REAL: cria um banco vazio
// temporário, aplica schema.sql + todas as migrações (as mesmas da API) e extrai a estrutura.
//   docs/schema-completo.sql  → DDL consolidado (referência; a API continua usando as migrações)
//   docs/banco-de-dados.md    → diagramas ER (Mermaid), dicionário de dados e camada de acesso
// Uso (na pasta server):  node scripts/gerar-doc-banco.js        (grava os arquivos)
//                         node scripts/gerar-doc-banco.js --check (só confere se estão atualizados)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(serverDir, "..", "docs");
const tempDir = mkdtempSync(join(tmpdir(), "sigma-schema-"));
process.env.DB_PATH = join(tempDir, "schema.db");
process.env.ENV_FILE = join(tempDir, "sem-env");
delete process.env.NODE_ENV;

const { migrate, migrations } = await import("../src/data/migrations.js");
const { database } = await import("../src/data/connection.js");
const { MODULES, TABLE_DOCS, LOGICAL_LINKS } = await import("./banco-de-dados.descricao.js");

migrate();
const db = database();
const objects = db.prepare(`
  SELECT type, name, tbl_name, sql FROM sqlite_master
  WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid
`).all();
const tables = objects.filter((item) => item.type === "table").map((item) => item.name);
// Colunas de cada índice único (restrição UNIQUE ou CREATE UNIQUE INDEX), sem a chave primária.
const uniqueSets = (table) => db.prepare(`PRAGMA index_list("${table}")`).all()
  .filter((index) => index.unique && index.origin !== "pk")
  .map((index) => db.prepare(`PRAGMA index_info("${index.name}")`).all().map((column) => column.name));
const info = Object.fromEntries(tables.map((table) => [table, {
  sql: objects.find((item) => item.name === table).sql,
  columns: db.prepare(`PRAGMA table_info("${table}")`).all(),
  foreignKeys: db.prepare(`PRAGMA foreign_key_list("${table}")`).all(),
  indexes: objects.filter((item) => item.type === "index" && item.tbl_name === table),
  uniques: uniqueSets(table),
}]));
db.close();
rmSync(tempDir, { recursive: true, force: true });

// Todas as tabelas precisam estar descritas e agrupadas: tabela nova sem documentação falha aqui.
const grouped = MODULES.flatMap((module) => module.tabelas);
const missing = tables.filter((table) => !grouped.includes(table) || !TABLE_DOCS[table]);
const extra = grouped.filter((table) => !tables.includes(table));
if (missing.length || extra.length) {
  console.error(`Documentação do banco desatualizada.\n - sem descrição/módulo: ${missing.join(", ") || "—"}\n - descritas mas inexistentes: ${extra.join(", ") || "—"}\nAtualize server/scripts/banco-de-dados.descricao.js.`);
  process.exit(1);
}

// ---------------------------------------------------------------- utilidades
// Valores permitidos (CHECK ... IN (...)) de cada coluna, lidos do DDL.
function allowedValues(sql) {
  const map = {};
  for (const match of sql.matchAll(/CHECK\s*\(\s*"?(\w+)"?\s+IN\s*\(([^)]*)\)\s*\)/gi)) {
    map[match[1]] = match[2].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
  }
  return map;
}
const uniqueColumns = (table) => new Set(info[table].uniques.filter((set) => set.length === 1).map((set) => set[0]));
// Chaves compostas: PK de várias colunas e UNIQUE de várias colunas.
function compositeKeys(table) {
  const keys = [];
  const pk = info[table].columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk).map((column) => column.name);
  if (pk.length > 1) keys.push(`PK (${pk.join(", ")})`);
  for (const set of info[table].uniques.filter((item) => item.length > 1)) keys.push(`UNIQUE (${set.join(", ")})`);
  return keys;
}
const fkOf = (table, column) => info[table].foreignKeys.find((fk) => fk.from === column);
const mdEscape = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const mermaidText = (text) => String(text).replace(/"/g, "'");

function describeColumn(table, column) {
  const notes = [];
  const custom = TABLE_DOCS[table].colunas?.[column.name];
  if (custom) notes.push(custom);
  const fk = fkOf(table, column.name);
  if (fk) notes.push(`→ \`${fk.table}.${fk.to}\`${fk.on_delete !== "NO ACTION" ? ` (ao excluir: ${fk.on_delete})` : ""}`);
  const allowed = allowedValues(info[table].sql)[column.name];
  if (allowed) notes.push(`Valores: ${allowed.map((value) => `\`${value}\``).join(", ")}`);
  return notes.join(" · ");
}

function constraintsOf(table, column, uniques) {
  const tags = [];
  if (column.pk) tags.push("PK");
  if (fkOf(table, column.name)) tags.push("FK");
  if (uniques.has(column.name)) tags.push("UNIQUE");
  if (column.notnull && !column.pk) tags.push("NOT NULL");
  return tags.join(", ");
}

// ---------------------------------------------------------------- Mermaid
function relationLines(tableList, { exceptParents = [] } = {}) {
  const lines = [];
  for (const table of tableList) {
    for (const fk of info[table].foreignKeys) {
      if (exceptParents.includes(fk.table)) continue;
      const column = info[table].columns.find((item) => item.name === fk.from);
      const parentSide = column?.notnull ? "||" : "o|";
      lines.push(`  ${fk.table} ${parentSide}--o{ ${table} : "${fk.from}"`);
    }
  }
  return [...new Set(lines)];
}

function moduleDiagram(module) {
  const lines = ["```mermaid", "erDiagram"];
  for (const table of module.tabelas) {
    const uniques = uniqueColumns(table);
    lines.push(`  ${table} {`);
    for (const column of info[table].columns) {
      const keys = [column.pk ? "PK" : null, fkOf(table, column.name) ? "FK" : null, uniques.has(column.name) && !column.pk ? "UK" : null].filter(Boolean).join(",");
      const allowed = allowedValues(info[table].sql)[column.name];
      const comment = allowed ? ` "${mermaidText(allowed.join(" | "))}"` : "";
      lines.push(`    ${column.type || "ANY"} ${column.name}${keys ? ` ${keys}` : ""}${comment}`);
    }
    lines.push("  }");
  }
  lines.push(...relationLines(module.tabelas));
  lines.push("```");
  return lines.join("\n");
}

function overviewDiagram() {
  const lines = ["```mermaid", "erDiagram"];
  // Sem as colunas de autoria (→ usuarios), que ligariam quase todas as tabelas a ela.
  lines.push(...relationLines(tables, { exceptParents: ["usuarios"] }));
  lines.push("```");
  return lines.join("\n");
}

// ---------------------------------------------------------------- schema-completo.sql
const sqlLines = [
  "-- ============================================================",
  "--  SIGMA·CCM · Esquema completo do banco (SQLite) — REFERÊNCIA",
  "--  Gerado por server/scripts/gerar-doc-banco.js a partir de server/schema.sql",
  `--  + ${migrations.length} migrações de server/src/data/migrations.js. NÃO edite à mão.`,
  "--  A API cria/atualiza o banco pelas migrações idempotentes (o .db existente é preservado);",
  "--  este arquivo serve para consulta, revisão e para recriar o banco em outra ferramenta.",
  "-- ============================================================",
  "",
  "PRAGMA foreign_keys = ON;",
];
for (const module of MODULES) {
  sqlLines.push("", `-- ------------------------------------------------------------`, `-- ${module.nome}`, `-- ------------------------------------------------------------`);
  for (const table of module.tabelas) {
    sqlLines.push("", `-- ${TABLE_DOCS[table].descricao}`, `${info[table].sql.replace(/CREATE TABLE "?(\w+)"?/, "CREATE TABLE IF NOT EXISTS $1")};`);
    for (const index of info[table].indexes) sqlLines.push(`${index.sql.replace(/CREATE (UNIQUE )?INDEX (IF NOT EXISTS )?/, "CREATE $1INDEX IF NOT EXISTS ")};`);
  }
}
sqlLines.push("", "-- Migrações aplicadas (registradas em schema_migrations):", ...migrations.map((item) => `--   ${item.id}`), "");
const schemaSql = sqlLines.join("\n");

// ---------------------------------------------------------------- banco-de-dados.md
const md = [];
md.push("# Banco de dados do SIGMA·CCM", "");
md.push("> Documento gerado por `server/scripts/gerar-doc-banco.js` a partir do esquema real (schema.sql + migrações).",
  "> Não edite à mão: altere as descrições em `server/scripts/banco-de-dados.descricao.js` e rode o script.", "");
md.push(`**${tables.length} tabelas** em ${MODULES.length} módulos · ${objects.filter((item) => item.type === "index").length} índices · ${migrations.length} migrações · SQLite (WAL, chaves estrangeiras ligadas).`, "");
md.push("## Como o banco é criado e evolui", "",
  "1. `server/schema.sql` cria as tabelas base (`CREATE TABLE IF NOT EXISTS`).",
  "2. `server/src/data/migrations.js` aplica, em ordem, as migrações ainda não registradas em `schema_migrations`. Cada migração é idempotente e roda numa transação; nenhuma apaga dados, então o `.db` existente é sempre preservado.",
  "3. `server/src/data/seed.js` faz a carga inicial: administrador do ambiente (produção) ou contas de exemplo (desenvolvimento) e, se `SIGMA_DEMO` estiver ligado, os dados de demonstração (uma única vez).",
  "4. `docs/schema-completo.sql` é o DDL consolidado, gerado deste mesmo processo, para consulta e para recriar o banco em outra ferramenta.", "");
md.push("## Camada de acesso a dados", "",
  "Nenhuma rota ou serviço escreve SQL. Todo acesso ao banco passa por `server/src/data`:", "",
  "| Arquivo | Papel |", "|---|---|",
  "| `data/connection.js` | Único módulo que conhece o driver (better-sqlite3): conexão, cache de instruções, `transaction()` e tradução de erros de restrição. |",
  "| `data/migrations.js` | Estrutura do banco: schema.sql + migrações idempotentes. |",
  "| `data/seed.js`, `data/seed-demo.js` | Carga inicial e dados de demonstração. |",
  "| `data/repositories/*.js` | Um repositório por entidade, com funções de consulta e gravação (abaixo). |",
  "| `data/index.js` | Ponto de entrada: `initDatabase()`, `transaction()` e os repositórios (`ordensRepo`, `usuariosRepo`…). |", "",
  "Para trocar de banco (por exemplo, PostgreSQL), reimplemente apenas `server/src/data` mantendo os nomes e retornos das funções dos repositórios; rotas e serviços não mudam. O teste `server/test/arquitetura.test.js` impede SQL fora dessa pasta.", "");
md.push("## Visão geral das relações", "",
  "Para legibilidade, este diagrama omite as colunas de autoria que apontam para `usuarios` (`usuario_id`, `criado_por`, `registrado_por`, `responsavel_id`…); elas aparecem nos diagramas de cada módulo.", "",
  overviewDiagram(), "");
md.push("Ligações lógicas (sem chave estrangeira no banco):", "", ...LOGICAL_LINKS.map((item) => `- ${item}`), "");

md.push("## Módulos", "");
for (const module of MODULES) {
  md.push(`### ${module.nome}`, "", module.descricao, "", moduleDiagram(module), "");
  for (const table of module.tabelas) {
    const doc = TABLE_DOCS[table];
    const uniques = uniqueColumns(table);
    md.push(`#### \`${table}\``, "", doc.descricao, "");
    if (doc.repositorio) md.push(`Repositório: \`server/src/data/repositories/${doc.repositorio}\``, "");
    md.push("| Coluna | Tipo | Restrições | Padrão | Descrição |", "|---|---|---|---|---|");
    for (const column of info[table].columns) {
      md.push(`| \`${column.name}\` | ${column.type || "—"} | ${constraintsOf(table, column, uniques) || "—"} | ${column.dflt_value == null ? "—" : `\`${mdEscape(column.dflt_value)}\``} | ${mdEscape(describeColumn(table, column)) || "—"} |`);
    }
    const indexes = info[table].indexes.map((index) => `\`${index.name}\``);
    const composite = compositeKeys(table);
    if (indexes.length || composite.length) {
      md.push("");
      if (composite.length) md.push(`Chaves compostas: ${composite.map((key) => `\`${key}\``).join(", ")}.`);
      if (indexes.length) md.push(`Índices: ${indexes.join(", ")}.`);
    }
    md.push("");
  }
}
md.push("## Migrações", "", "| # | Id |", "|---|---|", ...migrations.map((item, index) => `| ${index + 1} | \`${item.id}\` |`), "");
const markdown = md.join("\n");

// ---------------------------------------------------------------- gravação / conferência
const targets = [[join(docsDir, "schema-completo.sql"), schemaSql], [join(docsDir, "banco-de-dados.md"), markdown]];
if (process.argv.includes("--check")) {
  const stale = targets.filter(([path, text]) => {
    try { return readFileSync(path, "utf-8").replace(/\r\n/g, "\n") !== text; } catch { return true; }
  });
  if (stale.length) {
    console.error(`Documentação do banco desatualizada: ${stale.map(([path]) => path).join(", ")}\nRode: node scripts/gerar-doc-banco.js`);
    process.exit(1);
  }
  console.log("Documentação do banco em dia.");
} else {
  for (const [path, text] of targets) writeFileSync(path, text, "utf-8");
  console.log(`Gerados: ${targets.map(([path]) => path).join(", ")} (${tables.length} tabelas).`);
}
