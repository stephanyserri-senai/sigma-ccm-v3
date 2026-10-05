// Geração automática de notificações a partir dos eventos críticos da operação.
// Idempotente: cada evento tem uma chave única; eventos cuja condição deixou de existir
// são resolvidos automaticamente. Resoluções manuais não são reabertas.
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

function collectEvents(db) {
  const hoje = todayLocal();
  const events = [];

  // OM atrasada: término previsto (ou data programada) já passou e a OM não foi encerrada.
  for (const order of db.prepare(`
    SELECT o.id, o.numero, o.responsavel_id, COALESCE(o.data_fim_programada, o.data_programada) AS prazo,
           e.tag, e.criticidade
    FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    WHERE o.status NOT IN ('Encerrada','Cancelada')
      AND o.data_programada GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND COALESCE(o.data_fim_programada, o.data_programada) < ?
  `).all(hoje)) {
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
  const limite = addDays(hoje, getParameters(db).antecedencia_preventiva_dias);
  for (const plan of db.prepare(`
    SELECT p.id, p.descricao, p.proxima_data, e.tag, e.criticidade
    FROM planos_preventivos p LEFT JOIN equipamentos e ON e.id = p.equipamento_id
    WHERE p.proxima_data GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND p.proxima_data <= ?
      AND NOT EXISTS (SELECT 1 FROM ordens o WHERE o.plano_id = p.id AND o.status NOT IN ('Encerrada','Cancelada'))
  `).all(limite)) {
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
  for (const permit of db.prepare(`
    SELECT p.id, p.numero, p.validade_inicio, o.numero AS ordem_numero, s.nome AS solicitante, r.nao_conformidades
    FROM permissoes_trabalho p
    JOIN ordens o ON o.id = p.ordem_id
    LEFT JOIN usuarios s ON s.id = p.solicitante_id
    LEFT JOIN formularios_respostas r ON r.id = p.resposta_id
    WHERE p.status = 'Solicitada'
  `).all()) {
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
  for (const signal of db.prepare("SELECT id, tipo, ordem_numero, campo, valor_atual, valor_sugerido, score FROM sinalizacoes_ia WHERE status = 'Nova'").all()) {
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

export function generateNotifications(db) {
  return db.transaction(() => {
    const events = collectEvents(db);
    const upsert = db.prepare(`
      INSERT INTO notificacoes (chave, tipo, severidade, titulo, mensagem, entidade, entidade_id, link, papeis, usuario_id)
      VALUES (@chave, @tipo, @severidade, @titulo, @mensagem, @entidade, @entidade_id, @link, '${GESTAO}', @usuario_id)
      ON CONFLICT(chave) DO UPDATE SET
        severidade = excluded.severidade, titulo = excluded.titulo, mensagem = excluded.mensagem,
        usuario_id = excluded.usuario_id, atualizada_em = datetime('now')
      WHERE notificacoes.status <> 'Resolvida'
        AND (notificacoes.mensagem <> excluded.mensagem OR notificacoes.severidade <> excluded.severidade
             OR COALESCE(notificacoes.usuario_id, 0) <> COALESCE(excluded.usuario_id, 0))
    `);
    let created = 0;
    for (const event of events) created += upsert.run(event).changes;
    const active = new Set(events.map((event) => event.chave));
    const resolve = db.prepare(`
      UPDATE notificacoes SET status = 'Resolvida', resolvida_em = datetime('now'),
             resolucao = 'Resolvida automaticamente: a condição deixou de existir.'
      WHERE id = ?
    `);
    let resolved = 0;
    for (const row of db.prepare(`
      SELECT id, chave FROM notificacoes WHERE status <> 'Resolvida' AND tipo IN (${TIPOS_AUTOMATICOS.map(() => "?").join(",")})
    `).all(...TIPOS_AUTOMATICOS)) {
      if (!active.has(row.chave)) resolved += resolve.run(row.id).changes;
    }
    return { eventos: events.length, alteradas: created, resolvidas: resolved };
  }).immediate();
}

// Condição SQL de visibilidade: perfil do usuário, destinatário direto ou encaminhamento.
export const VISIBLE_SQL = `(
  (',' || n.papeis || ',') LIKE '%,' || @papel || ',%'
  OR n.usuario_id = @usuario
  OR EXISTS (SELECT 1 FROM notificacoes_destinatarios d WHERE d.notificacao_id = n.id AND d.usuario_id = @usuario)
)`;
