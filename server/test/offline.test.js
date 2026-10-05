import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const HOUR = 3600000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

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

test("Offline-first: reenvio idempotente da fila e momento real dos registros feitos sem conexão", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-offline-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31482;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), JWT_SECRET: "offline-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const api = (token, path, method = "GET", body, key) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(key ? { "x-idempotency-key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const login = async (username, senha) => (await (await api("", "/auth/login", "POST", { username, senha })).json());
    const admin = (await login("admin", "admin123")).token;
    const pcm = (await login("pcm", "pcm123")).token;
    const fieldLogin = await login("campo", "campo123");
    const field = fieldLogin.token;

    const orders = await (await api(admin, "/ordens")).json();
    const order = orders.find((entry) => entry.numero === "40012352");
    assert.equal((await api(pcm, `/ordens/${order.id}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);
    const base = `/ordens/${order.id}/execucao`;

    // Cronômetro offline: iniciou há 3 h, intercorrência há 2 h, finalizou há 1 h → 2 h × 2 executantes = 4 HH.
    const now = Date.now();
    assert.equal((await api(field, `${base}/iniciar`, "POST", { num_executantes: 2, iniciado_em: new Date(now + 2 * HOUR).toISOString() })).status, 400); // futuro
    assert.equal((await api(field, `${base}/iniciar`, "POST", { num_executantes: 2, iniciado_em: new Date(now - 8 * 24 * HOUR).toISOString() })).status, 400); // > 7 dias
    assert.equal((await api(field, `${base}/iniciar`, "POST", { num_executantes: 2, iniciado_em: "ontem" })).status, 400);

    const startKey = randomUUID();
    const start = await api(field, `${base}/iniciar`, "POST", { num_executantes: 2, iniciado_em: new Date(now - 3 * HOUR).toISOString() }, startKey);
    assert.equal(start.status, 201);
    const startBody = await start.json();
    // Reenvio da mesma pendência (resposta perdida na rede): devolve a resposta original, sem novo registro.
    const replay = await api(field, `${base}/iniciar`, "POST", { num_executantes: 2, iniciado_em: new Date(now - 3 * HOUR).toISOString() }, startKey);
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get("x-idempotent-replay"), "1");
    assert.deepEqual(await replay.json(), startBody);
    assert.equal((await api(pcm, `${base}/iniciar`, "POST", { num_executantes: 1 }, startKey)).status, 409); // chave de outro usuário

    assert.equal((await api(field, `${base}/intercorrencias`, "POST", { tipo: "Desvio", descricao: "Falta de peça.", registrado_em: new Date(now - 2 * HOUR).toISOString() }, randomUUID())).status, 201);
    assert.equal((await api(field, `${base}/finalizar`, "POST", { finalizado_em: new Date(now - 4 * HOUR).toISOString() })).status, 400); // fim antes do início
    const finishKey = randomUUID();
    const finish = await api(field, `${base}/finalizar`, "POST", { finalizado_em: new Date(now - HOUR).toISOString() }, finishKey);
    assert.equal(finish.status, 201);
    const finishBody = await finish.json();
    assert.ok(Math.abs(finishBody.duracao_horas - 2) < 0.01);
    assert.equal(finishBody.hh, 4);
    assert.deepEqual(await (await api(field, `${base}/finalizar`, "POST", { finalizado_em: new Date(now - HOUR).toISOString() }, finishKey)).json(), finishBody);

    const detail = await (await api(admin, `/ordens/${order.id}`)).json();
    assert.equal(detail.execucao.iniciado_em, sqlTime(now - 3 * HOUR));
    assert.equal(detail.execucao.finalizado_em, sqlTime(now - HOUR));
    assert.equal(detail.intercorrencias[0].registrado_em, sqlTime(now - 2 * HOUR));
    assert.equal(detail.apontamentos.filter((entry) => entry.tipo === "Apropriação").length, 1);
    assert.equal(detail.apontamentos.find((entry) => entry.tipo === "Apropriação").data, sqlTime(now - HOUR));

    // Validação feita offline, enviada duas vezes pela fila: um único apontamento.
    const validationKey = randomUUID();
    const validation = { ordem_id: order.id, tipo: "Validação", hh: 0, registrado_em: new Date(now - 30 * 60000).toISOString() };
    assert.equal((await api(field, "/apontamentos", "POST", validation, validationKey)).status, 201);
    assert.equal((await api(field, "/apontamentos", "POST", validation, validationKey)).status, 201);
    const afterValidation = await (await api(admin, `/ordens/${order.id}`)).json();
    assert.equal(afterValidation.apontamentos.filter((entry) => entry.tipo === "Validação").length, 1);
    assert.equal(afterValidation.apontamentos.find((entry) => entry.tipo === "Validação").data, sqlTime(now - 30 * 60000));

    // Checklist preenchido offline (multipart com assinatura): guarda quando foi preenchido.
    const example = (await (await api(field, "/formularios/modelos")).json()).find((model) => model.tipo === "Checklist");
    const send = (key, preenchido_em) => {
      const form = new FormData();
      form.append("dados", JSON.stringify({ modelo_id: example.id, ordem_id: order.id, preenchido_em, respostas: { loto: "Sim", isolamento: "Sim", condicao_final: "Operando normalmente" } }));
      form.append("arquivo:assinatura", new Blob([PNG], { type: "image/png" }), "assinatura.png");
      return fetch(`http://127.0.0.1:${port}/api/formularios/respostas`, { method: "POST", headers: { authorization: `Bearer ${field}`, "x-idempotency-key": key }, body: form });
    };
    assert.equal((await send(randomUUID(), new Date(now + 3 * HOUR).toISOString())).status, 400);
    const formKey = randomUUID();
    const first = await (await send(formKey, new Date(now - 45 * 60000).toISOString())).json();
    const second = await (await send(formKey, new Date(now - 45 * 60000).toISOString())).json();
    assert.deepEqual(second, first);
    const responses = await (await api(admin, `/formularios/respostas?ordem_id=${order.id}`)).json();
    assert.equal(responses.length, 1);
    assert.equal(responses[0].criado_em, sqlTime(now - 45 * 60000));

    // Erros de validação também são guardados: o reenvio devolve o mesmo erro.
    const badKey = randomUUID();
    assert.equal((await api(field, `${base}/intercorrencias`, "POST", { tipo: "Desvio", descricao: "" }, badKey)).status, 400);
    assert.equal((await api(field, `${base}/intercorrencias`, "POST", { tipo: "Desvio", descricao: "agora válido" }, badKey)).status, 400);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
