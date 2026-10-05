import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { addDays, todayLocal } from "../src/iamot.js";
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

test("Notificações: geração automática, leitura, severidade, resposta, encaminhamento e auditoria", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-notificacoes-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31481;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "notifications-test-secret" },
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
    const hoje = todayLocal();

    // Inconsistência do seed (sinalização nova com 88% de confiança).
    let list = await json(pcm, "/notificacoes");
    assert.deepEqual(list.itens.map((item) => [item.tipo, item.severidade]), [["Inconsistência", "Alta"]]);

    // OM atrasada (prazo há 3 dias), atribuída ao executante.
    const orders = await json(admin, "/ordens");
    const order = orders.find((entry) => entry.numero === "40012352");
    assert.equal((await api(pcm, `/ordens/${order.id}/programacao`, "PATCH", { data_programada: addDays(hoje, -3) })).status, 200);
    assert.equal((await api(pcm, `/ordens/${order.id}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);

    // Preventivas: uma vencida e uma a vencer em 5 dias (antecedência de exemplo: 7 dias).
    const { equipamentos } = await json(admin, "/cadastros");
    const plan = (descricao, proxima_data) => api(admin, "/gestao-cadastros/planos-preventivos", "POST", { equipamento_id: String(equipamentos[0].id), descricao, periodicidade: "Mensal", proxima_data });
    await plan("Lubrificação vencida", addDays(hoje, -1));
    await plan("Inspeção a vencer", addDays(hoje, 5));
    await plan("Inspeção distante", addDays(hoje, 30));

    // Permissão pendente com alerta de risco (linha de vida não inspecionada) → crítica.
    const permitModel = (await json(field, "/formularios/modelos")).find((model) => model.tipo === "Permissão");
    const form = new FormData();
    form.append("dados", JSON.stringify({
      ordem_id: order.id, modelo_id: permitModel.id,
      validade_inicio: localDateTime(new Date(Date.now() + 3600000)), validade_fim: localDateTime(new Date(Date.now() + 5 * 3600000)),
      respostas: { atividade: "Solda", altura: "Sim", linha_vida: "Não", quente: "Não", confinado: "Não", loto: "Sim", epi: "Sim", medidas: "Isolamento" },
    }));
    form.append("arquivo:assinatura", new Blob([PNG], { type: "image/png" }), "a.png");
    const permit = await (await fetch(`http://127.0.0.1:${port}/api/permissoes`, { method: "POST", headers: { authorization: `Bearer ${field}` }, body: form })).json();

    list = await json(pcm, "/notificacoes");
    const byType = Object.fromEntries(list.itens.map((item) => [item.tipo, item]));
    assert.deepEqual(Object.keys(byType).sort(), ["Inconsistência", "OM atrasada", "Permissão pendente", "Preventiva a vencer", "Preventiva vencida"]);
    assert.equal(byType["OM atrasada"].severidade, "Alta");
    assert.match(byType["OM atrasada"].mensagem, /3 dia\(s\) de atraso/);
    assert.equal(byType["Permissão pendente"].severidade, "Crítica");
    assert.equal(byType["Preventiva vencida"].severidade, "Alta");
    assert.equal(byType["Preventiva a vencer"].severidade, "Baixa");
    assert.equal(list.itens[0].severidade, "Crítica"); // ordenadas por severidade
    assert.deepEqual(list.contagem, { "Crítica": 1, Alta: 3, "Média": 0, Baixa: 1 });
    assert.deepEqual((await json(pcm, "/notificacoes?severidade=Alta")).itens.map((item) => item.severidade), ["Alta", "Alta", "Alta"]);

    // Geração idempotente: consultar de novo não duplica.
    assert.equal((await json(pcm, "/notificacoes")).itens.length, 5);

    // Executante vê só o que é dele (OM atrasada atribuída).
    assert.deepEqual((await json(field, "/notificacoes")).itens.map((item) => item.tipo), ["OM atrasada"]);
    assert.equal((await api(field, `/notificacoes/${byType["Permissão pendente"].id}`)).status, 404);

    // Contador e leitura.
    assert.deepEqual(await json(pcm, "/notificacoes/contador"), { nao_lidas: 5, criticas: 1 });
    assert.equal((await api(pcm, `/notificacoes/${byType["OM atrasada"].id}/lida`, "POST")).status, 200);
    assert.equal((await json(pcm, "/notificacoes/contador")).nao_lidas, 4);
    assert.equal((await json(admin, "/notificacoes/contador")).nao_lidas, 5); // leitura é por usuário
    assert.equal((await json(pcm, "/notificacoes?nao_lidas=1")).itens.length, 4);

    // Responder (em tratamento), resolver (só gestão) e encaminhar.
    const late = byType["OM atrasada"].id;
    assert.equal((await api(field, `/notificacoes/${late}/responder`, "POST", { texto: " " })).status, 400);
    assert.equal((await api(field, `/notificacoes/${late}/responder`, "POST", { texto: "Aguardando peça.", resolver: true })).status, 403);
    assert.deepEqual(await json(field, `/notificacoes/${late}/responder`, "POST", { texto: "Aguardando peça do almoxarifado." }), { ok: true, status: "Em tratamento" });

    const signal = byType["Inconsistência"].id;
    assert.equal((await api(pcm, `/notificacoes/${signal}/encaminhar`, "POST", { usuario_id: 99999 })).status, 400);
    const recipients = await json(pcm, "/notificacoes/destinatarios");
    assert.ok(!recipients.some((user) => user.nome === "Carlos Lima"));
    assert.deepEqual(await json(pcm, `/notificacoes/${signal}/encaminhar`, "POST", { usuario_id: fieldLogin.user.id, texto: "Confira o HH apropriado." }), { ok: true, encaminhada_para: "João Pereira" });
    const fieldList = await json(field, "/notificacoes");
    assert.deepEqual(fieldList.itens.map((item) => item.tipo).sort(), ["Inconsistência", "OM atrasada"]);
    assert.equal(fieldList.itens.find((item) => item.id === signal).lida, false);
    const detail = await json(field, `/notificacoes/${signal}`);
    assert.deepEqual(detail.encaminhada_para, ["João Pereira"]);
    assert.deepEqual(detail.acoes.map((action) => [action.tipo, action.usuario, action.destinatario]), [["Encaminhamento", "Carlos Lima", "João Pereira"]]);

    const overdue = byType["Preventiva vencida"].id;
    assert.deepEqual(await json(pcm, `/notificacoes/${overdue}/responder`, "POST", { texto: "OM será gerada amanhã.", resolver: true }), { ok: true, status: "Resolvida" });
    assert.equal((await api(pcm, `/notificacoes/${overdue}/responder`, "POST", { texto: "x" })).status, 409);

    // Resolução automática quando a condição deixa de existir.
    assert.equal((await api(admin, `/permissoes/${permit.id}/aprovar`, "POST", {})).status, 200);
    const signalId = (await json(admin, "/sinalizacoes")).find((item) => item.status === "Nova").id;
    assert.equal((await api(admin, `/sinalizacoes/${signalId}/aceitar`, "POST")).status, 200);
    list = await json(pcm, "/notificacoes");
    assert.deepEqual(list.itens.map((item) => item.tipo).sort(), ["OM atrasada", "Preventiva a vencer"]);
    const resolved = await json(pcm, "/notificacoes?status=resolvidas");
    const resolvedBy = Object.fromEntries(resolved.itens.map((item) => [item.tipo, item]));
    assert.match(resolvedBy["Permissão pendente"].resolucao, /automaticamente/);
    assert.equal(resolvedBy["Preventiva vencida"].resolvida_por, "Carlos Lima"); // resolução manual não reabre
    assert.equal((await json(pcm, "/notificacoes")).itens.length, 2);
    assert.deepEqual(await json(pcm, "/notificacoes/lidas", "POST"), { marcadas: 1 });
    assert.equal((await json(pcm, "/notificacoes/contador")).nao_lidas, 0);

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const actions = Object.fromEntries(db.prepare("SELECT acao, COUNT(*) AS total FROM trilha_auditoria WHERE acao LIKE '%notificacao' GROUP BY acao")
        .all().map((row) => [row.acao, row.total]));
      assert.deepEqual(actions, { encaminhar_notificacao: 1, resolver_notificacao: 1, responder_notificacao: 1 });
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
