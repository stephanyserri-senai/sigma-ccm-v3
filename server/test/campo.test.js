import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { addDays, todayLocal, weekStart } from "../src/iamot.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));

function waitForApi(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`API startup timed out:\n${output}`)), 20000);
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

test("Visão geral do executante: agora, hoje, atrasadas, pendências e plano da semana", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-campo-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31489;
  // Dados de demonstração: OMs de campo em andamento, de hoje e atrasadas.
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), JWT_SECRET: "field-test-secret", SIGMA_DEMO: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const login = async (username, senha) => (await (await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, senha }),
    })).json()).token;
    const resumo = async (token) => fetch(`http://127.0.0.1:${port}/api/campo/resumo`, { headers: { authorization: `Bearer ${token}` } });
    const hoje = todayLocal();

    assert.equal((await resumo(await login("pcm", "pcm123"))).status, 403);

    // Diego: execução em andamento (OM iniciada ontem, cronômetro rodando).
    const diego = await (await resumo(await login("diego", "demo123"))).json();
    assert.equal(diego.hoje, hoje);
    assert.equal(diego.usuario.equipe, "Elétrica Prev.");
    assert.deepEqual(diego.semana.inicio, weekStart(hoje));
    assert.equal(diego.semana.dias.length, 7);
    const running = diego.ordens.find((order) => order.numero === "40020007");
    assert.equal(running.em_execucao, true);
    assert.equal(running.aberta, true);
    assert.ok(running.iniciado_em);
    assert.ok(diego.ordens.some((order) => !order.aberta)); // histórico encerrado também vem (plano da semana)
    assert.ok(diego.contadores.passagens_nao_lidas >= 0);

    // Luiz: OM atrasada (programada há 2 dias).
    const luiz = await (await resumo(await login("luiz", "demo123"))).json();
    const late = luiz.ordens.find((order) => order.numero === "40020010");
    assert.equal(late.atrasada, true);
    assert.equal(late.hoje, false);
    assert.ok(luiz.contadores.notificacoes_nao_lidas >= 1); // OM atrasada gera notificação para o executante

    // Renata: tarefa de hoje, que aparece no dia de hoje do plano semanal.
    const renata = await (await resumo(await login("renata", "demo123"))).json();
    const today = renata.ordens.find((order) => order.numero === "40020008");
    assert.equal(today.hoje, true);
    const todayCell = renata.semana.dias.find((day) => day.data === hoje);
    assert.ok(todayCell.ordens.includes(today.id));
    assert.equal(renata.semana.dias.find((day) => day.data === addDays(hoje, 1) && day.data <= renata.semana.fim)?.ordens.includes(today.id) ?? false, false);

    // Paulo: OM distribuída para amanhã e checklist de exemplo (opcional) em aberto.
    const paulo = await (await resumo(await login("paulo", "demo123"))).json();
    const tomorrow = paulo.ordens.find((order) => order.numero === "40020009");
    assert.equal(tomorrow.inicio, addDays(hoje, 1));
    assert.equal(tomorrow.checklists_pendentes, 0);
    assert.ok(tomorrow.checklists_opcionais >= 1);
    assert.equal(paulo.contadores.pts_aguardando, 1); // PT-90001 solicitada por ele
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
