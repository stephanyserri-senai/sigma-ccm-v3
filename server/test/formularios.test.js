import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

test("Formulários dinâmicos: modelos No-Code, respostas com anexos e checklist inteligente na OM", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-formularios-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31479;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "forms-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const api = (token, path, method = "GET", body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const submit = (token, dados, files = {}) => {
      const form = new FormData();
      form.append("dados", JSON.stringify(dados));
      for (const [campo, name] of Object.entries(files)) form.append(`arquivo:${campo}`, new Blob([PNG], { type: "image/png" }), name);
      return fetch(`http://127.0.0.1:${port}/api/formularios/respostas`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    };
    const login = async (username, senha) => (await (await api("", "/auth/login", "POST", { username, senha })).json());
    const admin = (await login("admin", "admin123")).token;
    const pcm = (await login("pcm", "pcm123")).token;
    const fieldLogin = await login("campo", "campo123");
    const field = fieldLogin.token;

    // Modelo de exemplo criado pela migração, visível a todos os perfis.
    const allModels = await (await api(field, "/formularios/modelos")).json();
    assert.deepEqual(allModels.map((model) => model.tipo).sort(), ["Checklist", "Inspeção", "Permissão"]);
    const models = allModels.filter((model) => model.tipo === "Checklist");
    assert.ok(models[0].campos.some((campo) => campo.condicao));

    // Construtor No-Code: validações do modelo.
    const inspection = {
      nome: "Inspeção de bomba", tipo: "Inspeção", descricao: "Rota semanal",
      regras: { automatico: true, obrigatorio: true, tipos_om: ["Corretiva"], classes_equipamento: ["Estrutura"] },
      campos: [
        { id: "vibracao", rotulo: "Vibração", tipo: "numero", obrigatorio: true, unidade: "mm/s", limite_min: 0, limite_max: 4.5 },
        { id: "vazamento", rotulo: "Há vazamento?", tipo: "simnao", obrigatorio: true, esperado: "Não" },
        { id: "local", rotulo: "Local do vazamento", tipo: "texto", obrigatorio: true, condicao: { campo: "vazamento", valor: "Sim" } },
        { id: "estado", rotulo: "Estado geral", tipo: "selecao", obrigatorio: true, opcoes: ["Bom", "Regular", "Ruim"], opcoes_nc: ["Ruim"] },
        { id: "foto", rotulo: "Foto", tipo: "foto" },
        { id: "assinatura", rotulo: "Assinatura", tipo: "assinatura", obrigatorio: true },
      ],
    };
    const create = (token, body) => api(token, "/formularios/modelos", "POST", body);
    assert.equal((await create(pcm, inspection)).status, 403);
    assert.equal((await create(admin, { ...inspection, tipo: "Outro" })).status, 400);
    assert.equal((await create(admin, { ...inspection, campos: [] })).status, 400);
    assert.equal((await create(admin, { ...inspection, campos: [inspection.campos[0], inspection.campos[0]] })).status, 400);
    assert.equal((await create(admin, { ...inspection, campos: [{ id: "s", rotulo: "Seleção", tipo: "selecao", opcoes: [] }] })).status, 400);
    assert.equal((await create(admin, { ...inspection, campos: [inspection.campos[2], inspection.campos[1]] })).status, 400);
    assert.equal((await create(admin, { ...inspection, campos: [{ ...inspection.campos[0], limite_min: 9, limite_max: 1 }] })).status, 400);
    const created = await create(admin, inspection);
    assert.equal(created.status, 201);
    const modelId = (await created.json()).id;
    const updated = await api(admin, `/formularios/modelos/${modelId}`, "PUT", { ...inspection, descricao: "Rota semanal revisada" });
    assert.equal((await updated.json()).versao, 2);

    // Checklist inteligente: a regra (OM corretiva + classe Estrutura) aplica o modelo como obrigatório.
    const orders = await (await api(admin, "/ordens")).json();
    const order = orders.find((entry) => entry.numero === "40012352"); // ESTR-3330, Corretiva
    const other = orders.find((entry) => entry.numero === "40012346"); // Inspeção, bomba
    assert.equal((await api(pcm, `/ordens/${order.id}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);
    let forms = await (await api(field, `/formularios/ordem/${order.id}`)).json();
    const ruleForm = forms.find((form) => form.modelo_id === modelId);
    assert.equal(ruleForm.origem, "regra");
    assert.equal(ruleForm.obrigatorio, true);
    assert.ok(forms.some((form) => form.nome.includes("exemplo") && !form.obrigatorio));
    assert.ok(!(await (await api(admin, `/formularios/ordem/${other.id}`)).json()).some((form) => form.modelo_id === modelId));
    assert.equal((await api(field, `/formularios/ordem/${other.id}`)).status, 404);

    // Vínculo manual (PCM) torna o exemplo obrigatório nesta OM.
    const example = models[0];
    assert.equal((await api(field, `/formularios/ordem/${order.id}/vinculos`, "POST", { modelo_id: example.id, obrigatorio: true })).status, 403);
    forms = await (await api(pcm, `/formularios/ordem/${order.id}/vinculos`, "POST", { modelo_id: example.id, obrigatorio: true })).json();
    assert.equal(forms.find((form) => form.modelo_id === example.id).origem, "manual");

    // As três condições não encerram a OM enquanto houver checklist obrigatório pendente.
    assert.equal((await api(field, "/apontamentos", "POST", { ordem_id: order.id, tipo: "Apropriação", hh: 3 })).status, 201);
    assert.equal((await api(field, "/apontamentos", "POST", { ordem_id: order.id, tipo: "Validação", hh: 0 })).status, 201);
    assert.equal((await api(field, `/ordens/${order.id}/relatorio`, "PUT", { atividade_realizada: "Reparo." })).status, 200);
    let detail = await (await api(admin, `/ordens/${order.id}`)).json();
    assert.notEqual(detail.status, "Encerrada");
    assert.deepEqual(detail.condicoes.at(-1), { tipo: "Checklists", ok: false });

    // Respostas: obrigatórios, campo condicional, tipos e não conformidades.
    const answers = { vibracao: "6.2", vazamento: "Não", estado: "Ruim" };
    assert.equal((await submit(field, { modelo_id: modelId, ordem_id: order.id, respostas: answers })).status, 400); // falta assinatura
    assert.equal((await submit(field, { modelo_id: modelId, ordem_id: order.id, respostas: { ...answers, vazamento: "Sim" } }, { assinatura: "a.png" })).status, 400); // condicional obrigatório
    assert.equal((await submit(field, { modelo_id: modelId, ordem_id: order.id, respostas: { ...answers, vibracao: "abc" } }, { assinatura: "a.png" })).status, 400);
    assert.equal((await submit(field, { modelo_id: modelId, ordem_id: order.id, respostas: { ...answers, estado: "Péssimo" } }, { assinatura: "a.png" })).status, 400);
    assert.equal((await submit(field, { modelo_id: modelId, ordem_id: other.id, respostas: answers }, { assinatura: "a.png" })).status, 404);
    assert.equal((await submit(field, { modelo_id: modelId, respostas: answers }, { assinatura: "a.png" })).status, 400); // sem OM/ativo
    const response = await submit(field, { modelo_id: modelId, ordem_id: order.id, respostas: { ...answers, local: "ignorado: campo oculto" } }, { assinatura: "assinatura.png", foto: "bomba.png" });
    assert.equal(response.status, 201, await response.clone().text());
    const responseBody = await response.json();
    assert.deepEqual(responseBody.nao_conformidades.map((item) => item.campo), ["vibracao", "estado"]);
    assert.equal(responseBody.encerrada, false); // ainda falta o checklist de exemplo

    const example_answer = await submit(field, { modelo_id: example.id, ordem_id: order.id, respostas: { loto: "Sim", isolamento: "Sim", condicao_final: "Operando com restrição", restricao: "Limitar a 80% da vazão." } }, { assinatura: "a.png" });
    assert.equal(example_answer.status, 201);
    assert.equal((await example_answer.json()).encerrada, true);
    detail = await (await api(admin, `/ordens/${order.id}`)).json();
    assert.equal(detail.status, "Encerrada");
    assert.deepEqual(detail.condicoes.at(-1), { tipo: "Checklists", ok: true });
    assert.equal((await submit(field, { modelo_id: modelId, ordem_id: order.id, respostas: answers }, { assinatura: "a.png" })).status, 409);

    // Resposta vinculada só a um ativo (inspeção de rota), preenchida pelo PCM.
    const equipment = (await (await api(admin, "/cadastros")).json()).equipamentos.find((item) => item.tag === "TR01-BOMBA-02");
    const assetAnswer = await api(pcm, "/formularios/respostas", "POST", { modelo_id: example.id, equipamento_id: equipment.id, respostas: { loto: "Não", isolamento: "Sim", condicao_final: "Operando normalmente" } });
    assert.equal(assetAnswer.status, 400); // assinatura obrigatória
    const pcmAnswer = await submit(pcm, { modelo_id: example.id, equipamento_id: equipment.id, respostas: { loto: "Não", isolamento: "Sim", condicao_final: "Operando normalmente" } }, { assinatura: "a.png" });
    assert.equal(pcmAnswer.status, 201);
    const pcmAnswerId = (await pcmAnswer.json()).id;

    // Consulta: quem preencheu, quando, modelo congelado na versão e anexos.
    const saved = await (await api(admin, `/formularios/respostas/${responseBody.id}`)).json();
    assert.equal(saved.usuario_nome, "João Pereira");
    assert.equal(saved.ordem_numero, "40012352");
    assert.equal(saved.equipamento, "ESTR-3330");
    assert.equal(saved.modelo_versao, 2);
    assert.match(saved.criado_em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(saved.respostas.local, undefined);
    assert.equal(saved.respostas.vibracao, 6.2);
    assert.deepEqual(saved.anexos.map((item) => item.tipo).sort(), ["assinatura", "foto"]);
    const image = await api(admin, `/formularios/respostas/${responseBody.id}/anexos/${saved.anexos[0].id}`);
    assert.equal(image.headers.get("content-type"), "image/png");
    const mine = await (await api(field, "/formularios/respostas")).json();
    assert.equal(mine.length, 2);
    assert.equal((await api(field, `/formularios/respostas/${pcmAnswerId}`)).status, 404);
    assert.equal((await (await api(pcm, `/formularios/respostas?equipamento_id=${equipment.id}`)).json()).length, 1);

    // Editar o modelo não altera respostas antigas; excluir com respostas apenas desativa.
    await api(admin, `/formularios/modelos/${modelId}`, "PUT", { ...inspection, campos: inspection.campos.slice(0, 2) });
    assert.equal((await (await api(admin, `/formularios/respostas/${responseBody.id}`)).json()).campos.length, 6);
    assert.deepEqual(await (await api(admin, `/formularios/modelos/${modelId}`, "DELETE")).json(), { desativado: true });
    assert.ok(!(await (await api(field, "/formularios/modelos")).json()).some((model) => model.id === modelId));
    assert.ok((await (await api(admin, "/formularios/modelos?todos=1")).json()).some((model) => model.id === modelId && !model.ativo));
    const draft = await (await create(admin, { ...inspection, nome: "Rascunho" })).json();
    assert.deepEqual(await (await api(admin, `/formularios/modelos/${draft.id}`, "DELETE")).json(), { excluido: true });

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const actions = Object.fromEntries(db.prepare(`
        SELECT acao, COUNT(*) AS total FROM trilha_auditoria WHERE acao LIKE '%formulario%' GROUP BY acao
      `).all().map((row) => [row.acao, row.total]));
      assert.deepEqual(actions, {
        criar_modelo_formulario: 2, desativar_modelo_formulario: 1, editar_modelo_formulario: 2,
        excluir_modelo_formulario: 1, responder_formulario: 3, vincular_formulario_om: 1,
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
