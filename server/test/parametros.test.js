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

test("Metas e parâmetros dos KPIs: editáveis só pelo CCM, auditados e usados nos cálculos", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-parametros-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31477;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), JWT_SECRET: "parameters-test-secret" },
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
    const admin = (await login("admin", "admin123")).token;
    const pcm = (await login("pcm", "pcm123")).token;
    const fieldLogin = await login("campo", "campo123");
    const field = fieldLogin.token;

    // Valores de exemplo gravados pela migração.
    const initial = await (await api(pcm, "/parametros-kpi")).json();
    const value = (list, key) => list.find((item) => item.chave === key).valor;
    assert.equal(value(initial, "meta_disponibilidade"), 95);
    assert.equal(value(initial, "meta_mttr"), 4);
    assert.equal(value(initial, "exposicao_horas_dia"), 24);
    assert.equal(value(initial, "jornada_horas_dia"), 8);
    assert.equal(value(initial, "hh_semana_pessoa"), 40);
    assert.equal((await api(field, "/parametros-kpi")).status, 403);

    // Só o CCM altera; valores fora da faixa ou chaves desconhecidas são recusados.
    assert.equal((await api(pcm, "/parametros-kpi", "PUT", { valores: { meta_mttr: 6 } })).status, 403);
    assert.equal((await api(admin, "/parametros-kpi", "PUT", { valores: {} })).status, 400);
    assert.equal((await api(admin, "/parametros-kpi", "PUT", { valores: { meta_inexistente: 1 } })).status, 400);
    assert.equal((await api(admin, "/parametros-kpi", "PUT", { valores: { meta_disponibilidade: 120 } })).status, 400);
    assert.equal((await api(admin, "/parametros-kpi", "PUT", { valores: { exposicao_horas_dia: "" } })).status, 400);

    const saved = await api(admin, "/parametros-kpi", "PUT", {
      valores: { meta_disponibilidade: "90", meta_mttr: 6, meta_backlog: 10, exposicao_horas_dia: 12, jornada_horas_dia: 6, hh_semana_pessoa: 36 },
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.alterados, 5); // meta_backlog já era 10
    const disponibilidade = savedBody.parametros.find((item) => item.chave === "meta_disponibilidade");
    assert.equal(disponibilidade.valor, 90);
    assert.equal(disponibilidade.atualizado_por, "Ana Souza");

    // As metas novas aparecem na Visão geral e nos Indicadores.
    assert.deepEqual((await (await api(pcm, "/dashboard?period=30d")).json()).targets, { availability: 90, adherence: 85 });
    const report = await (await api(pcm, "/indicadores?period=30d")).json();
    const target = (tabId, key) => report.tabs.find((tab) => tab.id === tabId).metrics.find((item) => item.key === key).target;
    assert.equal(target("disponibilidade", "availability"), 90);
    assert.equal(target("confiabilidade", "mttr"), 6);
    assert.equal(target("confiabilidade", "mtbf"), 720);

    // A exposição diária entra no cálculo da disponibilidade (12 h/dia em 30 dias = 360 h por equipamento).
    const orders = await (await api(admin, "/ordens")).json();
    const order = orders.find((entry) => entry.numero === "40012352");
    assert.equal((await api(pcm, `/ordens/${order.id}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);
    assert.equal((await api(field, `/ordens/${order.id}/relatorio`, "PUT", { atividade_realizada: "Reparo.", indisponibilidade_horas: 10, tempo_reparo_horas: 2 })).status, 200);
    const withDowntime = await (await api(pcm, "/indicadores?period=30d")).json();
    const equipment = withDowntime.breakdown.equipamento.find((row) => row.label === "ESTR-3330");
    assert.ok(Math.abs(equipment.availability - ((360 - 10) / 360) * 100) < 1e-9);
    assert.ok(Math.abs(equipment.mtbf - 350) < 1e-9);

    // Jornada e HH semanal de referência chegam às telas de mão de obra.
    assert.equal((await (await api(field, "/mao-de-obra/minhas-ocorrencias")).json()).horas_dia_padrao, 6);
    assert.equal((await (await api(pcm, "/mao-de-obra")).json()).hh_semana_pessoa, 36);
    const mine = await (await api(field, "/mao-de-obra/minhas-ocorrencias")).json();
    const created = await api(field, "/mao-de-obra/ocorrencias", "POST", { colaborador_id: mine.colaboradores[0].id, tipo: "Folga", data_inicio: "2026-10-05" });
    assert.equal(created.status, 201);
    assert.equal((await (await api(field, "/mao-de-obra/minhas-ocorrencias")).json()).ocorrencias[0].horas_dia, 6);

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const trail = db.prepare("SELECT detalhe FROM trilha_auditoria WHERE acao = 'alterar_parametro_kpi' ORDER BY id").all().map((row) => row.detalhe);
      assert.equal(trail.length, 5);
      assert.ok(trail.includes("meta_disponibilidade: 95 → 90"));
      assert.ok(trail.includes("exposicao_horas_dia: 24 → 12"));
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
