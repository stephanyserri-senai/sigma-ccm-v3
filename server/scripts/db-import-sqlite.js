// Importa dados do SQLite legado para um esquema Supabase já migrado e vazio.
// Uso: npm run db:import-sqlite -- <arquivo.db> --confirm
import initSqlJs from "sql.js/dist/sql-asm.js";
import { readFileSync } from "node:fs";
import { closeDatabase, database } from "../src/data/connection.js";

const [sourcePath, confirmation] = process.argv.slice(2);
if (!sourcePath || confirmation !== "--confirm") {
  console.error("Uso: npm run db:import-sqlite -- <arquivo.db> --confirm");
  process.exitCode = 1;
} else {
  let sqlite;
  let client;
  try {
    const SQL = await initSqlJs();
    sqlite = new SQL.Database(readFileSync(sourcePath));
    const integrity = sqlite.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0];
    if (integrity !== "ok") throw new Error(`Integridade do SQLite inválida: ${integrity ?? "sem resultado"}.`);

    const foreignKeyProblems = sqlite.exec("PRAGMA foreign_key_check")[0]?.values ?? [];
    if (foreignKeyProblems.length) {
      const [table, rowid, parent, constraint] = foreignKeyProblems[0];
      throw new Error(`O SQLite contém referências órfãs (${foreignKeyProblems.length}+). Primeiro caso: ${table}, linha ${rowid}, referência a ${parent} (FK ${constraint}). Corrija os dados antes da importação.`);
    }

    const tableRows = sqlite.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values ?? [];
    const sourceTables = tableRows.map(([name]) => name);
    if (!sourceTables.length) throw new Error("O arquivo SQLite não contém tabelas de dados para importar.");

    const pg = database();
    client = await pg.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(20261013, 1)");

    const targetTableRows = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const targetTables = new Set(targetTableRows.rows.map((row) => row.table_name));
    const unknownTables = sourceTables.filter((table) => !targetTables.has(table));
    if (unknownTables.length) throw new Error(`Tabelas SQLite sem destino no Supabase: ${unknownTables.join(", ")}.`);

    const sourceColumns = new Map();
    for (const table of sourceTables) {
      const columns = sqlite.exec(`PRAGMA table_info(${quoteIdentifier(table)})`)[0]?.values ?? [];
      sourceColumns.set(table, columns.map((row) => ({
        name: row[1],
        primaryKeyOrder: Number(row[5]),
      })));
      const destination = await client.query(
        `SELECT column_name, is_nullable = 'YES' OR column_default IS NOT NULL AS opcional
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [table],
      );
      const sourceNames = sourceColumns.get(table).map((column) => column.name);
      const targetNames = destination.rows.map((column) => column.column_name);
      // Colunas criadas por migrações posteriores ao SQLite ficam nulas ou com o valor padrão.
      const missingRequired = destination.rows.some((column) => !sourceNames.includes(column.column_name) && !column.opcional);
      if (missingRequired || sourceNames.some((name) => !targetNames.includes(name))) {
        throw new Error(`As colunas de ${table} no SQLite diferem do esquema Supabase. Não foi importado nenhum dado.`);
      }
      const primaryKey = sourceColumns.get(table).filter((column) => column.primaryKeyOrder > 0);
      if (!primaryKey.length) throw new Error(`A tabela ${table} precisa ter uma chave primária para importar.`);
    }

    const dataTables = sourceTables.filter((table) => table !== "schema_migrations");
    if (!dataTables.length) throw new Error("O arquivo SQLite não contém tabelas de dados para importar.");
    const existingRows = await client.query(
      `SELECT ${dataTables.map((table, index) => `COALESCE((SELECT COUNT(*) FROM ${quoteIdentifier(table)}), 0) AS t${index}`).join(", ")}`,
    );
    const occupied = dataTables.filter((table, index) => Number(existingRows.rows[0][`t${index}`]) > 0);
    if (occupied.length) {
      throw new Error(`Importação cancelada: o banco de destino não está vazio. Tabelas com dados: ${occupied.join(", ")}. Nenhum dado do SQLite foi importado.`);
    }

    const foreignKeys = await client.query(`
      SELECT tc.table_name AS child, kcu.column_name AS column, ccu.table_name AS parent,
             c.is_nullable AS nullable
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name
      JOIN information_schema.columns c
        ON c.table_schema = kcu.table_schema AND c.table_name = kcu.table_name AND c.column_name = kcu.column_name
      WHERE tc.constraint_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    const orderingEdges = foreignKeys.rows.filter(({ child, parent }) => sourceColumns.has(child) && sourceColumns.has(parent));
    const { order, deferred } = dependencyOrder(sourceTables, orderingEdges);
    const deferredByTable = new Map();
    for (const edge of deferred) {
      if (!deferredByTable.has(edge.child)) deferredByTable.set(edge.child, []);
      deferredByTable.get(edge.child).push(edge.column);
    }

    const deferredValues = [];
    const imported = new Map();
    for (const table of order) {
      const columns = sourceColumns.get(table).map((column) => column.name);
      const primaryKeys = sourceColumns.get(table)
        .filter((column) => column.primaryKeyOrder > 0)
        .sort((left, right) => left.primaryKeyOrder - right.primaryKeyOrder)
        .map((column) => column.name);
      const indexes = new Map(columns.map((column, index) => [column, index]));
      const heldColumns = deferredByTable.get(table) ?? [];
      const select = sqlite.prepare(`SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)}`);
      let rows = [];
      const flush = async () => {
        if (!rows.length) return;
        const placeholders = [];
        const values = [];
        for (const row of rows) {
          const rowPlaceholders = row.map((value, index) => {
            values.push(value);
            return `$${values.length}`;
          });
          placeholders.push(`(${rowPlaceholders.join(", ")})`);
        }
        await client.query(
          `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES ${placeholders.join(", ")}${table === "schema_migrations" ? " ON CONFLICT (id) DO NOTHING" : ""}`,
          values,
        );
        rows = [];
      };

      try {
        while (select.step()) {
          const sourceRow = select.get();
          const row = sourceRow.map((value, index) => {
            const column = columns[index];
            if (heldColumns.includes(column) && value !== null) {
              deferredValues.push({
                table,
                primaryKeys,
                key: primaryKeys.map((key) => sourceRow[indexes.get(key)]),
                column,
                value,
              });
              return null;
            }
            return value instanceof Uint8Array ? Buffer.from(value) : value;
          });
          rows.push(row);
          if (rows.length === 100) await flush();
        }
        await flush();
      } finally {
        select.free();
      }
      imported.set(table, sqlite.exec(`SELECT COUNT(*) FROM ${quoteIdentifier(table)}`)[0].values[0][0]);
    }

    for (const item of deferredValues) {
      const keyConditions = item.primaryKeys.map((key, index) => `${quoteIdentifier(key)} = $${index + 2}`);
      await client.query(
        `UPDATE ${quoteIdentifier(item.table)} SET ${quoteIdentifier(item.column)} = $1 WHERE ${keyConditions.join(" AND ")}`,
        [item.value, ...item.key],
      );
    }

    for (const table of order) {
      const identity = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_identity = 'YES'",
        [table],
      );
      for (const { column_name: column } of identity.rows) {
        const sequence = await client.query("SELECT pg_get_serial_sequence($1, $2) AS name", [table, column]);
        if (!sequence.rows[0].name || !Number(imported.get(table))) continue;
        const max = await client.query(`SELECT MAX(${quoteIdentifier(column)}) AS value FROM ${quoteIdentifier(table)}`);
        await client.query("SELECT setval($1::regclass, $2, true)", [sequence.rows[0].name, max.rows[0].value]);
      }
    }

    await client.query("COMMIT");
    console.log("Importação concluída; contagem de registros importados:");
    for (const table of order) console.log(`  ${table}: ${imported.get(table)}`);
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) {
        console.error(`Não foi possível desfazer a transação: ${rollbackError.message}`);
      }
    }
    console.error(`Importação SQLite falhou: ${error.message}`);
    process.exitCode = 1;
  } finally {
    sqlite?.close();
    client?.release();
    await closeDatabase();
  }
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`Identificador inválido no esquema: ${identifier}.`);
  return `"${identifier}"`;
}

function dependencyOrder(tables, edges) {
  const remaining = new Set(tables);
  const pendingEdges = [...edges];
  const deferred = [];
  const order = [];
  while (remaining.size) {
    const ready = [...remaining].filter((table) => !pendingEdges.some((edge) => edge.child === table && remaining.has(edge.parent))).sort();
    if (ready.length) {
      for (const table of ready) {
        order.push(table);
        remaining.delete(table);
      }
      continue;
    }
    const breakable = pendingEdges
      .filter((edge) => edge.nullable === "YES" && remaining.has(edge.child) && remaining.has(edge.parent))
      .sort((left, right) => `${left.child}.${left.column}`.localeCompare(`${right.child}.${right.column}`))[0];
    if (!breakable) throw new Error(`Referências cíclicas sem campo opcional entre: ${[...remaining].join(", ")}.`);
    deferred.push(breakable);
    pendingEdges.splice(pendingEdges.indexOf(breakable), 1);
  }
  return { order, deferred };
}
