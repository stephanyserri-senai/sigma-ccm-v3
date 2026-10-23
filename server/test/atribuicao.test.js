import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { priorityFromAsset } from "../src/atribuicao.js";
import { startPostgres } from "./helpers/postgres.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const addDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

test("Prioridade da nota vem da criticidade do ativo e do risco iminente", () => {
  assert.equal(priorityFromAsset({ criticidade: "Alta" }).prioridade, "ALTO");
  assert.equal(priorityFromAsset({ criticidade: "Média" }).prioridade, "MEDIO");
  assert.equal(priorityFromAsset({ criticidade: "Baixa" }).prioridade, "BAIXO");
  assert.equal(priorityFromAsset({}).prioridade, "MEDIO");
  assert.equal(priorityFromAsset({ criticidade: "Baixa", riscoIminente: true }).prioridade, "IMEDIATO");
});

function waitForApi(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`API startup timed out:\n${output}`)), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("SIGMA-CCM API em")) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`API saiu com código ${code}:\n${output}`)); });
  });
}

test("Nota gera OM atribuída à equipe do ativo; executante aceita, recusa e a semana é reclassificada", async () => {
  const pg = await startPostgres({ SIGMA_DEMO: "0" });
  const port = 31493;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, ...pg.env, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "assignment-test-secret" },
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
    const teamId = async (nome) => (await pg.query("SELECT id FROM equipes WHERE nome = $1", [nome]))[0].id;
    const mecanica = await teamId("Mecânica FM");
    const eletrica = await teamId("Elétrica Prev.");
    for (const [username, nome, equipe] of [["mec1", "Marcos Mecânico", mecanica], ["ele1", "Elisa Eletricista", eletrica]]) {
      const created = await api(admin, "/usuarios", "POST", { nome, username, senha: "senha123", papel: "EXECUTANTE", equipe_id: equipe });
      assert.equal(created.status, 201);
    }
    const mec = await login("mec1", "senha123");
    const ele = await login("ele1", "senha123");
    const campo = await login("campo", "campo123");
    const tokens = { [mec.user.id]: mec.token, [ele.user.id]: ele.token, [campo.user.id]: campo.token };
    const motor = (await pg.query("SELECT id FROM equipamentos WHERE tag = 'PA-2200-MOT'"))[0].id;
    await pg.query("UPDATE equipamentos SET equipe_id = $1 WHERE id = $2", [mecanica, motor]);

    // 1. A nota vira OM priorizada, programada e entregue à equipe responsável pelo ativo.
    const created = await api(campo.token, "/notas", "POST", { equipamento_id: motor, descricao: "Ruído no motor de acionamento" });
    assert.equal(created.status, 201);
    const { ordem } = await created.json();
    assert.equal(ordem.prioridade, "MEDIO");
    assert.equal(ordem.executante.id, mec.user.id);
    assert.equal(ordem.da_equipe_do_ativo, true);
    assert.ok(ordem.data_programada >= today && ordem.data_programada <= addDays(today, 14));
    const [row] = await pg.query("SELECT status, responsavel_id, aceita_em, equipe_id FROM ordens WHERE id = $1", [ordem.id]);
    assert.deepEqual([row.status, row.responsavel_id, row.aceita_em, row.equipe_id], ["Distribuída", mec.user.id, null, mecanica]);
    assert.equal((await pg.query("SELECT status FROM notas WHERE id = (SELECT nota_id FROM ordens WHERE id = $1)", [ordem.id]))[0].status, "Em OM");
    assert.equal((await pg.query("SELECT COUNT(*) AS n FROM programacao_atividades WHERE ordem_id = $1", [ordem.id]))[0].n, 1);

    // Aguardando aceite: aparece no Início, mas ainda fora do plano semanal.
    const resumo = await (await api(mec.token, "/campo/resumo")).json();
    assert.equal(resumo.ordens.find((item) => item.id === ordem.id).aguardando_aceite, true);
    assert.ok(!resumo.semana.dias.some((day) => day.ordens.includes(ordem.id)));
    const aviso = await pg.query("SELECT status FROM notificacoes WHERE chave = $1", [`om_atribuida:${ordem.id}:${mec.user.id}`]);
    assert.equal(aviso[0].status, "Aberta");

    // 2. Recusa: outro executante recebe a OM; quem recusou não a recebe de volta.
    assert.equal((await api(ele.token, `/ordens/${ordem.id}/recusar`, "POST", { motivo: "Não é minha" })).status, 404);
    assert.equal((await api(mec.token, `/ordens/${ordem.id}/recusar`, "POST", { motivo: "" })).status, 400);
    const refused = await api(mec.token, `/ordens/${ordem.id}/recusar`, "POST", { motivo: "Sem disponibilidade nesta semana" });
    assert.equal(refused.status, 200);
    assert.ok((await refused.json()).redistribuida_para);
    const novo = (await pg.query("SELECT responsavel_id FROM ordens WHERE id = $1", [ordem.id]))[0].responsavel_id;
    assert.notEqual(novo, mec.user.id);
    assert.equal((await pg.query("SELECT status FROM notificacoes WHERE chave = $1", [`om_atribuida:${ordem.id}:${mec.user.id}`]))[0].status, "Resolvida");
    const detail = await (await api(pcm, `/ordens/${ordem.id}`)).json();
    assert.equal(detail.recusas.length, 1);

    // 3. Aceite: a OM entra no plano liberada para execução.
    assert.equal((await api(tokens[novo], `/ordens/${ordem.id}/aceitar`, "POST", {})).status, 200);
    assert.equal((await api(tokens[novo], `/ordens/${ordem.id}/aceitar`, "POST", {})).status, 409);
    const [aceita] = await pg.query("SELECT status, aceita_em FROM ordens WHERE id = $1", [ordem.id]);
    assert.equal(aceita.status, "Liberada para execução");
    assert.ok(aceita.aceita_em);
    const depois = await (await api(tokens[novo], "/campo/resumo")).json();
    assert.equal(depois.ordens.find((item) => item.id === ordem.id).aguardando_aceite, false);

    // 4. Sem agenda hoje para ninguém: a OM Imediato toma o lugar de uma OM de prioridade baixa
    // da equipe do ativo, que passa para outro dia.
    let numero = 50000000;
    for (const user of [mec, ele, campo]) {
      await pg.query(`INSERT INTO ordens (numero, tipo, status, equipamento_id, equipe_id, hh_previsto, data_programada, responsavel_id, prioridade, prioridade_nivel, aceita_em)
        VALUES ($1, 'Corretiva', 'Liberada para execução', $2, $3, 8, $4, $5, 'BAIXO', 5, '2026-01-01 00:00:00')`,
      [String(numero += 1), motor, mecanica, today, user.user.id]);
    }
    const baixa = (await pg.query("SELECT id FROM ordens WHERE numero = '50000001'"))[0].id;
    const urgent = await api(pcm, "/notas", "POST", { equipamento_id: motor, descricao: "Motor parou", risco_iminente: true });
    assert.equal(urgent.status, 201);
    const imediata = (await urgent.json()).ordem;
    assert.equal(imediata.prioridade, "IMEDIATO");
    assert.equal(imediata.executante.id, mec.user.id);
    assert.equal(imediata.data_programada, today);
    assert.equal(imediata.reclassificadas.length, 1);
    assert.equal(imediata.reclassificadas[0].numero, "50000001");
    const movida = (await pg.query("SELECT data_programada FROM ordens WHERE id = $1", [baixa]))[0].data_programada;
    assert.ok(movida > today);
    const reprogramacao = await pg.query("SELECT justificativa FROM historico_reprogramacao_ordem WHERE ordem_id = $1", [baixa]);
    assert.match(reprogramacao[0].justificativa, /Reclassificação automática/);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await pg.close();
  }
});
