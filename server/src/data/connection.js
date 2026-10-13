// Conexão com o banco. É o ÚNICO módulo que conhece o driver (PostgreSQL / Supabase via `pg`).
// Rotas e serviços nunca escrevem SQL: usam os repositórios de src/data/repositories.
// Toda consulta é assíncrona. Dentro de `transaction(fn)` os repositórios usam automaticamente a
// conexão da transação (AsyncLocalStorage), então basta `await` nas chamadas de sempre.
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { config } from "../config.js";

// COUNT/SUM chegam como bigint/numeric (texto) no driver; a API sempre trabalhou com números.
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

// Pool criado no primeiro uso e reaproveitado entre invocações do mesmo processo (serverless).
let pool = null;
export function database() {
  if (!pool) {
    const { url, ssl, sslCa, poolMax, poolIdleMs, connectTimeoutMs } = config.database;
    const connection = new URL(url);
    // O modo de SSL vem de DATABASE_SSL; o `sslmode` da URL é ignorado para não conflitar.
    connection.searchParams.delete("sslmode");
    pool = new pg.Pool({
      connectionString: connection.toString(),
      max: poolMax,
      idleTimeoutMillis: poolIdleMs,
      connectionTimeoutMillis: connectTimeoutMs,
      ssl: ssl === "disable" ? false : { rejectUnauthorized: ssl === "require", ...(sslCa ? { ca: sslCa } : {}) },
      application_name: "sigma-ccm-api",
    });
    // Conexão ociosa derrubada pelo servidor não deve encerrar o processo; a próxima consulta reconecta.
    pool.on("error", (error) => console.error("Conexão ociosa do banco encerrada:", error.message));
  }
  return pool;
}

export async function closeDatabase() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

const scope = new AsyncLocalStorage();

// Converte `?` e `@nome` para `$n`, ignorando literais, identificadores entre aspas e comentários.
// Retorna o texto e, para parâmetros nomeados, a ordem dos nomes.
const translations = new Map();
function translate(text) {
  let cached = translations.get(text);
  if (cached) return cached;
  let out = "";
  let count = 0;
  const names = [];
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (char === "'" || char === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === char) { if (text[j + 1] === char) { j += 2; continue; } break; }
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (char === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += text.slice(i, stop);
      i = stop;
    } else if (char === "?") {
      count += 1;
      out += `$${count}`;
      i += 1;
    } else if (char === "@" && /[A-Za-z_]/.test(text[i + 1] ?? "")) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i + 1))[0];
      let index = names.indexOf(match);
      if (index === -1) { names.push(match); index = names.length - 1; }
      out += `$${index + 1}`;
      i += 1 + match.length;
    } else {
      out += char;
      i += 1;
    }
  }
  cached = { text: out, names, positional: count };
  translations.set(text, cached);
  return cached;
}

const isNamedArgs = (args) => args.length === 1 && args[0] !== null && typeof args[0] === "object"
  && !Buffer.isBuffer(args[0]) && !Array.isArray(args[0]) && !(args[0] instanceof Date);

// NaN virava NULL no driver anterior; mantido para ids numéricos inválidos continuarem sem resultado.
const normalize = (value) => (typeof value === "number" && Number.isNaN(value) ? null : value);

function bind(statement, args) {
  if (statement.names.length) {
    if (!isNamedArgs(args)) throw new TypeError("Consulta com parâmetros nomeados exige um objeto.");
    return statement.names.map((name) => {
      if (!(name in args[0])) throw new TypeError(`Parâmetro @${name} não informado.`);
      return normalize(args[0][name]);
    });
  }
  return args.map(normalize);
}

async function execute(text, values) {
  const client = scope.getStore()?.client ?? database();
  return client.query({ text, values });
}

// Instrução SQL assíncrona:
//   get(...)    primeira linha (ou undefined)      all(...)    todas as linhas
//   run(...)    { changes }                        insert(...) id gerado (acrescenta RETURNING id)
//   affected(...) número de linhas alteradas   scalar(coluna, ...) valor da 1ª linha (ou null)
//   column(coluna, ...) valores de uma coluna  exists(...) true se houver linha
export function sql(text) {
  const statement = translate(text);
  return {
    get: async (...args) => (await execute(statement.text, bind(statement, args))).rows[0],
    all: async (...args) => (await execute(statement.text, bind(statement, args))).rows,
    run: async (...args) => ({ changes: (await execute(statement.text, bind(statement, args))).rowCount }),
    scalar: async (property, ...args) => (await execute(statement.text, bind(statement, args))).rows[0]?.[property] ?? null,
    column: async (property, ...args) => (await execute(statement.text, bind(statement, args))).rows.map((row) => row[property]),
    exists: async (...args) => (await execute(statement.text, bind(statement, args))).rows.length > 0,
    affected: async (...args) => (await execute(statement.text, bind(statement, args))).rowCount,
    insert: async (...args) => {
      const returning = /\breturning\b/i.test(statement.text) ? statement.text : `${statement.text.trimEnd().replace(/;$/, "")} RETURNING id`;
      return Number((await execute(returning, bind(statement, args))).rows[0].id);
    },
  };
}

// Consulta avulsa (scripts de manutenção e testes). Parâmetros posicionais `$1`, `$2`...
export async function query(text, values = []) {
  return execute(text, values);
}

// Executa `fn` numa transação atômica e devolve o resultado. Qualquer erro desfaz tudo (ROLLBACK).
// Dentro de outra transação, vira um savepoint. Não capture erros do banco dentro de `fn` para
// continuar: no PostgreSQL, após um erro de SQL a transação só aceita ROLLBACK.
let savepoints = 0;
export async function transaction(fn) {
  const current = scope.getStore();
  if (current) {
    const name = `sp_${++savepoints}`;
    await current.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await current.client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await current.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw error;
    }
  }

  const client = await database().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await scope.run({ client }, fn);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      discard = true;
      console.error("Falha ao desfazer a transação:", rollbackError.message);
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

// Fragmentos de SQL para o formato de data do esquema (texto "AAAA-MM-DD HH:MM:SS" em UTC).
export const NOW_SQL = "to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";
export const TODAY_BR_SQL = "to_char(clock_timestamp() AT TIME ZONE 'UTC', 'DD/MM/YYYY')";

// Data local (APP_TIMEZONE) de uma coluna de data/hora em UTC. O fuso já foi validado na configuração.
export const localDateSql = (column) =>
  `to_char((${column}::timestamp AT TIME ZONE 'UTC') AT TIME ZONE '${config.timezone}', 'YYYY-MM-DD')`;

// Erros de restrição traduzidos para algo independente do banco.
export const UNIQUE_VIOLATION = "UNIQUE_VIOLATION";
export const uniqueViolation = (message) => Object.assign(new Error(message), { code: UNIQUE_VIOLATION });
export const isUniqueViolation = (error) => error?.code === UNIQUE_VIOLATION || error?.code === "23505";
export const isForeignKeyViolation = (error) => error?.code === "23503";
// Valor de parâmetro que o tipo da coluna não aceita (texto no lugar de número, fora da faixa).
export const isInvalidInput = (error) => error?.code === "22P02" || error?.code === "22003";