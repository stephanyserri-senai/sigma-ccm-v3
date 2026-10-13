// Aplica supabase/migrations/*.sql, em ordem, no banco de DATABASE_URL (alternativa à CLI do Supabase).
// Cada arquivo roda numa transação e é registrado em schema_migrations como "supabase/<arquivo>".
// Use UM dos dois caminhos por banco: `supabase db push` ou este script. Nunca roda na inicialização da API.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, transaction } from "../src/data/index.js";
import { query } from "../src/data/connection.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
const INITIAL = "20261013000000_initial_schema.sql";

async function tableExists(name) {
  const { rows } = await query("SELECT to_regclass($1) IS NOT NULL AS found", [`public.${name}`]);
  return rows[0].found;
}

async function run() {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  await query("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')))");
  const applied = new Set((await query("SELECT id FROM schema_migrations")).rows.map((row) => row.id));

  // Banco já criado pelo SQL Editor ou pela CLI: registra o esquema inicial sem reexecutá-lo.
  if (!applied.has(`supabase/${INITIAL}`) && await tableExists("usuarios")) {
    await query("INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING", [`supabase/${INITIAL}`]);
    applied.add(`supabase/${INITIAL}`);
    console.log(`Esquema inicial já presente; registrado sem reexecutar: ${INITIAL}`);
  }

  for (const file of files) {
    const id = `supabase/${file}`;
    if (applied.has(id)) continue;
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // Arquivo com BEGIN/COMMIT próprio já é atômico; os demais ganham a transação do script.
    if (/^\s*BEGIN\s*;/im.test(sqlText)) {
      await query(sqlText);
      await query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
    } else {
      await transaction(async () => {
        await query(sqlText);
        await query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      });
    }
    console.log(`Migração aplicada: ${file}`);
  }
  console.log("Banco atualizado.");
}

try {
  await run();
} catch (error) {
  console.error(`Migração falhou: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}