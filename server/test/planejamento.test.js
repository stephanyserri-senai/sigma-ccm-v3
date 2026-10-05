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

test("Planejamento semanal, passagem de turno e resumo do PCM", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-planejamento-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31478;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), JWT_SECRET: "planning-test-secret" },
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
    const field = (await login("campo", "campo123")).token;

    const semana = weekStart(todayLocal());
    const [segunda, terca, quarta, sabado] = [0, 1, 2, 5].map((offset) => addDays(semana, offset));
    const { equipes } = await (await api(admin, "/cadastros")).json();
    const caldeiraria = equipes.find((team) => team.nome === "Caldeiraria");
    const orders = await (await api(admin, "/ordens")).json();
    const programada = orders.find((order) => order.numero === "40012352");
    const aberta = orders.find((order) => order.numero === "40012350");

    assert.equal((await api(field, `/planejamento?semana=${semana}`)).status, 403);

    // Sem HH lançado, a capacidade é estimada: 1 usuário × 40 h ÷ 5 dias = 8 h por dia útil.
    const empty = await (await api(pcm, `/planejamento?semana=${addDays(semana, 3)}`)).json();
    assert.deepEqual(empty.semana, { inicio: semana, fim: addDays(semana, 6) });
    const emptyTeam = empty.equipes.find((team) => team.id === caldeiraria.id);
    assert.equal(emptyTeam.capacidade_estimada, true);
    assert.equal(emptyTeam.dias[0].capacidade, 8);
    assert.equal(emptyTeam.dias[5].capacidade, 0);
    assert.equal(empty.resumo.aderencia_prevista, null);
    assert.ok(empty.pendentes.some((order) => order.id === aberta.id));

    // Com HH lançado (20 h), a capacidade diária passa a 4 h.
    assert.equal((await api(pcm, "/mao-de-obra/hh-disponivel", "PUT", { equipe_id: caldeiraria.id, semana, hh_disponivel: 20 })).status, 200);

    const alloc = (token, body) => api(token, "/planejamento/alocacoes", "POST", body);
    assert.equal((await alloc(field, { ordem_id: programada.id, equipe_id: caldeiraria.id, data: segunda, hh_previsto: 3 })).status, 403);
    assert.equal((await alloc(pcm, { ordem_id: programada.id, equipe_id: caldeiraria.id, data: segunda, hh_previsto: 0 })).status, 400);
    assert.equal((await alloc(pcm, { ordem_id: programada.id, equipe_id: caldeiraria.id, data: "31/12/2026", hh_previsto: 3 })).status, 400);
    assert.equal((await alloc(pcm, { ordem_id: programada.id, equipe_id: 99999, data: segunda, hh_previsto: 3 })).status, 400);
    assert.equal((await alloc(pcm, { ordem_id: 99999, equipe_id: caldeiraria.id, data: segunda, hh_previsto: 3 })).status, 400);
    assert.equal((await alloc(pcm, { ordem_id: programada.id, equipe_id: caldeiraria.id, data: segunda, hh_previsto: 3 })).status, 201);
    const overload = await alloc(pcm, { ordem_id: programada.id, equipe_id: caldeiraria.id, data: terca, hh_previsto: 6, observacao: "Troca de chapas" });
    assert.equal(overload.status, 201);
    const overloadId = (await overload.json()).id;
    assert.equal((await alloc(admin, { ordem_id: aberta.id, equipe_id: caldeiraria.id, data: quarta, hh_previsto: 2 })).status, 201);
    const weekend = await alloc(pcm, { ordem_id: aberta.id, equipe_id: caldeiraria.id, data: sabado, hh_previsto: 1 });
    const weekendId = (await weekend.json()).id;

    let plan = await (await api(pcm, `/planejamento?semana=${semana}`)).json();
    let team = plan.equipes.find((item) => item.id === caldeiraria.id);
    assert.equal(team.capacidade_estimada, false);
    assert.equal(team.dias[0].carga, 75);
    assert.equal(team.dias[1].carga, 150);
    assert.equal(team.dias[1].sobrecarga, true);
    assert.equal(team.dias[5].sobrecarga, true); // fim de semana sem capacidade
    assert.equal(team.total.capacidade, 20);
    assert.equal(team.total.alocado, 12);
    assert.equal(team.total.carga, 60);
    assert.equal(plan.resumo.oms_alocadas, 2);
    assert.equal(plan.resumo.aderencia_prevista, 0);
    assert.equal(plan.resumo.meta_aderencia, 85);
    assert.equal(plan.alocacoes.find((item) => item.id === overloadId).observacao, "Troca de chapas");

    // A OM alocada passa a programada, com as datas da primeira e da última alocação.
    const scheduled = await (await api(pcm, `/ordens/${aberta.id}`)).json();
    assert.equal(scheduled.status, "Programada");
    assert.equal(scheduled.data_programada, quarta);
    assert.equal(scheduled.data_fim_programada, sabado);
    assert.equal(scheduled.equipe_id, caldeiraria.id);

    // Ajustar a alocação remove a sobrecarga e recalcula a aderência prevista.
    assert.equal((await api(pcm, `/planejamento/alocacoes/${overloadId}`, "PUT", { equipe_id: caldeiraria.id, data: terca, hh_previsto: 4 })).status, 200);
    assert.equal((await api(pcm, `/planejamento/alocacoes/${weekendId}`, "DELETE")).status, 204);
    assert.equal((await api(pcm, "/planejamento/alocacoes/99999", "DELETE")).status, 404);
    plan = await (await api(pcm, `/planejamento?semana=${semana}`)).json();
    team = plan.equipes.find((item) => item.id === caldeiraria.id);
    assert.equal(team.dias[1].carga, 100);
    assert.equal(team.dias[1].sobrecarga, false);
    assert.equal(plan.resumo.aderencia_prevista, 100);
    assert.equal((await (await api(pcm, `/ordens/${aberta.id}`)).json()).data_fim_programada, null);

    // OM encerrada não recebe alocação.
    assert.equal((await api(pcm, `/ordens/${programada.id}/status`, "PATCH", { status: "Encerrada" })).status, 200);
    assert.equal((await alloc(pcm, { ordem_id: programada.id, equipe_id: caldeiraria.id, data: quarta, hh_previsto: 1 })).status, 409);

    // Passagem de turno: registro estruturado e confirmação de leitura.
    const handover = { data: segunda, turno: "Manhã", equipe_id: caldeiraria.id, ocorrencias: "Vazamento leve na TR01.", feito: "Inspeção da bomba 02.", pendencias: "Trocar gaxeta.", avisos: "Isolar a área antes de iniciar." };
    assert.equal((await api(field, "/passagens-turno", "POST", { ...handover, feito: " " })).status, 400);
    assert.equal((await api(field, "/passagens-turno", "POST", { ...handover, turno: "Madrugada" })).status, 400);
    const created = await api(field, "/passagens-turno", "POST", handover);
    assert.equal(created.status, 201);
    const handoverId = (await created.json()).id;

    let summary = await (await api(pcm, "/planejamento/resumo")).json();
    assert.equal(summary.alertas.passagens_nao_lidas, 1);
    assert.equal(summary.fluxo.notas_abertas, 4);
    assert.equal(summary.semana.aderencia_prevista, 100);
    assert.equal((await api(field, "/planejamento/resumo")).status, 403);

    const pending = await (await api(pcm, "/passagens-turno?filtro=pendentes")).json();
    assert.deepEqual(pending.map((row) => row.id), [handoverId]);
    assert.equal(pending[0].autor, "João Pereira");
    assert.equal(pending[0].avisos, "Isolar a área antes de iniciar.");
    assert.equal((await api(field, `/passagens-turno/${handoverId}/leitura`, "POST")).status, 409);
    assert.equal((await api(pcm, `/passagens-turno/${handoverId}/leitura`, "POST")).status, 201);
    assert.equal((await api(pcm, `/passagens-turno/${handoverId}/leitura`, "POST")).status, 200);
    assert.equal((await api(pcm, "/passagens-turno/99999/leitura", "POST")).status, 404);
    assert.deepEqual(await (await api(pcm, "/passagens-turno?filtro=pendentes")).json(), []);
    const all = await (await api(field, "/passagens-turno")).json();
    assert.equal(all[0].sou_autor, true);
    assert.deepEqual(all[0].leituras.map((row) => row.nome), ["Carlos Lima"]);
    summary = await (await api(pcm, "/planejamento/resumo")).json();
    assert.equal(summary.alertas.passagens_nao_lidas, 0);

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const actions = db.prepare(`
        SELECT acao, COUNT(*) AS total FROM trilha_auditoria
        WHERE acao IN ('alocar_atividade','editar_alocacao','remover_alocacao','registrar_passagem_turno','confirmar_leitura_passagem')
        GROUP BY acao
      `).all();
      assert.deepEqual(Object.fromEntries(actions.map((row) => [row.acao, row.total])), {
        alocar_atividade: 4, confirmar_leitura_passagem: 1, editar_alocacao: 1, registrar_passagem_turno: 1, remover_alocacao: 1,
      });
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
