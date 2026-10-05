// Geração automática de notificações a partir dos eventos críticos da operação.
// Idempotente: cada evento tem uma chave única; eventos cuja condição deixou de existir
// são resolvidos automaticamente. Resoluções manuais não são reabertas.
import { notificacoesRepo, ordensRepo, permissoesTrabalhoRepo, planosRepo, sinalizacoesRepo, transaction } from "./data/index.js";
import { addDays, parseIsoDate, todayLocal } from "./iamot.js";
import { getParameters } from "./parametros.js";
import { localDateTime } from "./routes/permissoes.js";
import { parseJson } from "./formularios.js";

export const SEVERIDADES = ["Crítica", "Alta", "Média", "Baixa"];
export const TIPOS_AUTOMATICOS = ["OM atrasada", "Preventiva vencida", "Preventiva a vencer", "Permissão pendente", "Inconsistência"];
const GESTAO = "CCM,PCM";
const DAY_MS = 24 * 60 * 60 * 1000;
const dateBr = (iso) => iso.split("-").reverse().join("/");
const daysBetween = (from, to) => Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);

function collectEvents() {
  const hoje = todayLocal();
  const events = [];

  // OM atrasada: término previsto (ou data programada) já passou e a OM não foi encerrada.
  for (const order of ordensRepo.listOverdue(hoje)) {
    const atraso = daysBetween(order.prazo, hoje);
    events.push({
      chave: `om_atrasada:${order.id}:${order.prazo}`, tipo: "OM atrasada",
      severidade: order.criticidade === "Alta" || atraso > 7 ? "Crítica" : "Alta",
      titulo: `OM ${order.numero} atrasada`,
      mensagem: `${order.tag || "Sem equipamento"} · prazo ${dateBr(order.prazo)} · ${atraso} dia(s) de atraso${order.criticidade === "Alta" ? " · equipamento de criticidade alta" : ""}.`,
      entidade: "ordem", entidade_id: order.id, link: "/ordens", usuario_id: order.responsavel_id ?? null,
    });
  }

  // Preventiva vencida ou a vencer, sem OM em aberto gerada pelo plano.
  const limite = addDays(hoje, getParameters().antecedencia_preventiva_dias);
  for (const plan of planosRepo.listDueWithoutOpenOrder(limite)) {
    const vencida = plan.proxima_data < hoje;
    const dias = Math.abs(daysBetween(hoje, plan.proxima_data));
    events.push({
      chave: `preventiva:${plan.id}:${plan.proxima_data}`, tipo: vencida ? "Preventiva vencida" : "Preventiva a vencer",
      severidade: vencida ? (plan.criticidade === "Alta" ? "Crítica" : "Alta") : dias <= 2 ? "Média" : "Baixa",
      titulo: `${vencida ? "Preventiva vencida" : "Preventiva a vencer"}: ${plan.descricao}`,
      mensagem: `${plan.tag || "Sem equipamento"} · ${vencida ? `venceu em ${dateBr(plan.proxima_data)} (${dias} dia(s))` : dias === 0 ? "vence hoje" : `vence em ${dateBr(plan.proxima_data)} (${dias} dia(s))`}. Gere a OM do plano.`,
      entidade: "plano_preventivo", entidade_id: plan.id, link: "/planejamento", usuario_id: null,
    });
  }

  // Permissão de trabalho aguardando aprovação.
  const agora = localDateTime();
  for (const permit of permissoesTrabalhoRepo.listAwaiting()) {
    const alertas = parseJson(permit.nao_conformidades, []).length;
    const atrasada = permit.validade_inicio <= agora;
    events.push({
      chave: `pt_pendente:${permit.id}`, tipo: "Permissão pendente",
      severidade: alertas > 0 || atrasada ? "Crítica" : "Alta",
      titulo: `${permit.numero} aguardando aprovação`,
      mensagem: `OM ${permit.ordem_numero} · solicitada por ${permit.solicitante}${alertas ? ` · ${alertas} alerta(s) de risco na APR` : ""}${atrasada ? " · a validade já começou" : ""}.`,
      entidade: "permissao_trabalho", entidade_id: permit.id, link: "/permissoes", usuario_id: null,
    });
  }

  // Inconsistências de dados (sinalizações novas da qualidade de dados).
  for (const signal of sinalizacoesRepo.listNew()) {
    events.push({
      chave: `inconsistencia:${signal.id}`, tipo: "Inconsistência",
      severidade: signal.score >= 0.85 ? "Alta" : signal.score >= 0.6 ? "Média" : "Baixa",
      titulo: `Inconsistência: ${signal.tipo || "dado suspeito"}`,
      mensagem: `${signal.ordem_numero ? `OM ${signal.ordem_numero} · ` : ""}${signal.campo || "campo"}: ${signal.valor_atual ?? "—"} (sugerido ${signal.valor_sugerido ?? "—"}) · confiança ${Math.round((signal.score || 0) * 100)}%.`,
      entidade: "sinalizacao", entidade_id: signal.id, link: "/ia", usuario_id: null,
    });
  }
  return events;
}

export function generateNotifications() {
  return transaction(() => {
    const events = collectEvents();
    let created = 0;
    for (const event of events) created += notificacoesRepo.upsertEvent(event, GESTAO);
    const active = new Set(events.map((event) => event.chave));
    let resolved = 0;
    for (const row of notificacoesRepo.listOpenOfTypes(TIPOS_AUTOMATICOS)) {
      if (!active.has(row.chave)) resolved += notificacoesRepo.resolveAutomatically(row.id);
    }
    return { eventos: events.length, alteradas: created, resolvidas: resolved };
  });
}
