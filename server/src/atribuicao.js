// Atribuição automática da OM gerada pela nota: prioridade pelo ativo, executante de preferência
// da equipe responsável pelo ativo, dia dentro do prazo da prioridade e, se ninguém tiver agenda,
// reclassificação da semana (OMs de prioridade menor ainda não iniciadas cedem o lugar).
// Todas as funções que gravam devem ser chamadas dentro de uma transação.
import {
  equipamentosRepo, equipesRepo, notificacoesRepo, ocorrenciasRepo, ordensRepo, programacaoRepo, usuariosRepo,
} from "./data/index.js";
import { addDays, dataBr, parseIsoDate, todayLocal } from "./iamot.js";
import { getParameters } from "./parametros.js";
import { calculatePriority, priorityLabel } from "./priorizacao.js";

const HORIZONTE_DIAS = 60;
// OMs que ainda podem mudar de dia para abrir espaço a uma OM mais prioritária.
const REPROGRAMAVEIS = new Set(["Programada", "Distribuída", "Liberada para execução"]);
const SEVERIDADE = { 1: "Crítica", 2: "Alta", 3: "Alta", 4: "Média" };

const isWorkday = (iso) => { const day = parseIsoDate(iso).getUTCDay(); return day >= 1 && day <= 5; };
// Sem nível (OM antiga, não priorizada) conta como a menor prioridade.
const nivelDe = (order) => order.prioridade_nivel ?? 99;

// Prioridade da nota pelo fluxo de decisão existente, a partir da criticidade do ativo e de uma
// única pergunta: o equipamento parou ou há risco iminente?
export function priorityFromAsset({ criticidade, riscoIminente }) {
  return calculatePriority({
    afeta_seguranca_ambiente: criticidade === "Alta",
    afeta_custos: false,
    afeta_producao_qualidade: criticidade !== "Alta" && criticidade !== "Baixa",
    possui_reserva: criticidade === "Baixa",
    risco_iminente: Boolean(riscoIminente),
    equipamento_monitorado: true,
    recursos_disponiveis: true,
    necessita_parada_programada: false,
  });
}

// Agenda de um executante: capacidade e HH já programado por dia.
function agenda(usuario, ordens, ausencias, jornada, hoje, urgente) {
  const porDia = new Map();
  for (const order of ordens) {
    if (!porDia.has(order.data_programada)) porDia.set(order.data_programada, []);
    porDia.get(order.data_programada).push(order);
  }
  const capacidade = (data) => {
    // Emergência (Imediato) é atendida hoje mesmo fora de dia útil.
    if (!isWorkday(data) && !(urgente && data === hoje)) return 0;
    const ausente = ausencias.filter((item) => item.usuario_id === usuario.id && item.data_inicio <= data && item.data_fim >= data)
      .reduce((sum, item) => sum + item.horas_dia, 0);
    return Math.max(0, jornada - ausente);
  };
  const usado = (data, ignorar = new Set()) => (porDia.get(data) || [])
    .filter((order) => !ignorar.has(order.id)).reduce((sum, order) => sum + order.hh_previsto, 0);
  // Cabe se sobra capacidade no dia; uma OM maior que a jornada cabe sozinha num dia livre.
  const cabe = (data, hh, ignorar) => {
    const cap = capacidade(data);
    if (cap <= 0) return false;
    const ocupado = usado(data, ignorar);
    return ocupado + hh <= cap + 1e-9 || ocupado === 0;
  };
  const primeiroDia = (de, ate, hh, ignorar) => {
    for (let data = de; data <= ate; data = addDays(data, 1)) if (cabe(data, hh, ignorar)) return data;
    return null;
  };
  const carga = (de, ate) => ordens.filter((order) => order.data_programada >= de && order.data_programada <= ate)
    .reduce((sum, order) => sum + order.hh_previsto, 0);
  return { usuario, porDia, cabe, primeiroDia, carga };
}

// Escolhe executante e dia para a OM, sem gravar nada.
export async function planAssignment(order, { excluir = [] } = {}) {
  const hoje = todayLocal();
  const limiteHorizonte = addDays(hoje, HORIZONTE_DIAS);
  const urgente = order.prioridade_nivel === 1;
  const prazo = order.prazo_dias == null ? limiteHorizonte : addDays(hoje, Math.max(0, order.prazo_dias));
  const hh = order.hh_previsto || 4;
  const params = await getParameters();
  const jornada = params.hh_semana_pessoa / 5;

  const ativo = order.equipamento_id ? await equipamentosRepo.findForAssignment(order.equipamento_id) : null;
  const equipePreferida = ativo?.equipe_id ?? null;
  const fora = new Set(excluir);
  const candidatos = (await usuariosRepo.listExecutantesWithTeam()).filter((user) => !fora.has(user.id));
  const base = { equipe_preferida_id: equipePreferida, prazo, hh };
  if (!candidatos.length) return { ...base, executante: null };

  const fim = addDays(limiteHorizonte, 1);
  const ausencias = await ocorrenciasRepo.listByUserInRange(hoje, fim);
  const agendas = [];
  for (const user of candidatos) {
    // A própria OM (redistribuição) não conta como carga de quem já a tinha.
    const ordens = (await ordensRepo.listWorkloadOf(user.id, hoje, fim)).filter((item) => item.id !== order.id);
    agendas.push(agenda(user, ordens, ausencias, jornada, hoje, urgente));
  }
  const daEquipe = agendas.filter((item) => equipePreferida && item.usuario.equipe_id === equipePreferida);
  const outras = agendas.filter((item) => !daEquipe.includes(item));
  const preferidos = daEquipe.length ? daEquipe : agendas;

  // 1. Quem tem agenda dentro do prazo: primeiro a equipe do ativo, depois as demais.
  for (const grupo of [daEquipe, outras]) {
    const opcoes = grupo.map((item) => ({ item, data: item.primeiroDia(hoje, prazo, hh) })).filter((option) => option.data)
      .sort((a, b) => a.data.localeCompare(b.data) || a.item.carga(hoje, prazo) - b.item.carga(hoje, prazo) || a.item.usuario.id - b.item.usuario.id);
    if (opcoes.length) return { ...base, executante: opcoes[0].item.usuario, data: opcoes[0].data, fora_do_prazo: false, reclassificadas: [] };
  }

  // 2. Reclassificação: no primeiro dia possível, OMs de prioridade menor ainda não iniciadas cedem o lugar.
  const nivel = order.prioridade_nivel ?? 99;
  for (let data = hoje; data <= prazo; data = addDays(data, 1)) {
    let melhor = null;
    for (const item of preferidos) {
      const cedem = (item.porDia.get(data) || [])
        .filter((other) => nivelDe(other) > nivel && !other.iniciada && REPROGRAMAVEIS.has(other.status))
        .sort((a, b) => nivelDe(b) - nivelDe(a) || b.id - a.id);
      const ignorar = new Set();
      for (const other of cedem) {
        if (item.cabe(data, hh, ignorar)) break;
        ignorar.add(other.id);
      }
      if (!ignorar.size || !item.cabe(data, hh, ignorar)) continue;
      if (!melhor || ignorar.size < melhor.ignorar.size) melhor = { item, ignorar };
    }
    if (melhor) {
      // As OMs deslocadas vão para o próximo dia livre do mesmo executante.
      const ocupados = new Map([[data, hh]]);
      const reclassificadas = [];
      for (const other of (melhor.item.porDia.get(data) || []).filter((entry) => melhor.ignorar.has(entry.id))) {
        let novo = addDays(data, 1);
        while (novo <= limiteHorizonte && !(melhor.item.cabe(novo, other.hh_previsto + (ocupados.get(novo) || 0)))) novo = addDays(novo, 1);
        if (novo > limiteHorizonte) novo = limiteHorizonte;
        ocupados.set(novo, (ocupados.get(novo) || 0) + other.hh_previsto);
        reclassificadas.push({ id: other.id, numero: other.numero, de: data, para: novo });
      }
      return { ...base, executante: melhor.item.usuario, data, fora_do_prazo: false, reclassificadas };
    }
  }

  // 3. Sem espaço nem reclassificando: primeiro dia livre depois do prazo, na equipe do ativo.
  const opcoes = preferidos.map((item) => ({ item, data: item.primeiroDia(hoje, limiteHorizonte, hh) })).filter((option) => option.data)
    .sort((a, b) => a.data.localeCompare(b.data) || a.item.usuario.id - b.item.usuario.id);
  if (opcoes.length) return { ...base, executante: opcoes[0].item.usuario, data: opcoes[0].data, fora_do_prazo: true, reclassificadas: [] };
  return { ...base, executante: null };
}

// Programa a OM em um único dia, mantendo a programação semanal da equipe coerente.
async function programar(order, { data, equipeId, usuarioId, justificativa }) {
  await programacaoRepo.removeByOrder(order.id);
  await programacaoRepo.create({ ordemId: order.id, equipeId, data, hh: order.hh_previsto, observacao: justificativa, usuarioId });
  await programacaoRepo.syncOrderSchedule(order.id);
  if (order.data_programada && order.data_programada !== data) {
    await ordensRepo.saveReschedule(order.id, { inicio: order.data_programada, fim: order.data_fim_programada || null },
      { inicio: data, fim: null }, justificativa, usuarioId);
  }
}

// Planeja e grava: programação, executante (aguardando aceite), OMs reclassificadas e avisos.
export async function assignOrder(ordemId, { usuarioId, excluir = [], audit }) {
  const order = await ordensRepo.findById(ordemId);
  const plano = await planAssignment(order, { excluir });
  const label = priorityLabel(order.prioridade) || "sem prioridade";

  if (!plano.executante) {
    if (order.responsavel_id) await ordensRepo.unassign(order.id);
    await notificacoesRepo.upsertEvent({
      chave: `om_sem_executante:${order.id}:${Date.now()}`, tipo: "OM sem executante", severidade: SEVERIDADE[order.prioridade_nivel] || "Média",
      titulo: `OM ${order.numero} sem executante disponível`,
      mensagem: `Prioridade ${label}. Nenhum executante ativo pôde receber a OM; distribua manualmente.`,
      entidade: "ordem", entidade_id: order.id, link: "/ordens", usuario_id: null,
    }, "CCM,PCM");
    await audit(usuarioId, "atribuir_ordem_automatica", "ordem", order.id, "Sem executante disponível");
    return { executante: null };
  }

  for (const moved of plano.reclassificadas) {
    const other = await ordensRepo.findById(moved.id);
    await programar(other, {
      data: moved.para, equipeId: other.equipe_id || plano.executante.equipe_id || plano.equipe_preferida_id || (await equipesRepo.findFirst())?.id,
      usuarioId, justificativa: `Reclassificação automática: cedeu o dia para a OM ${order.numero} (${label}).`,
    });
    await notificacoesRepo.upsertEvent({
      chave: `om_reprogramada:${other.id}:${moved.para}`, tipo: "OM reprogramada", severidade: "Média",
      titulo: `OM ${other.numero} passou para ${dataBr(moved.para)}`,
      mensagem: `A OM ${order.numero} (${label}) entrou no seu plano em ${dataBr(moved.de)}.`,
      entidade: "ordem", entidade_id: other.id, link: "/meu-plano", usuario_id: plano.executante.id,
    }, "");
    await audit(usuarioId, "reclassificar_ordem_automatica", "ordem", other.id, `OM ${other.numero}: ${moved.de} → ${moved.para}`);
  }

  const equipeId = plano.executante.equipe_id || plano.equipe_preferida_id || order.equipe_id || (await equipesRepo.findFirst())?.id;
  await programar(order, {
    data: plano.data, equipeId, usuarioId,
    justificativa: `Programação automática (${label}${plano.fora_do_prazo ? ", fora do prazo por falta de agenda" : ""}).`,
  });
  const anterior = (await ordensRepo.findSummary(order.id)).status;
  await ordensRepo.assignTo(order.id, plano.executante.id);
  await ordensRepo.recordStatusChange(order.id, anterior, "Distribuída", "atribuir_ordem_automatica",
    `Atribuída a ${plano.executante.nome} para ${dataBr(plano.data)}; aguardando aceite.`, usuarioId);
  await notificacoesRepo.upsertEvent({
    chave: `om_atribuida:${order.id}:${plano.executante.id}`, tipo: "OM atribuída", severidade: SEVERIDADE[order.prioridade_nivel] || "Média",
    titulo: `Nova OM ${order.numero} para aceitar`,
    mensagem: `Prioridade ${label} · programada para ${dataBr(plano.data)}. Aceite para incluí-la no seu plano.`,
    entidade: "ordem", entidade_id: order.id, link: "/inicio", usuario_id: plano.executante.id,
  }, "");
  await audit(usuarioId, "atribuir_ordem_automatica", "ordem", order.id,
    `${plano.executante.nome} · ${plano.data}${plano.fora_do_prazo ? " · fora do prazo" : ""}${plano.reclassificadas.length ? ` · ${plano.reclassificadas.length} OM(s) reclassificada(s)` : ""}`);

  return {
    executante: { id: plano.executante.id, nome: plano.executante.nome },
    data_programada: plano.data,
    fora_do_prazo: plano.fora_do_prazo,
    da_equipe_do_ativo: Boolean(plano.equipe_preferida_id && plano.executante.equipe_id === plano.equipe_preferida_id),
    reclassificadas: plano.reclassificadas.map(({ numero, de, para }) => ({ numero, de, para })),
  };
}
