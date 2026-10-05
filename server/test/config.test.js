import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const SECRET = "Zq8tM2vK9xR4pL7wN1cB6yH3jF5dS0aGuEiOoQe"; // 40 caracteres, só para o teste

// Ambiente limpo: sem o server/.env local e sem variáveis do SIGMA herdadas.
function cleanEnv(extra) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(NODE_ENV|PORT|JWT_SECRET|JWT_EXPIRES_IN|DB_PATH|CORS_ORIGIN|SIGMA_|ADMIN_)/.test(key)));
  return { ...base, ENV_FILE: join(serverDir, "nao-existe.env"), ...extra };
}

function run(env, { untilReady = true } = {}) {
  const child = spawn(process.execPath, ["src/index.js"], { cwd: serverDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ready: false, output, code: null }), 20000);
    child.once("exit", (code) => { clearTimeout(timer); resolve({ ready: false, output, code }); });
    if (untilReady) child.stdout.on("data", () => { if (output.includes("SIGMA-CCM API em")) { clearTimeout(timer); resolve({ ready: true, output, code: null }); } });
  });
  return { child, done };
}
const stop = async (child) => { if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); } };

test("Configuração por variáveis de ambiente: produção sem valores fixos, CORS e validade do token", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-config-"));
  try {
    // 1. Produção sem configuração: não inicia e lista tudo o que falta.
    const missing = await run(cleanEnv({ NODE_ENV: "production" })).done;
    assert.equal(missing.code, 1);
    for (const name of ["PORT", "JWT_SECRET", "JWT_EXPIRES_IN", "DB_PATH", "CORS_ORIGIN"]) assert.match(missing.output, new RegExp(`${name}: não definida`));

    // 2. Produção com valores inseguros: segredo fraco/de exemplo e CORS aberto são recusados.
    const weak = await run(cleanEnv({
      NODE_ENV: "production", PORT: "31490", JWT_SECRET: "troque-por-um-segredo-forte", JWT_EXPIRES_IN: "8h",
      DB_PATH: join(tempDir, "prod.db"), CORS_ORIGIN: "*",
    })).done;
    assert.equal(weak.code, 1);
    assert.match(weak.output, /JWT_SECRET: use pelo menos 32 caracteres/);
    assert.match(weak.output, /CORS_ORIGIN: "\*" não é permitido em produção/);

    // 3. Banco vazio em produção sem administrador inicial: não cria conta com senha conhecida.
    const prodEnv = {
      NODE_ENV: "production", PORT: "31491", JWT_SECRET: SECRET, JWT_EXPIRES_IN: "2s",
      DB_PATH: join(tempDir, "prod.db"), CORS_ORIGIN: "https://ccm.empresa.com.br",
    };
    const noAdmin = await run(cleanEnv(prodEnv)).done;
    assert.equal(noAdmin.code, 1);
    assert.match(noAdmin.output, /defina ADMIN_USUARIO e ADMIN_SENHA/);

    // 4. Produção completa: sobe, cria só o administrador do ambiente, sem dados de exemplo.
    const prod = run(cleanEnv({ ...prodEnv, ADMIN_USUARIO: "gestor", ADMIN_SENHA: "Senha-Forte-2026", ADMIN_NOME: "Gestora CCM" }));
    try {
      const started = await prod.done;
      assert.equal(started.ready, true, started.output);
      assert.match(started.output, /ambiente production/);
      const base = "http://127.0.0.1:31491/api";
      assert.equal((await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", senha: "admin123" }) })).status, 401);
      const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gestor", senha: "Senha-Forte-2026" }) });
      assert.equal(login.status, 200);
      const { token, user } = await login.json();
      assert.equal(user.papel, "CCM");
      const usuarios = await (await fetch(`${base}/usuarios`, { headers: { authorization: `Bearer ${token}` } })).json();
      assert.deepEqual(usuarios.map((item) => item.username), ["gestor"]);

      // CORS: só a origem configurada recebe o cabeçalho de liberação.
      const allowed = await fetch(`${base}/versao`, { headers: { origin: "https://ccm.empresa.com.br" } });
      assert.equal(allowed.headers.get("access-control-allow-origin"), "https://ccm.empresa.com.br");
      const blocked = await fetch(`${base}/versao`, { headers: { origin: "https://outro-site.com" } });
      assert.equal(blocked.headers.get("access-control-allow-origin"), null);

      // Validade do token vem de JWT_EXPIRES_IN (2 s).
      await new Promise((resolve) => setTimeout(resolve, 2500));
      assert.equal((await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    } finally {
      await stop(prod.child);
    }

    // 5. Desenvolvimento: valor inválido também é recusado, com mensagem clara.
    const badExpiry = await run(cleanEnv({ PORT: "31492", DB_PATH: join(tempDir, "dev.db"), JWT_EXPIRES_IN: "oito horas", SIGMA_DEMO: "0" })).done;
    assert.equal(badExpiry.code, 1);
    assert.match(badExpiry.output, /JWT_EXPIRES_IN: use um prazo como 8h/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
