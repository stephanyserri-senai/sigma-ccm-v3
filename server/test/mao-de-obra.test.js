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

test("semana começa na segunda-feira e datas inválidas são rejeitadas", () => {
  assert.equal(weekStart("2026-10-02"), "2026-09-28");
  assert.equal(weekStart("2026-09-28"), "2026-09-28");
  assert.equal(weekStart("2026-10-04"), "2026-09-28");
  assert.equal(weekStart("2026-02-31"), null);
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
});

test("Mão de obra: HH disponível, ocorrências, IAMOT, LGPD, cronômetro e equipe do usuário", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-mao-de-obra-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31474;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "labor-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const api = (token, path, method = "GET", body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const login = async (username, senha) => {
      const response = await api("", "/auth/login", "POST", { username, senha });
      assert.equal(response.status, 200);
      return response.json();
    };
    const admin = (await login("admin", "admin123")).token;
    const pcm = (await login("pcm", "pcm123")).token;
    const fieldLogin = await login("campo", "campo123");
    const field = fieldLogin.token;

    // Usuário do seed herda a equipe do colaborador vinculado.
    assert.equal(fieldLogin.user.equipe, "Caldeiraria");
    assert.equal((await api(field, "/mao-de-obra")).status, 403);

    // Todo usuário novo precisa de uma equipe cadastrada.
    const { equipes } = await (await api(admin, "/cadastros")).json();
    const caldeiraria = equipes.find((team) => team.nome === "Caldeiraria");
    const automacao = equipes.find((team) => team.nome === "Automação");
    const newUser = { nome: "Rita Teste", username: "rita", senha: "rita123", papel: "EXECUTANTE" };
    assert.equal((await api(admin, "/usuarios", "POST", newUser)).status, 400);
    assert.equal((await api(admin, "/usuarios", "POST", { ...newUser, equipe_id: 99999 })).status, 400);
    const createdUser = await api(admin, "/usuarios", "POST", { ...newUser, equipe_id: automacao.id });
    assert.equal(createdUser.status, 201);
    const ritaId = (await createdUser.json()).id;
    assert.equal((await api(admin, `/usuarios/${ritaId}/equipe`, "PATCH", { equipe_id: caldeiraria.id })).status, 200);
    assert.equal((await api(admin, `/usuarios/${ritaId}/equipe`, "PATCH", {})).status, 400);
    const users = await (await api(admin, "/usuarios")).json();
    assert.equal(users.find((user) => user.username === "rita").equipe, "Caldeiraria");
    assert.equal((await api(admin, "/usuarios", "POST", { nome: "Otto Teste", username: "otto", senha: "otto123", papel: "EXECUTANTE", equipe_id: automacao.id })).status, 201);

    // Execução cronometrada: nº de executantes, nomes, intercorrência e HH automático.
    const orders = await (await api(admin, "/ordens")).json();
    const order = orders.find((entry) => entry.numero === "40012352");
    assert.equal((await api(pcm, `/ordens/${order.id}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);
    const base = `/ordens/${order.id}/execucao`;
    assert.equal((await api(field, `${base}/intercorrencias`, "POST", { tipo: "Desvio", descricao: "Antes de iniciar" })).status, 409);
    assert.equal((await api(field, `${base}/finalizar`, "POST")).status, 409);
    assert.equal((await api(field, `${base}/iniciar`, "POST", { num_executantes: 0 })).status, 400);
    assert.equal((await api(field, `${base}/iniciar`, "POST", { num_executantes: 1, nomes: ["A", "B"] })).status, 400);
    assert.equal((await api(pcm, `${base}/iniciar`, "POST", { num_executantes: 1 })).status, 403);
    assert.equal((await api(field, `${base}/iniciar`, "POST", { num_executantes: 3, nomes: ["João Pereira", " José M. Alves ", ""] })).status, 201);
    assert.equal((await api(field, `${base}/iniciar`, "POST", { num_executantes: 1 })).status, 409);
    assert.equal((await api(field, "/apontamentos", "POST", { ordem_id: order.id, tipo: "Apropriação", hh: 5 })).status, 409);
    assert.equal((await api(field, `${base}/intercorrencias`, "POST", { tipo: "Inexistente", descricao: "x" })).status, 400);
    assert.equal((await api(field, `${base}/intercorrencias`, "POST", { tipo: "Alteração de rota", descricao: "Acesso bloqueado; rota pelo pátio B." })).status, 201);

    const running = await (await api(field, `/ordens/${order.id}`)).json();
    assert.equal(running.status, "Em execução");
    assert.equal(running.execucao.num_executantes, 3);
    assert.deepEqual(running.execucao.executantes, ["João Pereira", "José M. Alves"]);
    assert.equal(running.execucao.finalizado_em, null);
    assert.equal(running.intercorrencias.length, 1);
    assert.match(running.servidor_agora, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const finished = await api(field, `${base}/finalizar`, "POST");
    assert.equal(finished.status, 201);
    const finishedBody = await finished.json();
    assert.ok(finishedBody.hh >= 0.01);
    assert.equal(finishedBody.num_executantes, 3);
    assert.equal((await api(field, `${base}/finalizar`, "POST")).status, 409);
    const done = await (await api(admin, `/ordens/${order.id}`)).json();
    assert.equal(done.execucao.hh_calculado, finishedBody.hh);
    assert.equal(done.apontamentos.find((entry) => entry.tipo === "Apropriação").hh_apropriado, finishedBody.hh);

    // HH disponível por equipe/semana e IAMOT com desconto de ocorrências.
    const semana = weekStart(todayLocal());
    assert.equal((await api(pcm, "/mao-de-obra/hh-disponivel", "PUT", { equipe_id: caldeiraria.id, semana, hh_disponivel: -1 })).status, 400);
    assert.equal((await api(pcm, "/mao-de-obra/hh-disponivel", "PUT", { equipe_id: 99999, semana, hh_disponivel: 40 })).status, 400);
    // Qualquer dia da semana é normalizado para a segunda-feira; relançar atualiza o valor.
    assert.equal((await api(pcm, "/mao-de-obra/hh-disponivel", "PUT", { equipe_id: caldeiraria.id, semana: addDays(semana, 3), hh_disponivel: 80 })).status, 200);
    assert.equal((await api(pcm, "/mao-de-obra/hh-disponivel", "PUT", { equipe_id: caldeiraria.id, semana, hh_disponivel: 40 })).status, 200);

    const before = await (await api(admin, `/mao-de-obra?semana=${semana}`)).json();
    assert.deepEqual(before.semana, { inicio: semana, fim: addDays(semana, 6) });
    const teamBefore = before.equipes.find((team) => team.equipe_id === caldeiraria.id);
    assert.equal(teamBefore.hh_disponivel, 40);
    assert.equal(teamBefore.hh_ocorrencias, 0);
    assert.equal(teamBefore.hh_apropriado, finishedBody.hh);
    assert.ok(Math.abs(teamBefore.iamot - (finishedBody.hh / 40) * 100) < 1e-9);
    assert.equal(before.equipes.find((team) => team.equipe_id === automacao.id).iamot, null);

    // Ocorrências são enviadas pelo executante (colaboradores da própria equipe); CCM e PCM só acompanham.
    const mine = await (await api(field, "/mao-de-obra/minhas-ocorrencias")).json();
    assert.equal(mine.equipe.nome, "Caldeiraria");
    // Colaboradores são os usuários da equipe (cadastrados em Usuários).
    assert.deepEqual(mine.colaboradores.map((person) => person.username), ["campo", "rita"]);
    assert.ok(mine.tipos_ocorrencia.includes("Atestado"));
    const collaborator = mine.colaboradores[0];
    const { colaboradores } = await (await api(admin, "/cadastros")).json();
    assert.ok(!colaboradores.some((person) => person.nome === "Marisa A. Rios"));
    const outsider = colaboradores.find((person) => person.nome === "Otto Teste");
    const atestado = { colaborador_id: collaborator.id, tipo: "Atestado", data_inicio: semana, data_fim: addDays(semana, 1), observacao: "CID reservado" };
    assert.equal((await api(pcm, "/mao-de-obra/ocorrencias", "POST", atestado)).status, 403);
    assert.equal((await api(admin, "/mao-de-obra/ocorrencias", "POST", atestado)).status, 403);
    assert.equal((await api(admin, "/mao-de-obra/minhas-ocorrencias")).status, 403);
    assert.equal((await api(field, "/mao-de-obra/ocorrencias", "POST", { ...atestado, colaborador_id: outsider.id })).status, 403);
    const atestadoResponse = await api(field, "/mao-de-obra/ocorrencias", "POST", atestado);
    assert.equal(atestadoResponse.status, 201);
    const atestadoId = (await atestadoResponse.json()).id;
    // Folga no sábado e domingo não desconta HH (somente dias úteis).
    const folgaResponse = await api(field, "/mao-de-obra/ocorrencias", "POST", {
      colaborador_id: collaborator.id, tipo: "Folga", data_inicio: addDays(semana, 5), data_fim: addDays(semana, 6),
    });
    assert.equal(folgaResponse.status, 201);
    const folgaId = (await folgaResponse.json()).id;
    assert.equal((await api(field, "/mao-de-obra/ocorrencias", "POST", {
      colaborador_id: collaborator.id, tipo: "Falta", data_inicio: addDays(semana, 2), data_fim: addDays(semana, 1),
    })).status, 400);
    const sent = await (await api(field, "/mao-de-obra/minhas-ocorrencias")).json();
    assert.deepEqual(sent.ocorrencias.map((row) => row.tipo), ["Folga", "Atestado"]);

    const adminView = await (await api(admin, `/mao-de-obra?semana=${semana}`)).json();
    const teamAfter = adminView.equipes.find((team) => team.equipe_id === caldeiraria.id);
    assert.equal(teamAfter.hh_ocorrencias, 16);
    assert.equal(teamAfter.hh_liquido, 24);
    assert.ok(Math.abs(teamAfter.iamot - (finishedBody.hh / 24) * 100) < 1e-9);
    assert.equal(adminView.total.hh_liquido, 24);
    const adminRow = adminView.ocorrencias.find((row) => row.id === atestadoId);
    assert.equal(adminRow.colaborador, "João Pereira");
    assert.equal(teamAfter.colaboradores, 2);
    assert.equal(adminRow.enviado_por, "João Pereira");
    assert.deepEqual(adminView.intercorrencias.map((item) => [item.ordem_numero, item.tipo, item.equipe]), [["40012352", "Alteração de rota", "Caldeiraria"]]);
    assert.equal(adminRow.tipo, "Atestado");
    assert.equal(adminRow.observacao, "CID reservado");

    const pcmView = await (await api(pcm, `/mao-de-obra?semana=${semana}`)).json();
    const pcmRow = pcmView.ocorrencias.find((row) => row.id === atestadoId);
    assert.equal(pcmRow.tipo, "Ausência");
    assert.equal(pcmRow.observacao, null);
    assert.equal(pcmRow.restrito, true);
    assert.ok(!JSON.stringify(pcmView).includes("Atestado"));
    assert.equal(pcmView.equipes.find((team) => team.equipe_id === caldeiraria.id).hh_liquido, 24);
    assert.equal(pcmView.intercorrencias.length, 1);
    assert.equal((await api(pcm, `/mao-de-obra/ocorrencias/${atestadoId}`, "DELETE")).status, 403);
    assert.equal((await api(pcm, `/mao-de-obra/ocorrencias/${folgaId}`, "DELETE")).status, 403);
    assert.equal((await api(field, `/mao-de-obra/ocorrencias/${folgaId}`, "DELETE")).status, 204);

    // O dashboard usa o mesmo cálculo (não mais HH apropriado ÷ HH previsto).
    const dashboard = await (await api(admin, "/dashboard?period=30d&area=all")).json();
    assert.ok(Math.abs(dashboard.kpis.iamot.value - (finishedBody.hh / 24) * 100) < 1e-9);
    assert.equal(dashboard.labor.liquido, 24);
    assert.equal(dashboard.labor.ocorrencias, 16);

    assert.equal((await api(admin, `/mao-de-obra/ocorrencias/${atestadoId}`, "DELETE")).status, 204);
    assert.equal((await api(pcm, "/mao-de-obra/hh-disponivel", "PUT", { equipe_id: caldeiraria.id, semana, hh_disponivel: "" })).status, 200);
    const cleared = await (await api(admin, `/mao-de-obra?semana=${semana}`)).json();
    assert.equal(cleared.equipes.find((team) => team.equipe_id === caldeiraria.id).hh_disponivel, null);
    assert.equal((await (await api(admin, "/dashboard?period=30d&area=all")).json()).kpis.iamot.value, null);

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const trail = db.prepare("SELECT acao, detalhe FROM trilha_auditoria WHERE acao LIKE '%ocorrencia_hh'").all();
      assert.ok(trail.length >= 3);
      assert.ok(trail.every((row) => !/atestado/i.test(row.detalhe || "")));
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
