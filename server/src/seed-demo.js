// Dados de demonstração. Executado uma única vez (marcador em schema_migrations) e, mesmo
// assim, cada item só é inserido se ainda não existir pela sua chave natural.
// Datas relativas ao dia da carga. Senha das contas de demonstração: demo123.
import bcrypt from "bcryptjs";
import { detectar } from "./ia.js";
import { addDays, todayLocal, weekStart } from "./iamot.js";
import { syncOrderSchedule } from "./planejamento.js";

export const DEMO_PASSWORD = "demo123";

export function seedDemo(db, { collaboratorSyncSql }) {
  const today = todayLocal();
  const day = (offset) => addDays(today, offset);
  const brDate = (offset) => day(offset).split("-").reverse().join("/");
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const ensure = (lookupSql, lookupParams, insertSql, insertParams) => {
    const found = get(lookupSql, ...lookupParams);
    if (found) return { id: found.id, novo: false };
    return { id: Number(run(insertSql, ...insertParams).lastInsertRowid), novo: true };
  };

  // ---------------------------------------------------------------- Equipes (5)
  const team = (nome, tipo, especialidade) => ensure("SELECT id FROM equipes WHERE nome = ?", [nome],
    "INSERT INTO equipes (nome, tipo, especialidade) VALUES (?, ?, ?)", [nome, tipo, especialidade]).id;
  const T = {
    eletrica: team("Elétrica Prev.", "Própria", "Elétrica Prev."),
    automacao: team("Automação", "Própria", "Automação"),
    mecanica: team("Mecânica FM", "Própria", "Mecânica FM"),
    caldeiraria: team("Caldeiraria", "Terceirizada", "Caldeiraria"),
    lubrificacao: team("Lubrificação", "Própria", "Lubrificação industrial"),
  };

  // ---------------------------------------------------------------- Usuários (colaboradores = usuários)
  let hash = null;
  const user = (username, nome, papel, equipeId, matricula) => {
    const found = get("SELECT id FROM usuarios WHERE username = ?", username);
    if (found) return found.id;
    hash ??= bcrypt.hashSync(DEMO_PASSWORD, 10);
    const email = get("SELECT 1 FROM usuarios WHERE email = ?", `${username}@empresa.com`) ? null : `${username}@empresa.com`;
    const id = Number(run("INSERT INTO usuarios (nome, email, username, senha_hash, papel, equipe_id) VALUES (?, ?, ?, ?, ?, ?)",
      nome, email, username, hash, papel, equipeId).lastInsertRowid);
    // Colaborador já cadastrado sem usuário (mesma matrícula) passa a ser esta pessoa.
    if (matricula) run("UPDATE colaboradores SET usuario_id = ?, equipe_id = ? WHERE matricula = ? AND usuario_id IS NULL", id, equipeId, matricula);
    return id;
  };
  const U = {
    marisa: user("marisa", "Marisa A. Rios", "EXECUTANTE", T.eletrica, "M-1001"),
    diego: user("diego", "Diego M. Rocha", "EXECUTANTE", T.eletrica),
    luiz: user("luiz", "Luiz F. Silva", "EXECUTANTE", T.automacao, "M-1003"),
    paulo: user("paulo", "Paulo R. Teixeira", "EXECUTANTE", T.mecanica),
    bruno: user("bruno", "Bruno C. Lima", "EXECUTANTE", T.caldeiraria),
    renata: user("renata", "Renata C. Souza", "EXECUTANTE", T.lubrificacao),
    fernanda: user("fernanda", "Fernanda Lopes", "PCM", T.mecanica),
  };
  db.exec(collaboratorSyncSql);
  const bridge = (userId) => get("SELECT MIN(id) AS id FROM colaboradores WHERE usuario_id = ?", userId).id;

  // ---------------------------------------------------------------- Equipamentos (~15 no total)
  const eq = (tag, descricao, localizacao, classe, criticidade) => ensure("SELECT id FROM equipamentos WHERE tag = ?", [tag],
    "INSERT INTO equipamentos (tag, descricao, localizacao, classe, criticidade) VALUES (?, ?, ?, ?, ?)",
    [tag, descricao, localizacao, classe, criticidade]).id;
  const E = {
    bomba1: eq("BOM-0101", "Bomba centrífuga de água de resfriamento", "Utilidades", "Bomba", "Alta"),
    bomba2: eq("BOM-0102", "Bomba dosadora de produtos químicos", "Utilidades", "Bomba", "Média"),
    britador: eq("MOT-0201", "Motor do britador primário", "Pátio A", "Motor", "Alta"),
    motorTc: eq("MOT-0202", "Motor da correia transportadora TC-03", "Pátio B", "Motor", "Média"),
    tc03: eq("CTR-0301", "Correia transportadora TC-03", "Pátio B", "Correia", "Alta"),
    tc05: eq("CTR-0302", "Correia transportadora TC-05", "Pátio B", "Correia", "Média"),
    ccm02: eq("PNL-0401", "Painel CCM-02 da sala elétrica", "Subestação", "Painel", "Alta"),
    clp01: eq("PNL-0402", "Painel de automação CLP-01", "Subestação", "Painel", "Média"),
    compressor: eq("COM-0501", "Compressor de ar parafuso 01", "Utilidades", "Compressor", "Alta"),
    nivel: eq("SEN-0601", "Sensor de nível do silo 2", "Pátio A", "Sensor", "Baixa"),
    pressao: eq("SEN-0602", "Transmissor de pressão PT-07", "Utilidades", "Sensor", "Média"),
  };

  // ---------------------------------------------------------------- Planos preventivos
  const plan = (equipamentoId, descricao, periodicidade, proxima, equipeId) => ensure(
    "SELECT id FROM planos_preventivos WHERE equipamento_id = ? AND descricao = ?", [equipamentoId, descricao],
    "INSERT INTO planos_preventivos (equipamento_id, descricao, periodicidade, proxima_data, equipe_id) VALUES (?, ?, ?, ?, ?)",
    [equipamentoId, descricao, periodicidade, proxima, equipeId]).id;
  const P = {
    lubBritador: plan(E.britador, "Lubrificação dos mancais do britador", "Mensal", day(3), T.lubrificacao),
    termografia: plan(E.ccm02, "Inspeção termográfica do CCM-02", "Trimestral", day(-2), T.eletrica),
    oleoCompressor: plan(E.compressor, "Troca de óleo e filtros do compressor", "500 horas", day(20), T.mecanica),
    calibracao: plan(E.pressao, "Calibração do transmissor PT-07", "Semestral", day(45), T.automacao),
    correia: plan(E.tc03, "Inspeção de roletes e emendas da TC-03", "Mensal", day(10), T.mecanica),
  };

  // ---------------------------------------------------------------- Ordens em todos os estados
  const order = (o) => {
    const created = ensure("SELECT id FROM ordens WHERE numero = ?", [o.numero], `
      INSERT INTO ordens (numero, tipo, status, equipamento_id, equipe_id, hh_previsto, data_programada, data_fim_programada,
                          responsavel_id, plano_id, data_encerramento, exige_pt, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `, [o.numero, o.tipo, o.status, o.eq, o.equipe, o.hh, o.prog ?? null, o.fim ?? null, o.resp ?? null, o.plano ?? null,
      o.encerramento ?? null, o.exigePt ? 1 : 0, `-${o.criado} days`]);
    return created;
  };
  const apontar = (ordemId, usuarioId, tipo, hh, descricao, data) => Number(run(
    "INSERT INTO apontamentos (ordem_id, usuario_id, tipo, hh_apropriado, descricao, data) VALUES (?, ?, ?, ?, ?, ?)",
    ordemId, usuarioId, tipo, hh, descricao, data).lastInsertRowid);

  // OM encerrada: apropriação (com detecção da IA), relatório com parada/reparo e validação.
  const closed = (o, { by, hh, downtime, repair, atividade, materiais }) => {
    const created = order({ ...o, status: "Encerrada", resp: by, encerramento: brDate(-o.fechada) });
    if (!created.novo) return created.id;
    const when = `${day(-o.fechada)} 16:30:00`;
    const apontamentoId = apontar(created.id, by, "Apropriação", hh, null, when);
    apontar(created.id, by, "Relatório", 0, atividade, when);
    apontar(created.id, by, "Validação", 0, null, when);
    run(`INSERT INTO relatorios_execucao (ordem_id, usuario_id, atividade_realizada, resultado, materiais_utilizados, observacoes,
         indisponibilidade_horas, tempo_reparo_horas, atualizado_em) VALUES (?, ?, ?, 'Concluído', ?, NULL, ?, ?, ?)`,
    created.id, by, atividade, materiais ?? null, downtime, repair, when);
    const flag = detectar(hh, o.hh);
    if (flag) {
      run(`INSERT INTO sinalizacoes_ia (entidade_tipo, entidade_id, ordem_numero, campo, valor_atual, valor_sugerido, tipo, score, explicacao, status, criado_em)
           VALUES ('apontamento', ?, ?, 'HH apropriado', ?, ?, ?, ?, ?, 'Nova', ?)`,
      apontamentoId, o.numero, hh, flag.sugerido, flag.tipo, flag.score, JSON.stringify(flag.fatores), when);
    }
    return created.id;
  };

  closed({ numero: "40020001", tipo: "Corretiva", eq: E.britador, equipe: T.mecanica, hh: 6, criado: 150, fechada: 147 },
    { by: U.paulo, hh: 7, downtime: 5, repair: 4, atividade: "Substituição do acoplamento elástico do motor do britador.", materiais: "1 acoplamento elástico" });
  closed({ numero: "40020002", tipo: "Preventiva", eq: E.compressor, equipe: T.mecanica, hh: 4, criado: 120, fechada: 118, plano: P.oleoCompressor },
    { by: U.paulo, hh: 4, downtime: 2, repair: 2, atividade: "Troca de óleo, filtro de ar e filtro separador.", materiais: "20 L de óleo, 2 filtros" });
  closed({ numero: "40020003", tipo: "Corretiva", eq: E.ccm02, equipe: T.eletrica, hh: 8, criado: 95, fechada: 92 },
    { by: U.diego, hh: 22, downtime: 12, repair: 6, atividade: "Reaperto de barramentos e troca de contator queimado do CCM-02.", materiais: "1 contator 95 A" });
  closed({ numero: "40020004", tipo: "Corretiva", eq: E.tc03, equipe: T.mecanica, hh: 10, criado: 60, fechada: 25 },
    { by: U.paulo, hh: 11, downtime: 8, repair: 7, atividade: "Troca de 6 roletes de carga e alinhamento da TC-03.", materiais: "6 roletes" });
  closed({ numero: "40020005", tipo: "Inspeção", eq: E.pressao, equipe: T.automacao, hh: 2, criado: 30, fechada: 18 },
    { by: U.luiz, hh: 2, downtime: 0, repair: null, atividade: "Inspeção e teste de malha do transmissor PT-07." });
  closed({ numero: "40020006", tipo: "Corretiva", eq: E.bomba1, equipe: T.mecanica, hh: 3, criado: 12, fechada: 10 },
    { by: U.paulo, hh: 3.5, downtime: 3, repair: 2.5, atividade: "Troca do selo mecânico da bomba de resfriamento.", materiais: "1 selo mecânico" });
  closed({ numero: "40020017", tipo: "Preventiva", eq: E.motorTc, equipe: T.lubrificacao, hh: 2, criado: 9, fechada: 6 },
    { by: U.renata, hh: 6, downtime: 1, repair: null, atividade: "Lubrificação dos mancais do motor da TC-03." });
  closed({ numero: "40020018", tipo: "Preventiva", eq: E.bomba2, equipe: T.caldeiraria, hh: 3, criado: 5, fechada: 2 },
    { by: U.bruno, hh: 14, downtime: 2, repair: null, atividade: "Inspeção estrutural da base da bomba dosadora." });

  // Em execução (cronômetro em andamento).
  const running = (o, by, nomes, intercorrencia) => {
    const created = order({ ...o, status: "Em execução", resp: by });
    if (!created.novo) return created.id;
    const execucao = Number(run("INSERT INTO execucoes_om (ordem_id, usuario_id, num_executantes, iniciado_em) VALUES (?, ?, ?, datetime('now', ?))",
      created.id, by, nomes.length, o.iniciadoHa).lastInsertRowid);
    nomes.forEach((nome) => run("INSERT INTO execucao_executantes (execucao_id, nome) VALUES (?, ?)", execucao, nome));
    if (intercorrencia) {
      run("INSERT INTO intercorrencias_om (ordem_id, execucao_id, usuario_id, tipo, descricao, registrado_em) VALUES (?, ?, ?, ?, ?, datetime('now', '-40 minutes'))",
        created.id, execucao, by, intercorrencia.tipo, intercorrencia.descricao);
    }
    return created.id;
  };
  const O = {};
  O.r1 = running({ numero: "40020007", tipo: "Corretiva", eq: E.motorTc, equipe: T.eletrica, hh: 5, criado: 3, prog: day(-1), iniciadoHa: "-2 hours" },
    U.diego, ["Diego M. Rocha", "Marisa A. Rios"], { tipo: "Alteração de serviço", descricao: "Encontrado rolamento travado; incluída a troca do rolamento LOA." });
  O.r2 = running({ numero: "40020008", tipo: "Preventiva", eq: E.tc05, equipe: T.lubrificacao, hh: 3, criado: 2, prog: day(0), iniciadoHa: "-1 hours" },
    U.renata, ["Renata C. Souza"]);

  // Distribuídas, programadas, abertas e cancelada.
  O.d1 = order({ numero: "40020009", tipo: "Preventiva", status: "Distribuída", eq: E.bomba2, equipe: T.mecanica, hh: 3, criado: 4, prog: day(1), resp: U.paulo }).id;
  O.d2 = order({ numero: "40020010", tipo: "Corretiva", status: "Distribuída", eq: E.clp01, equipe: T.automacao, hh: 4, criado: 6, prog: day(-2), resp: U.luiz }).id; // atrasada
  O.p1 = order({ numero: "40020011", tipo: "Preventiva", status: "Programada", eq: E.nivel, equipe: T.automacao, hh: 2, criado: 3, prog: day(2), plano: P.calibracao }).id;
  O.p2 = order({ numero: "40020012", tipo: "Corretiva", status: "Programada", eq: E.compressor, equipe: T.mecanica, hh: 6, criado: 2, prog: day(3), exigePt: true }).id;
  O.a1 = order({ numero: "40020013", tipo: "Corretiva", status: "Aberta", eq: E.bomba1, equipe: T.mecanica, hh: 4, criado: 1 }).id;
  O.a2 = order({ numero: "40020014", tipo: "Corretiva", status: "Aberta", eq: E.britador, equipe: T.eletrica, hh: 3, criado: 1 }).id;
  O.a3 = order({ numero: "40020015", tipo: "Inspeção", status: "Aberta", eq: E.ccm02, equipe: T.eletrica, hh: 2, criado: 0 }).id;
  order({ numero: "40020016", tipo: "Preventiva", status: "Cancelada", eq: E.tc05, equipe: T.lubrificacao, hh: 2, criado: 20 });

  // ---------------------------------------------------------------- Notas
  const note = (numero, equipamentoId, descricao, tipo, status, solicitante, ordemId) => {
    const created = ensure("SELECT id FROM notas WHERE numero = ?", [numero],
      "INSERT INTO notas (numero, equipamento_id, descricao, tipo, status, solicitante_id) VALUES (?, ?, ?, ?, ?, ?)",
      [numero, equipamentoId, descricao, tipo, status, solicitante]);
    if (created.novo && ordemId) run("UPDATE ordens SET nota_id = ? WHERE id = ? AND nota_id IS NULL", created.id, ordemId);
  };
  note("14301", E.bomba2, "Ruído intermitente na bomba dosadora", "Corretiva", "Aberta", U.paulo);
  note("14302", E.nivel, "Leitura instável no sensor de nível do silo 2", "Corretiva", "Aberta", U.luiz);
  note("14303", E.bomba1, "Vazamento pelo selo da bomba de resfriamento", "Corretiva", "Em OM", U.paulo, O.a1);
  note("14304", E.britador, "Aquecimento no motor do britador", "Corretiva", "Em OM", U.diego, O.a2);
  note("14305", E.ccm02, "Ponto quente identificado na inspeção visual do CCM-02", "Inspeção", "Em OM", U.marisa, O.a3);

  // ---------------------------------------------------------------- Planejamento da semana
  const allocate = (ordemId, equipeId, data, hh) => {
    if (get("SELECT 1 FROM programacao_atividades WHERE ordem_id = ? AND equipe_id = ? AND data = ?", ordemId, equipeId, data)) return;
    run("INSERT INTO programacao_atividades (ordem_id, equipe_id, data, hh_previsto, criado_por) VALUES (?, ?, ?, ?, ?)", ordemId, equipeId, data, hh, U.fernanda);
    syncOrderSchedule(db, ordemId);
  };
  allocate(O.r1, T.eletrica, day(-1), 5);
  allocate(O.r2, T.lubrificacao, day(0), 3);
  allocate(O.d1, T.mecanica, day(1), 3);
  allocate(O.d2, T.automacao, day(-2), 4);
  allocate(O.p1, T.automacao, day(2), 2);
  allocate(O.p2, T.mecanica, day(3), 6);

  // ---------------------------------------------------------------- HH disponível e ocorrências
  const current = weekStart(today);
  for (const semana of [addDays(current, -14), addDays(current, -7), current]) {
    for (const equipeId of Object.values(T)) {
      const pessoas = get("SELECT COUNT(*) AS total FROM usuarios WHERE equipe_id = ? AND ativo = 1 AND papel = 'EXECUTANTE'", equipeId).total;
      run("INSERT OR IGNORE INTO hh_disponivel (equipe_id, semana_inicio, hh_disponivel, registrado_por) VALUES (?, ?, ?, ?)",
        equipeId, semana, Math.max(1, pessoas) * 40, U.fernanda);
    }
  }
  const occurrence = (userId, tipo, inicio, fim, observacao) => {
    const colaborador = bridge(userId);
    if (!colaborador || get("SELECT 1 FROM ocorrencias_hh WHERE colaborador_id = ? AND tipo = ? AND data_inicio = ?", colaborador, tipo, inicio)) return;
    run("INSERT INTO ocorrencias_hh (colaborador_id, tipo, data_inicio, data_fim, horas_dia, observacao, registrado_por, criado_em) VALUES (?, ?, ?, ?, 8, ?, ?, datetime('now'))",
      colaborador, tipo, inicio, fim, observacao, userId);
  };
  occurrence(U.paulo, "Folga", day(0), day(0), "Banco de horas");
  occurrence(U.diego, "Férias", addDays(current, 7), addDays(current, 11), null);

  // ---------------------------------------------------------------- Permissão de trabalho pendente
  const permitModel = get("SELECT * FROM formularios_modelos WHERE nome = 'APR / Permissão de Trabalho (exemplo)'");
  if (permitModel && !get("SELECT 1 FROM permissoes_trabalho WHERE numero = 'PT-90001'")) {
    const respostas = { atividade: "Troca do separador ar/óleo do compressor 01", altura: "Não", quente: "Sim", extintor: "Sim", confinado: "Não", loto: "Sim", epi: "Não", medidas: "Área isolada, vigia de fogo e extintor de CO2 posicionado." };
    const ncs = [{ campo: "epi", rotulo: "EPIs necessários disponíveis e em bom estado?", valor: "Não", motivo: "Esperado: Sim" }];
    const resposta = Number(run(`INSERT INTO formularios_respostas (modelo_id, modelo_versao, modelo_nome, modelo_tipo, campos, ordem_id, equipamento_id, respostas, nao_conformidades, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, permitModel.id, permitModel.versao, permitModel.nome, permitModel.tipo, permitModel.campos,
    O.p2, E.compressor, JSON.stringify(respostas), JSON.stringify(ncs), U.paulo).lastInsertRowid);
    run(`INSERT INTO permissoes_trabalho (numero, ordem_id, modelo_id, resposta_id, validade_inicio, validade_fim, solicitante_id)
      VALUES ('PT-90001', ?, ?, ?, ?, ?, ?)`, O.p2, permitModel.id, resposta, `${day(3)}T07:00`, `${day(3)}T17:00`, U.paulo);
  }

  // ---------------------------------------------------------------- Rota de inspeção e passagem de turno
  const inspection = get("SELECT id FROM formularios_modelos WHERE nome = 'Inspeção sensitiva de equipamento (exemplo)'");
  if (inspection && !get("SELECT 1 FROM rotas_inspecao WHERE nome = 'Rota de utilidades (demo)'")) {
    const rota = Number(run("INSERT INTO rotas_inspecao (nome, descricao, area, criado_por, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      "Rota de utilidades (demo)", "Ronda diária das bombas, compressor e instrumentos de utilidades.", "Utilidades", U.fernanda, U.fernanda).lastInsertRowid);
    [[E.bomba1, "Medir vibração no mancal do lado acoplado."], [E.bomba2, null], [E.compressor, "Conferir temperatura de descarga no painel local."], [E.pressao, null]]
      .forEach(([equipamento, instrucao], index) => run("INSERT INTO rota_pontos (rota_id, sequencia, equipamento_id, modelo_id, instrucao) VALUES (?, ?, ?, ?, ?)",
        rota, index + 1, equipamento, inspection.id, instrucao));
  }
  if (!get("SELECT 1 FROM passagens_turno WHERE data = ? AND turno = 'Noite' AND autor_id = ?", day(-1), U.diego)) {
    run(`INSERT INTO passagens_turno (data, turno, equipe_id, autor_id, ocorrencias, feito, pendencias, avisos) VALUES (?, 'Noite', ?, ?, ?, ?, ?, ?)`,
      day(-1), T.eletrica, U.diego, "Desarme do motor da TC-03 às 02h10.", "Rearme e teste do motor; OM 40020007 aberta para troca do rolamento.",
      "Trocar rolamento LOA do motor da TC-03.", "Motor da TC-03 liberado só em vazio até a troca do rolamento.");
  }
}
