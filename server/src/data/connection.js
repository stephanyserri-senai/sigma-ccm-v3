// Conexão com o banco. É o ÚNICO módulo que conhece o driver (SQLite via better-sqlite3).
// Rotas e serviços nunca escrevem SQL: usam os repositórios de src/data/repositories.
// Para trocar de banco, reimplemente este módulo, as migrações e os repositórios.
import Database from "better-sqlite3";
import { config } from "../config.js";

// Aberta no primeiro uso (importar um módulo não abre o arquivo do banco).
let instance = null;
export function database() {
  if (!instance) {
    // Caminho do banco vem de DB_PATH (ver server/src/config.js).
    instance = new Database(config.dbPath);
    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");
  }
  return instance;
}

// Acesso direto ao driver, restrito a src/data (migrações e seeds).
export const db = new Proxy({}, {
  get(_target, property) {
    const connection = database();
    const value = connection[property];
    return typeof value === "function" ? value.bind(connection) : value;
  },
});

// Instrução preparada com cache: cada texto SQL é compilado uma única vez.
const statements = new Map();
export function sql(text) {
  let statement = statements.get(text);
  if (!statement) {
    statement = database().prepare(text);
    statements.set(text, statement);
  }
  return statement;
}

// Executa `fn` numa transação de escrita (BEGIN IMMEDIATE) e devolve o resultado.
// Dentro de outra transação, vira um savepoint. Erro lançado em `fn` desfaz tudo.
export const transaction = (fn) => database().transaction(fn).immediate();

// Erros de restrição traduzidos para algo independente do banco.
export const UNIQUE_VIOLATION = "UNIQUE_VIOLATION";
export const uniqueViolation = (message) => Object.assign(new Error(message), { code: UNIQUE_VIOLATION });
export const isUniqueViolation = (error) => error?.code === UNIQUE_VIOLATION || error?.code === "SQLITE_CONSTRAINT_UNIQUE";
export const isForeignKeyViolation = (error) => error?.code === "SQLITE_CONSTRAINT_FOREIGNKEY";
