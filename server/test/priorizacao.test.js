import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { calculatePriority } from "../src/priorizacao.js";
import { startPostgres } from "./helpers/postgres.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));

const baseInput = {
  afeta_seguranca_ambiente: false,
  afeta_custos: false,
  afeta_producao_qualidade: false,
  possui_reserva: true,
  risco_iminente: false,
  equipamento_monitorado: true,
  recursos_disponiveis: true,
  necessita_parada_programada: false,
};

test("Prioridade deriva a criticidade A/B/C e os prazos definidos no fluxo", () => {
  assert.deepEqual(
    [calculatePriority({ ...baseInput, afeta_seguranca_ambiente: true }).criticidade,
      calculatePriority({ ...baseInput, afeta_seguranca_ambiente: true }).prioridade],
    ["A", "ALTO"],
  );
  assert.deepEqual(
    [calculatePriority({ ...baseInput, afeta_producao_qualidade: true }).criticidade,
      calculatePriority({ ...baseInput, afeta_producao_qualidade: true }).prioridade],
    ["B", "MEDIO"],
  );
  assert.deepEqual(
    [calculatePriority(baseInput).criticidade, calculatePriority(baseInput).prioridade],
    ["C", "BAIXO"],
  );
  assert.equal(calculatePriority({ ...baseInput, risco_iminente: true }).prioridade, "IMEDIATO");
  assert.equal(calculatePriority({ ...baseInput, equipamento_monitorado: false }).prioridade, "URGENTE");
  assert.deepEqual(
    [calculatePriority({ ...baseInput, recursos_disponiveis: false, necessita_parada_programada: true, periodicidade_parada: "Semestral" }).prioridade,
      calculatePriority({ ...baseInput, recursos_disponiveis: false, necessita_parada_programada: true, periodicidade_parada: "Semestral" }).prazo_dias],
    ["SEMESTRAL", null],
  );
  assert.equal(calculatePriority({ ...baseInput, afeta_custos: true }).criticidade, "A");
  assert.equal(calculatePriority({ ...baseInput, possui_reserva: false }).criticidade, "B");
});

test("Prioridade rejeita critérios ausentes e cadência inválida", () => {
  assert.match(calculatePriority({}).error, /afeta_seguranca_ambiente/);
  assert.match(calculatePriority({
    ...baseInput, recursos_disponiveis: false, necessita_parada_programada: true,
  }).error, /periodicidade/);
  assert.match(calculatePriority({
    ...baseInput, recursos_disponiveis: false, necessita_parada_programada: true, periodicidade_parada: "Mensal",
  }).error, /Trimestral/);
});

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

test("API prioriza notas, restringe perfis, registra histórico e copia a classificação à OM", async () => {
  const pg = await startPostgres({ SIGMA_DEMO: "0" });
  const port = 31480;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, ...pg.env, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "priority-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const api = (token, path, method = "GET", body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const login = async (username, senha) => (await (await api("", "/auth/login", "POST", { username, senha })).json());
    const pcm = (await login("pcm", "pcm123")).token;
    const field = (await login("campo", "campo123")).token;
    const createdResponse = await api(pcm, "/notas", "POST", { descricao: "Falha em equipamento para priorizar" });
    assert.equal(createdResponse.status, 201);
    const note = await createdResponse.json();
    assert.equal(note.priorizacao_pendente, true);
    assert.equal((await api(pcm, `/notas/${note.id}/converter`, "POST")).status, 409);
    assert.equal((await api(field, `/notas/${note.id}/priorizacao`, "PATCH", baseInput)).status, 403);
    assert.equal((await api(pcm, `/notas/${note.id}/priorizacao`, "PATCH", {})).status, 400);

    const priority = {
      ...baseInput,
      afeta_seguranca_ambiente: true,
      afeta_custos: true,
    };
    const classifiedResponse = await api(pcm, `/notas/${note.id}/priorizacao`, "PATCH", priority);
    assert.equal(classifiedResponse.status, 200);
    const classified = await classifiedResponse.json();
    assert.equal(classified.criticidade, "A");
    assert.equal(classified.prioridade, "ALTO");
    assert.equal(classified.prioridade_nivel, 3);
    assert.equal(classified.prazo_dias, 7);
    assert.equal(classified.priorizacao_pendente, false);

    const history = await (await api(pcm, `/notas/${note.id}/priorizacao/historico`)).json();
    assert.equal(history.length, 1);
    assert.equal(history[0].prioridade_label, "Alto – 1 semana");
    assert.equal(history[0].priorizado_por, 2);

    const conversion = await api(pcm, `/notas/${note.id}/converter`, "POST");
    assert.equal(conversion.status, 201);
    const order = await (await api(pcm, `/ordens/${(await conversion.json()).id}`)).json();
    assert.equal(order.criticidade, "A");
    assert.equal(order.prioridade, "ALTO");
    assert.equal(order.prioridade_nivel, 3);
    assert.equal(order.prazo_dias, 7);
    const orderHistory = await (await api(pcm, `/ordens/${order.id}/priorizacao/historico`)).json();
    assert.equal(orderHistory.length, 1);
    assert.equal(orderHistory[0].ordem_id, order.id);
    assert.equal((await pg.query("SELECT priorizacao_pendente FROM notas WHERE id = $1", [note.id]))[0].priorizacao_pendente, false);

    const immediateNoteResponse = await api(pcm, "/notas", "POST", { descricao: "Risco iminente para priorizar" });
    const immediateNote = await immediateNoteResponse.json();
    const immediate = await api(pcm, `/notas/${immediateNote.id}/priorizacao`, "PATCH", {
      ...baseInput, risco_iminente: true,
    });
    assert.equal((await immediate.json()).prioridade, "IMEDIATO");
    assert.equal((await api(pcm, `/notas/${immediateNote.id}/converter`, "POST")).status, 409);
    assert.equal((await api(field, `/notas/${immediateNote.id}/priorizacao/confirmar-paralisacao`, "POST", {})).status, 403);
    const confirmationResponse = await api(pcm, `/notas/${immediateNote.id}/priorizacao/confirmar-paralisacao`, "POST", {});
    assert.equal(confirmationResponse.status, 201);
    assert.equal((await api(pcm, `/notas/${immediateNote.id}/priorizacao/confirmar-paralisacao`, "POST", {})).status, 409);

    const immediateHistory = await (await api(pcm, `/notas/${immediateNote.id}/priorizacao/historico`)).json();
    assert.equal(immediateHistory.length, 1);
    assert.equal(immediateHistory[0].paralisacao_confirmada_por, 2);
    assert.equal(immediateHistory[0].paralisacao_confirmada_por_nome, "Carlos Lima");
    const immediateConversion = await api(pcm, `/notas/${immediateNote.id}/converter`, "POST");
    assert.equal(immediateConversion.status, 201);
    const immediateOrderId = (await immediateConversion.json()).id;
    const immediateOrderHistory = await (await api(pcm, `/ordens/${immediateOrderId}/priorizacao/historico`)).json();
    assert.equal(immediateOrderHistory[0].paralisacao_confirmada_por_nome, "Carlos Lima");
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await pg.close();
  }
});
