import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { addDays, todayLocal } from "../src/iamot.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));

function waitForApi(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`API startup timed out:\n${output}`)), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("SIGMA-CCM API em")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`API saiu com código ${code}:\n${output}`)); });
  });
}

test("Auditoria: somente CCM, filtros por usuário, ação e período, paginação no servidor", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-auditoria-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31484;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "audit-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const api = (token, path, method = "GET", body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = async (...args) => (await api(...args)).json();
    const login = async (username, senha) => json("", "/auth/login", "POST", { username, senha });
    const admin = (await login("admin", "admin123"));
    const pcm = (await login("pcm", "pcm123"));
    // Gera eventos: mais logins do PCM e uma nota aberta pelo PCM.
    for (let index = 0; index < 4; index += 1) await login("pcm", "pcm123");
    await api(pcm.token, "/notas", "POST", { descricao: "Vazamento na bomba" });

    assert.equal((await api(pcm.token, "/auditoria")).status, 403);
    assert.equal((await api(pcm.token, "/auditoria/filtros")).status, 403);

    const filters = await json(admin.token, "/auditoria/filtros");
    assert.deepEqual(filters.usuarios.map((user) => user.username).sort(), ["admin", "pcm"]);
    assert.equal(filters.acoes.find((item) => item.acao === "login").total, 6);

    // Padrão: mais recentes primeiro, 25 por página, com nome e perfil de quem fez.
    const all = await json(admin.token, "/auditoria");
    assert.equal(all.total, 7);
    assert.deepEqual([all.pagina, all.paginas, all.tamanho], [1, 1, 25]);
    assert.equal(all.itens[0].acao, "abrir_nota");
    assert.equal(all.itens[0].usuario_nome, "Carlos Lima");
    assert.equal(all.itens[0].papel, "PCM");
    assert.equal(all.itens[0].entidade, "nota");
    assert.match(all.itens[0].data_hora, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(all.itens.every((item, index) => index === 0 || item.id < all.itens[index - 1].id));

    // Filtros por usuário e ação.
    const pcmLogins = await json(admin.token, `/auditoria?usuario_id=${pcm.user.id}&acao=login`);
    assert.equal(pcmLogins.total, 5);
    assert.ok(pcmLogins.itens.every((item) => item.acao === "login" && item.username === "pcm"));
    assert.equal((await json(admin.token, `/auditoria?usuario_id=${admin.user.id}`)).total, 1);

    // Paginação no servidor.
    const page2 = await json(admin.token, `/auditoria?acao=login&tamanho=4&pagina=2`);
    assert.deepEqual([page2.total, page2.pagina, page2.paginas, page2.itens.length], [6, 2, 2, 2]);
    const page1 = await json(admin.token, `/auditoria?acao=login&tamanho=4&pagina=1`);
    assert.ok(Math.min(...page1.itens.map((item) => item.id)) > Math.max(...page2.itens.map((item) => item.id)));
    assert.equal((await json(admin.token, "/auditoria?acao=login&tamanho=4&pagina=99")).pagina, 2); // limita à última
    assert.equal((await json(admin.token, "/auditoria?tamanho=5000")).tamanho, 100);

    // Período (datas locais).
    const hoje = todayLocal();
    assert.equal((await json(admin.token, `/auditoria?de=${hoje}&ate=${hoje}`)).total, 7);
    assert.equal((await json(admin.token, `/auditoria?de=${addDays(hoje, 1)}`)).total, 0);
    assert.equal((await json(admin.token, `/auditoria?ate=${addDays(hoje, -1)}`)).total, 0);
    assert.equal((await api(admin.token, `/auditoria?de=${hoje}&ate=${addDays(hoje, -1)}`)).status, 400);
    assert.equal((await json(admin.token, "/auditoria?de=data-invalida")).total, 7); // filtro inválido é ignorado
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
