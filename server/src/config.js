// Configuração da API a partir de variáveis de ambiente (arquivo server/.env ou ambiente do sistema).
// Em produção (NODE_ENV=production) não há valor padrão: o que faltar ou for inseguro impede a
// inicialização, com a lista do que corrigir. Em desenvolvimento e testes há padrões convenientes.
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
// Variáveis já definidas no ambiente têm prioridade sobre o arquivo .env.
dotenv.config({ path: process.env.ENV_FILE || join(SERVER_DIR, ".env"), quiet: true });

const env = process.env;
const nodeEnv = (env.NODE_ENV || "development").trim();
export const isProduction = nodeEnv === "production";
const problems = [];

function read(name, { devDefault, validate } = {}) {
  const raw = (env[name] ?? "").trim();
  if (!raw) {
    if (isProduction) { problems.push(`${name}: não definida.`); return undefined; }
    return devDefault;
  }
  const error = validate?.(raw);
  if (error) problems.push(`${name}: ${error}`);
  return raw;
}

function flag(name, defaultValue) {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "sim", "yes"].includes(raw)) return true;
  if (["0", "false", "nao", "não", "no"].includes(raw)) return false;
  problems.push(`${name}: use 1 (ligado) ou 0 (desligado).`);
  return defaultValue;
}

// Na Vercel a função não escuta porta (app.js é exportado sem listen), então PORT não é exigida.
const port = (env.VERCEL && !(env.PORT ?? "").trim()) ? "3001" : read("PORT", {
  devDefault: "3001",
  validate: (value) => (/^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536 ? null : "porta inválida (1 a 65535)."),
});

const jwtSecret = read("JWT_SECRET", {
  devDefault: "sigma-ccm-segredo-de-desenvolvimento-nao-usar-em-producao",
  validate: (value) => {
    if (!isProduction) return null;
    if (value.length < 32) return "use pelo menos 32 caracteres aleatórios.";
    if (/troque|change-?me|exemplo|desenvolvimento|secret/i.test(value)) return "ainda é um valor de exemplo; gere um segredo aleatório.";
    return null;
  },
});

const jwtExpiresIn = read("JWT_EXPIRES_IN", {
  devDefault: "8h",
  validate: (value) => (/^\d+[smhd]?$/.test(value) ? null : "use um prazo como 8h, 30m, 1d ou um número de segundos."),
});

const databaseUrl = read("DATABASE_URL", {
  devDefault: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
  validate: (value) => {
    if (!/^postgres(ql)?:\/\//i.test(value)) return "use uma URL postgresql://usuario:senha@host:porta/banco.";
    try { new URL(value); } catch { return "URL inválida; codifique caracteres especiais da senha (ex.: @ vira %40)."; }
    return null;
  },
});

// "require" valida a cadeia do certificado (informe DATABASE_SSL_CA), "no-verify" criptografa sem validar
// a cadeia (padrão para banco remoto, como o Supabase) e "disable" é só para Postgres local.
const SSL_MODES = ["require", "no-verify", "disable"];
let databaseHost = "";
try { databaseHost = new URL(databaseUrl).hostname; } catch { /* já reportado em DATABASE_URL */ }
const isLocalHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost);
const sslRaw = (env.DATABASE_SSL ?? "").trim().toLowerCase();
if (sslRaw && !SSL_MODES.includes(sslRaw)) problems.push(`DATABASE_SSL: use ${SSL_MODES.join(", ")}.`);
const databaseSsl = SSL_MODES.includes(sslRaw) ? sslRaw : (isLocalHost ? "disable" : "no-verify");

function positiveInt(name, defaultValue, max) {
  const raw = (env[name] ?? "").trim();
  if (!raw) return defaultValue;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
    problems.push(`${name}: use um inteiro entre 1 e ${max}.`);
    return defaultValue;
  }
  return Number(raw);
}
const poolMax = positiveInt("DATABASE_POOL_MAX", 3, 50);
const poolIdleMs = positiveInt("DATABASE_POOL_IDLE_MS", 10000, 600000);
const poolConnectMs = positiveInt("DATABASE_CONNECT_TIMEOUT_MS", 10000, 120000);

// Fuso das datas de negócio (hoje, semana, dia da apropriação). Em serverless o relógio do servidor é UTC.
const timezone = (env.APP_TIMEZONE ?? "").trim() || "America/Sao_Paulo";
try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); } catch { problems.push("APP_TIMEZONE: fuso inválido (ex.: America/Sao_Paulo)."); }

const corsRaw = read("CORS_ORIGIN", {
  devDefault: "http://localhost:5173,http://127.0.0.1:5173",
  validate: (value) => {
    const origins = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (!origins.length) return "informe ao menos uma origem.";
    if (origins.includes("*")) return isProduction ? "\"*\" não é permitido em produção; liste as origens." : null;
    const invalid = origins.filter((origin) => !/^https?:\/\/[^/\s]+$/.test(origin));
    return invalid.length ? `origem inválida (${invalid.join(", ")}); use protocolo e host, sem barra no final.` : null;
  },
});

const seedExemplo = flag("SIGMA_SEED_EXEMPLO", !isProduction);
const demo = flag("SIGMA_DEMO", !isProduction);
const adminSenha = (env.ADMIN_SENHA ?? "").trim();
if (adminSenha && adminSenha.length < 10) problems.push("ADMIN_SENHA: use pelo menos 10 caracteres.");
const sapUrl = (env.SAP_OUTBOUND_URL ?? "").trim();
const sapFormat = (env.SAP_OUTBOUND_FORMAT ?? "json").trim().toLowerCase();
if (sapFormat !== "json" && sapFormat !== "xml") problems.push("SAP_OUTBOUND_FORMAT: use json ou xml.");
const sapTimeoutMs = positiveInt("SAP_OUTBOUND_TIMEOUT_MS", 15000, 120000);
const sapRetryMinutes = positiveInt("SAP_OUTBOUND_RETRY_MINUTES", 5, 1440);

if (problems.length) {
  console.error(`Configuração inválida (${isProduction ? "produção" : nodeEnv}). Ajuste o server/.env ou as variáveis de ambiente:\n - ${problems.join("\n - ")}\nVeja server/.env.example.`);
  process.exit(1);
}

export const config = Object.freeze({
  env: nodeEnv,
  isProduction,
  port: Number(port),
  jwtSecret,
  jwtExpiresIn: /^\d+$/.test(jwtExpiresIn) ? Number(jwtExpiresIn) : jwtExpiresIn,
  database: {
    url: databaseUrl,
    ssl: databaseSsl,
    sslCa: (env.DATABASE_SSL_CA ?? "").replace(/\\n/g, "\n").trim() || null,
    poolMax,
    poolIdleMs,
    connectTimeoutMs: poolConnectMs,
  },
  timezone,
  serverless: Boolean(env.VERCEL),
  corsOrigins: corsRaw.split(",").map((item) => item.trim()).filter(Boolean),
  seedExemplo,
  demo,
  adminInicial: {
    usuario: (env.ADMIN_USUARIO ?? "").trim(),
    senha: adminSenha,
    nome: (env.ADMIN_NOME ?? "").trim() || "Administrador CCM",
    email: (env.ADMIN_EMAIL ?? "").trim() || null,
  },
  sap: {
    url: sapUrl || null,
    token: (env.SAP_OUTBOUND_TOKEN ?? "").trim() || null,
    format: sapFormat,
    timeoutMs: sapTimeoutMs,
    retryMinutes: sapRetryMinutes,
  },
});
