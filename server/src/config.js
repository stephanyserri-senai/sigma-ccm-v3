// Configuração da API a partir de variáveis de ambiente (arquivo server/.env ou ambiente do sistema).
// Em produção (NODE_ENV=production) não há valor padrão: o que faltar ou for inseguro impede a
// inicialização, com a lista do que corrigir. Em desenvolvimento e testes há padrões convenientes.
import dotenv from "dotenv";
import { dirname, join, resolve } from "path";
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

const port = read("PORT", {
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

const dbPath = read("DB_PATH", { devDefault: "sigma-ccm.db" });

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
  dbPath: resolve(SERVER_DIR, dbPath),
  corsOrigins: corsRaw.split(",").map((item) => item.trim()).filter(Boolean),
  seedExemplo,
  demo,
  adminInicial: {
    usuario: (env.ADMIN_USUARIO ?? "").trim(),
    senha: adminSenha,
    nome: (env.ADMIN_NOME ?? "").trim() || "Administrador CCM",
    email: (env.ADMIN_EMAIL ?? "").trim() || null,
  },
});
