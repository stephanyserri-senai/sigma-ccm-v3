import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { localDateTime } from "../src/routes/permissoes.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

test("Rotas de inspeção (rondas guiadas e desvios) e Permissão de Trabalho com aprovação", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-inspecoes-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31480;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "inspection-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const api = (token, path, method = "GET", body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const multipart = (token, path, dados, files = {}) => {
      const form = new FormData();
      form.append("dados", JSON.stringify(dados));
      for (const [campo, name] of Object.entries(files)) form.append(`arquivo:${campo}`, new Blob([PNG], { type: "image/png" }), name);
      return fetch(`http://127.0.0.1:${port}/api${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    };
    const login = async (username, senha) => (await (await api("", "/auth/login", "POST", { username, senha })).json());
    const admin = (await login("admin", "admin123")).token;
    const pcm = (await login("pcm", "pcm123")).token;
    const fieldLogin = await login("campo", "campo123");
    const field = fieldLogin.token;

    const models = await (await api(admin, "/formularios/modelos")).json();
    const inspection = models.find((model) => model.tipo === "Inspeção");
    const permitModel = models.find((model) => model.tipo === "Permissão");
    const checklist = models.find((model) => model.tipo === "Checklist");
    const { equipamentos } = await (await api(admin, "/cadastros")).json();
    const [bomba, motor] = ["TR01-BOMBA-02", "PA-2200-MOT"].map((tag) => equipamentos.find((item) => item.tag === tag));

    // ------------------------------------------------ Rotas de inspeção
    const route = { nome: "Rota Terminal Leste", area: "Terminal Leste", pontos: [
      { equipamento_id: bomba.id, modelo_id: inspection.id, instrucao: "Medir vibração no mancal LOA." },
      { equipamento_id: motor.id, modelo_id: inspection.id },
    ] };
    assert.equal((await api(field, "/inspecoes/rotas", "POST", route)).status, 403);
    assert.equal((await api(pcm, "/inspecoes/rotas", "POST", { ...route, pontos: [] })).status, 400);
    assert.equal((await api(pcm, "/inspecoes/rotas", "POST", { ...route, pontos: [{ equipamento_id: bomba.id, modelo_id: 99999 }] })).status, 400);
    const createdRoute = await api(pcm, "/inspecoes/rotas", "POST", route);
    assert.equal(createdRoute.status, 201);
    const routeId = (await createdRoute.json()).id;
    const routeDetail = await (await api(field, `/inspecoes/rotas/${routeId}`)).json();
    assert.deepEqual(routeDetail.pontos.map((point) => [point.sequencia, point.equipamento]), [[1, "TR01-BOMBA-02"], [2, "PA-2200-MOT"]]);

    // Ronda guiada pelo executante.
    const started = await api(field, "/inspecoes/rondas", "POST", { rota_id: routeId });
    assert.equal(started.status, 201);
    const roundId = (await started.json()).id;
    assert.equal((await api(field, "/inspecoes/rondas", "POST", { rota_id: routeId })).status, 409);
    // Editar a rota depois de iniciada não altera a ronda.
    assert.equal((await api(admin, `/inspecoes/rotas/${routeId}`, "PUT", { ...route, pontos: route.pontos.slice(0, 1) })).status, 200);
    let round = await (await api(field, `/inspecoes/rondas/${roundId}`)).json();
    assert.equal(round.pontos.length, 2);
    assert.equal(round.pontos[0].instrucao, "Medir vibração no mancal LOA.");
    const [first, second] = round.pontos;

    const answerPoint = (token, point, respostas, files) => multipart(token, `/inspecoes/rondas/${roundId}/pontos/${point.id}/resposta`, { respostas }, files);
    assert.equal((await answerPoint(field, first, { ruido: "Não" })).status, 400); // vibração obrigatória
    assert.equal((await answerPoint(pcm, first, { ruido: "Não", vibracao: 2, vazamento: "Não" })).status, 404); // só o executor
    assert.equal((await api(field, `/inspecoes/rondas/${roundId}/concluir`, "POST", {})).status, 409); // pontos pendentes
    const answered = await answerPoint(field, first, { ruido: "Sim", vibracao: 7.1, vazamento: "Sim", local_vazamento: "Selo mecânico" }, { foto: "ponto1.png" });
    assert.equal(answered.status, 201);
    assert.deepEqual((await answered.json()).nao_conformidades.map((item) => item.campo), ["ruido", "vibracao", "vazamento"]);
    assert.equal((await answerPoint(field, first, { ruido: "Não", vibracao: 1, vazamento: "Não" })).status, 409);
    assert.equal((await api(field, `/inspecoes/rondas/${roundId}/pontos/${second.id}/pular`, "POST", {})).status, 400);
    assert.equal((await api(field, `/inspecoes/rondas/${roundId}/pontos/${second.id}/pular`, "POST", { motivo: "Área interditada" })).status, 200);
    const concluded = await api(field, `/inspecoes/rondas/${roundId}/concluir`, "POST", { observacao: "Ronda com vazamento." });
    assert.deepEqual(await concluded.json(), { ok: true, desvios: 4 });

    round = await (await api(pcm, `/inspecoes/rondas/${roundId}`)).json();
    assert.equal(round.status, "Concluída");
    assert.equal(round.usuario_nome, "João Pereira");
    assert.deepEqual(round.pontos.map((point) => point.status), ["Inspecionado", "Não inspecionado"]);
    assert.deepEqual(round.desvios.map((item) => item.tipo), ["Não conformidade", "Não conformidade", "Não conformidade", "Ponto não inspecionado"]);
    const list = await (await api(pcm, "/inspecoes/rondas")).json();
    assert.deepEqual([list[0].pontos, list[0].pontos_feitos, list[0].desvios], [2, 2, 4]);
    // A resposta do ponto é uma resposta comum do motor, vinculada ao equipamento.
    const response = await (await api(field, `/formularios/respostas/${round.pontos[0].resposta_id}`)).json();
    assert.equal(response.equipamento, "TR01-BOMBA-02");
    assert.equal(response.anexos.length, 1);
    assert.equal((await api(admin, `/inspecoes/rondas/${roundId}/pontos/${second.id}/pular`, "POST", { motivo: "x" })).status, 404);
    assert.deepEqual(await (await api(pcm, `/inspecoes/rotas/${routeId}`, "DELETE")).json(), { desativada: true });

    // ------------------------------------------------ Permissão de Trabalho
    const orders = await (await api(admin, "/ordens")).json();
    const order = orders.find((entry) => entry.numero === "40012350");
    assert.equal((await api(pcm, `/ordens/${order.id}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);
    const now = new Date();
    const window = { validade_inicio: localDateTime(new Date(now.getTime() - 60 * 60000)), validade_fim: localDateTime(new Date(now.getTime() + 8 * 3600000)) };
    const permitAnswers = { atividade: "Troca do rolamento", altura: "Sim", linha_vida: "Não", quente: "Não", confinado: "Não", loto: "Sim", epi: "Sim", medidas: "Isolamento da área" };
    const request = (token, extra = {}, files = { assinatura: "assinatura.png" }) => multipart(token, "/permissoes", { ordem_id: order.id, modelo_id: permitModel.id, ...window, respostas: permitAnswers, ...extra }, files);

    assert.equal((await request(field, { modelo_id: checklist.id })).status, 400); // modelo não é Permissão
    assert.equal((await request(field, {}, {})).status, 400); // assinatura obrigatória
    assert.equal((await request(field, { validade_fim: window.validade_inicio })).status, 400);
    assert.equal((await request(field, { validade_fim: localDateTime(new Date(now.getTime() + 30 * 3600000)) })).status, 400); // > 24 h
    const other = orders.find((entry) => entry.numero === "40012345");
    assert.equal((await request(field, { ordem_id: other.id })).status, 404);
    const requested = await request(field);
    assert.equal(requested.status, 201);
    const permit = await requested.json();
    assert.match(permit.numero, /^PT-\d{5}$/);
    assert.deepEqual(permit.nao_conformidades.map((item) => item.campo), ["linha_vida"]); // alerta de risco ao aprovador

    // A OM passa a exigir PT: sem aprovação, a execução não inicia.
    let detail = await (await api(field, `/ordens/${order.id}`)).json();
    assert.equal(detail.exige_pt, true);
    assert.equal(detail.pt_vigente, null);
    assert.equal(detail.permissoes[0].status, "Solicitada");
    assert.equal((await api(field, `/ordens/${order.id}/execucao/iniciar`, "POST", { num_executantes: 2 })).status, 409);

    // Aprovação: só PCM/CCM, nunca o próprio solicitante; reprovação exige motivo.
    assert.equal((await api(field, `/permissoes/${permit.id}/aprovar`, "POST", {})).status, 403);
    assert.equal((await api(pcm, `/permissoes/${permit.id}/reprovar`, "POST", {})).status, 400);
    const rejected = await api(pcm, `/permissoes/${permit.id}/reprovar`, "POST", { parecer: "Linha de vida não inspecionada." });
    assert.equal((await rejected.json()).status, "Reprovada");
    assert.equal((await api(admin, `/permissoes/${permit.id}/aprovar`, "POST", {})).status, 409);

    const second_request = await request(field, { respostas: { ...permitAnswers, linha_vida: "Sim" } });
    const permit2 = await second_request.json();
    assert.deepEqual(permit2.nao_conformidades, []);
    const ownRequest = await multipart(pcm, "/permissoes", { ordem_id: order.id, modelo_id: permitModel.id, ...window, respostas: permitAnswers }, { assinatura: "a.png" });
    const ownPermit = await ownRequest.json();
    assert.equal((await api(pcm, `/permissoes/${ownPermit.id}/aprovar`, "POST", {})).status, 403); // segregação de funções
    assert.equal((await api(pcm, `/permissoes/${ownPermit.id}/cancelar`, "POST", { parecer: "Duplicada" })).status, 200);
    const approved = await (await api(admin, `/permissoes/${permit2.id}/aprovar`, "POST", { parecer: "Liberado." })).json();
    assert.equal(approved.status, "Aprovada");
    assert.equal(approved.aprovador, "Ana Souza");
    assert.equal(approved.vigente, true);

    detail = await (await api(field, `/ordens/${order.id}`)).json();
    assert.equal(detail.pt_vigente.numero, permit2.numero);
    assert.equal((await api(field, `/ordens/${order.id}/execucao/iniciar`, "POST", { num_executantes: 2 })).status, 201);

    // Executante vê as PTs que solicitou e as das OMs atribuídas a ele (inclusive a aberta pelo PCM).
    const mine = await (await api(field, "/permissoes")).json();
    assert.deepEqual(mine.map((item) => item.numero).sort(), [permit.numero, permit2.numero, ownPermit.numero].sort());
    assert.equal((await api(field, `/permissoes/${ownPermit.id}/cancelar`, "POST", {})).status, 403); // só quem solicitou
    assert.equal((await api(field, "/permissoes?ordem_id=" + other.id)).status, 200);
    assert.deepEqual(await (await api(field, "/permissoes?ordem_id=" + other.id)).json(), []);
    assert.equal((await api(field, `/permissoes/${permit2.id}/encerrar`, "POST", { parecer: "Serviço concluído, área liberada." })).status, 200);
    assert.equal((await (await api(pcm, `/permissoes/${permit2.id}`)).json()).encerrada_por_nome, "João Pereira");
    assert.equal((await api(pcm, `/permissoes/ordem/${order.id}/exigencia`, "PATCH", { exige_pt: false })).status, 200);
    assert.equal((await api(field, `/permissoes/ordem/${order.id}/exigencia`, "PATCH", { exige_pt: true })).status, 403);

    const summary = await (await api(pcm, "/planejamento/resumo")).json();
    assert.equal(summary.alertas.pts_aguardando, 0);
    assert.equal(summary.alertas.rondas_em_andamento, 0);

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const actions = Object.fromEntries(db.prepare(`
        SELECT acao, COUNT(*) AS total FROM trilha_auditoria
        WHERE acao LIKE '%ronda%' OR acao LIKE '%rota_inspecao%' OR acao LIKE '%permissao_trabalho%' OR acao = 'exigencia_pt_ordem'
        GROUP BY acao
      `).all().map((row) => [row.acao, row.total]));
      assert.deepEqual(actions, {
        aprovar_permissao_trabalho: 1, cancelar_permissao_trabalho: 1, concluir_ronda_inspecao: 1, criar_rota_inspecao: 1,
        desativar_rota_inspecao: 1, editar_rota_inspecao: 1, encerrar_permissao_trabalho: 1, exigencia_pt_ordem: 1,
        iniciar_ronda_inspecao: 1, inspecionar_ponto_ronda: 1, pular_ponto_ronda: 1, reprovar_permissao_trabalho: 1,
        solicitar_permissao_trabalho: 3,
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
