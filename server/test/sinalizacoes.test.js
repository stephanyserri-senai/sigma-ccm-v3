import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

test("Qualidade de dados: sinalização da IA, explicação, decisão humana (aceitar/rejeitar) e auditoria", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-sinalizacoes-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31483;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "signals-test-secret" },
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
    const admin = (await login("admin", "admin123")).token;
    const pcm = (await login("pcm", "pcm123")).token;
    const fieldLogin = await login("campo", "campo123");
    const field = fieldLogin.token;

    // Apontamento de campo fora da faixa: a resposta traz o "sinal" para o aviso na tela de Campo.
    const orders = await json(admin, "/ordens");
    const order = orders.find((entry) => entry.numero === "40012352"); // HH previsto 8
    assert.equal((await api(pcm, `/ordens/${order.id}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);
    const appointment = await json(field, "/apontamentos", "POST", { ordem_id: order.id, tipo: "Apropriação", hh: 20 });
    assert.equal(appointment.sinal.tipo, "HH fora da faixa");
    assert.ok(appointment.sinal.score > 0.8);
    const signalId = appointment.sinal.id;

    // Lista e detalhe com OM, tipo, score, status, valores e fatores (XAI).
    const list = await json(pcm, "/sinalizacoes");
    assert.equal(list.length, 2);
    assert.equal(list[0].status, "Nova");
    const detail = await json(pcm, `/sinalizacoes/${signalId}`);
    assert.equal(detail.ordem_numero, "40012352");
    assert.equal(detail.equipamento, "ESTR-3330");
    assert.equal(detail.valor_atual, 20);
    assert.equal(detail.valor_sugerido, 8);
    assert.equal(detail.apontado_por, "João Pereira");
    assert.equal(detail.fatores.length, 3);
    assert.ok(detail.fatores.every((factor) => typeof factor.t === "string" && factor.v >= 0 && factor.v <= 1));
    assert.deepEqual(await json(pcm, "/sinalizacoes/contador"), { novas: 2 });

    // Executante vê só a sinalização do próprio apontamento e não decide.
    const fieldList = await json(field, "/sinalizacoes");
    assert.deepEqual(fieldList.map((item) => item.id), [signalId]);
    assert.deepEqual(await json(field, "/sinalizacoes/contador"), { novas: 1 });
    assert.equal((await api(field, `/sinalizacoes/${list[1].id}`)).status, 404);
    assert.equal((await api(field, `/sinalizacoes/${signalId}/aceitar`, "POST", {})).status, 403);
    assert.equal((await api(field, `/sinalizacoes/${signalId}/rejeitar`, "POST", { justificativa: "x" })).status, 403);

    // Decisão humana: aceitar com o valor ajustado pela pessoa corrige o apontamento.
    assert.equal((await api(pcm, `/sinalizacoes/${signalId}/aceitar`, "POST", { valor: -1 })).status, 400);
    assert.deepEqual(await json(pcm, `/sinalizacoes/${signalId}/aceitar`, "POST", { valor: 9.5, justificativa: "Dois executantes por 4,75 h." }),
      { ok: true, status: "Aceita", valor_aplicado: 9.5 });
    assert.equal((await api(admin, `/sinalizacoes/${signalId}/aceitar`, "POST", {})).status, 409);
    assert.equal((await api(admin, `/sinalizacoes/${signalId}/rejeitar`, "POST", { justificativa: "x" })).status, 409);
    const accepted = await json(admin, `/sinalizacoes/${signalId}`);
    assert.equal(accepted.status, "Aceita");
    assert.equal(accepted.valor_atual, 20); // valor original preservado
    assert.equal(accepted.valor_aplicado, 9.5);
    assert.equal(accepted.hh_apropriado, 9.5);
    assert.equal(accepted.decidido_por, "Carlos Lima");
    assert.equal(accepted.justificativa, "Dois executantes por 4,75 h.");
    const corrected = await json(admin, `/ordens/${order.id}`);
    assert.equal(corrected.apontamentos.find((entry) => entry.tipo === "Apropriação").hh_apropriado, 9.5);

    // Rejeitar exige justificativa e mantém o valor registrado.
    const seedSignal = list.find((item) => item.id !== signalId);
    assert.equal((await api(admin, `/sinalizacoes/${seedSignal.id}/rejeitar`, "POST", {})).status, 400);
    assert.deepEqual(await json(admin, `/sinalizacoes/${seedSignal.id}/rejeitar`, "POST", { justificativa: "Serviço estendido aprovado pelo supervisor." }),
      { ok: true, status: "Rejeitada" });
    assert.equal((await api(admin, "/sinalizacoes/99999/rejeitar", "POST", { justificativa: "x" })).status, 404);
    assert.deepEqual((await json(pcm, "/sinalizacoes?status=Nova")), []);
    assert.equal((await json(pcm, "/sinalizacoes?status=Rejeitada"))[0].decidido_por, "Ana Souza");
    assert.deepEqual(await json(pcm, "/sinalizacoes/contador"), { novas: 0 });

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const trail = db.prepare("SELECT acao, usuario_id, detalhe FROM trilha_auditoria WHERE acao IN ('aceitar_sinal','rejeitar_sinal') ORDER BY id").all();
      assert.equal(trail.length, 2);
      assert.match(trail[0].detalhe, /HH apropriado: 20 → 9\.5 \(sugerido 8\)/);
      assert.match(trail[1].detalhe, /mantido · Serviço estendido/);
    } finally {
      db.close();
    }
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
