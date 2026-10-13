// Gera docs/banco-de-dados.md a partir do esquema REAL do PostgreSQL: sobe um Postgres em memória (PGlite),
// aplica todas as migrações de supabase/migrations e lê a estrutura pelo catálogo (pg_catalog).
//   docs/banco-de-dados.md → diagramas ER (Mermaid), dicionário de dados e camada de acesso
// docs/schema-completo.sql é a referência histórica do SQLite (congelada); o esquema vigente é supabase/migrations.
// Uso (na pasta server):  node scripts/gerar-doc-banco.js        (grava o arquivo)
//                         node scripts/gerar-doc-banco.js --check (só confere se está atualizado)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(serverDir, "..", "docs");
const migrationsDir = join(serverDir, "..", "supabase", "migrations");
const { MODULES, TABLE_DOCS, LOGICAL_LINKS } = await import("./banco-de-dados.descricao.js");

const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const pg = await PGlite.create();
for (const file of migrations) await pg.exec(readFileSync(join(migrationsDir, file), "utf-8"));
const rows = async (text) => (await pg.query(text)).rows;

const tableRows = await rows(`
  SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
const tables = tableRows.map((row) => row.name);
const columnRows = await rows(`
  SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`);
const constraintRows = await rows(`
  SELECT c.conrelid::regclass::text AS tbl, c.contype, c.confrelid::regclass::text AS reftbl, c.confdeltype AS ondelete,
    pg_get_constraintdef(c.oid) AS def,
    (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
    (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS refcols
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`);
const indexRows = await rows(`
  SELECT t.relname AS tbl, i.relname AS name, ix.indisunique AS uniq, ix.indisprimary AS pk,
    (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum) AS cols
  FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' ORDER BY t.relname, i.relname`);
await pg.close();

const ON_DELETE = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
const info = Object.fromEntries(tables.map((table) => {
  const pkCols = constraintRows.find((item) => item.tbl === table && item.contype === "p")?.cols ?? [];
  const indexes = indexRows.filter((item) => item.tbl === table);
  return [table, {
    columns: columnRows.filter((item) => item.table_name === table).map((item) => ({
      name: item.column_name,
      type: item.data_type.toUpperCase().replace(/\s+/g, "_"),
      notnull: item.is_nullable === "NO",
      dflt_value: item.column_default,
      pk: pkCols.indexOf(item.column_name) + 1,
    })),
    checks: constraintRows.filter((item) => item.tbl === table && item.contype === "c").map((item) => item.def),
    foreignKeys: constraintRows.filter((item) => item.tbl === table && item.contype === "f").flatMap((item) =>
      item.cols.map((from, position) => ({ table: item.reftbl, from, to: item.refcols[position], on_delete: ON_DELETE[item.ondelete] }))),
    indexes: indexes.filter((item) => !item.pk),
    uniques: indexes.filter((item) => item.uniq && !item.pk).map((item) => item.cols),
  }];
}));

// Todas as tabelas precisam estar descritas e agrupadas: tabela nova sem documentação falha aqui.
const grouped = MODULES.flatMap((module) => module.tabelas);
const missing = tables.filter((table) => !grouped.includes(table) || !TABLE_DOCS[table]);
const extra = grouped.filter((table) => !tables.includes(table));
if (missing.length || extra.length) {
  console.error(`Documentação do banco desatualizada.\n - sem descrição/módulo: ${missing.join(", ") || "—"}\n - descritas mas inexistentes: ${extra.join(", ") || "—"}\nAtualize server/scripts/banco-de-dados.descricao.js.`);
  process.exit(1);
}

// ---------------------------------------------------------------- utilidades
// Valores permitidos (CHECK (col = ANY (ARRAY['a', 'b']))) de cada coluna, lidos do catálogo.
function allowedValues(table) {
  const map = {};
  for (const def of info[table].checks) {
    for (const match of def.matchAll(/\(?"?(\w+)"?(?:::\w+)? = ANY \(\(?ARRAY\[([^\]]*)\]/g)) {
      map[match[1]] = [...match[2].matchAll(/'([^']*)'/g)].map((value) => value[1]);
    }
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
  const allowed = allowedValues(table)[column.name];
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
      const allowed = allowedValues(table)[column.name];
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

// ---------------------------------------------------------------- banco-de-dados.md
const md = [];
md.push("# Banco de dados do SIGMA·CCM", "");
md.push("> Documento gerado por `server/scripts/gerar-doc-banco.js` a partir do esquema real (migrações de `supabase/migrations`).",
  "> Não edite à mão: altere as descrições em `server/scripts/banco-de-dados.descricao.js` e rode o script.", "");
md.push(`**${tables.length} tabelas** em ${MODULES.length} módulos · ${indexRows.length} índices · ${migrations.length} migrações · PostgreSQL (Supabase), RLS ligado em ${tableRows.filter((row) => row.rls).length} tabelas.`, "");
md.push("## Como o banco é criado e evolui", "",
  "1. As migrações SQL ficam em `supabase/migrations/` e são aplicadas **fora da API**, em ordem: `supabase db push` ou `npm --prefix server run db:migrate` (cada arquivo numa transação, registrado em `schema_migrations`).",
  "2. `npm --prefix server run db:bootstrap` faz a carga inicial, uma única vez e de forma idempotente: parâmetros de KPI, administrador do ambiente (produção) ou contas de exemplo (desenvolvimento) e, se `SIGMA_DEMO` estiver ligado, os dados de demonstração.",
  "3. A API **não** migra nem popula o banco ao iniciar (compatível com funções serverless da Vercel).",
  "4. As tabelas têm RLS ligado e nenhuma policy: o acesso direto pelas chaves `anon`/`authenticated` do Supabase fica bloqueado. Só a API acessa o banco, com a `DATABASE_URL` do servidor.",
  "5. `docs/schema-completo.sql` é a referência histórica do esquema SQLite original (congelada, não é mais gerada).", "");
md.push("## Camada de acesso a dados", "",
  "Nenhuma rota ou serviço escreve SQL. Todo acesso ao banco passa por `server/src/data`, sempre de forma assíncrona (`await`):", "",
  "| Arquivo | Papel |", "|---|---|",
  "| `data/connection.js` | Único módulo que conhece o driver (`pg`): pool (dimensionado para serverless), `sql()`, `transaction()` atômica (com SAVEPOINT em transações aninhadas) e classificação de erros de restrição. |",
  "| `data/bootstrap/*.js` | Carga inicial explícita (`npm run db:bootstrap`): parâmetros, admin, exemplo e demonstração. |",
  "| `data/repositories/*.js` | Um repositório por entidade, com funções de consulta e gravação (abaixo). |",
  "| `data/index.js` | Ponto de entrada: `transaction()`, `closeDatabase()`, classificadores de erro e os repositórios (`ordensRepo`, `usuariosRepo`…). |", "",
  "O teste `server/test/arquitetura.test.js` impede SQL fora dessa pasta.", "");md.push("## Visão geral das relações", "",
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
md.push("## Migrações", "", "| # | Id |", "|---|---|", ...migrations.map((item, index) => `| ${index + 1} | \`${item.replace(/\.sql$/, "")}\` |`), "");
const markdown = md.join("\n");

// ---------------------------------------------------------------- gravação / conferência
const targets = [[join(docsDir, "banco-de-dados.md"), markdown]];
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
