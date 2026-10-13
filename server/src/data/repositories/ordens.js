// Ordens de manutenção (OM): núcleo do fluxo nota → OM → programação → execução → encerramento.
import { sql } from "../connection.js";

// Lista geral; com `somenteDoResponsavel`, apenas as OMs atribuídas a `usuarioId`.
export const list = ({ somenteDoResponsavel, usuarioId }) => sql(
  `SELECT o.*, e.tag AS equipamento, e.localizacao, eq.nome AS equipe, p.descricao AS plano_descricao
          , u.nome AS executante_nome, u.username AS executante_username
          , (SELECT apropriante.nome FROM apontamentos ap JOIN usuarios apropriante ON apropriante.id = ap.usuario_id
             WHERE ap.ordem_id = o.id AND ap.tipo = 'Apropriação' ORDER BY ap.id DESC LIMIT 1) AS apropriado_por
   FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN equipes eq ON eq.id = o.equipe_id
  LEFT JOIN usuarios u ON u.id = o.responsavel_id
  LEFT JOIN planos_preventivos p ON p.id = o.plano_id
   WHERE (?::int = 0 OR o.responsavel_id = ?::int) ORDER BY o.id DESC`,
).all(somenteDoResponsavel ? 1 : 0, usuarioId ?? null);

export const findDetail = (id) => sql(
  `SELECT o.*, e.tag AS equipamento, e.localizacao, eq.nome AS equipe,
          u.nome AS executante_nome, u.username AS executante_username,
          p.descricao AS plano_descricao, p.periodicidade AS plano_periodicidade
   FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
   LEFT JOIN equipes eq ON eq.id = o.equipe_id
   LEFT JOIN usuarios u ON u.id = o.responsavel_id
   LEFT JOIN planos_preventivos p ON p.id = o.plano_id WHERE o.id = ?`,
).get(id);

export const findById = (id) => sql("SELECT * FROM ordens WHERE id = ?").get(id);
export const findSummary = (id) => sql("SELECT id, numero, status FROM ordens WHERE id = ?").get(id);
export const findAccess = (id) => sql("SELECT id, responsavel_id, status FROM ordens WHERE id = ?").get(id);
export const findForForms = (id) => sql("SELECT id, numero, status, responsavel_id, equipamento_id FROM ordens WHERE id = ?").get(id);
export const findForPermit = (id) => sql("SELECT id, numero, status, responsavel_id, equipamento_id, exige_pt FROM ordens WHERE id = ?").get(id);
export const findTypeAndClass = (id) => sql(`
  SELECT o.id, o.tipo, e.classe FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id WHERE o.id = ?
`).get(id);

// Maior número numérico já usado (ou null, se não houver OMs).
export const maxNumero = () => sql("SELECT MAX(CAST(numero AS INTEGER)) AS m FROM ordens").scalar("m");

export const createFromNote = ({ numero, tipo, equipamentoId, notaId, equipeId }) => sql(
  `INSERT INTO ordens (
     numero, tipo, status, equipamento_id, nota_id, equipe_id, hh_previsto, data_programada,
     afeta_seguranca_ambiente, afeta_custos, afeta_producao_qualidade, possui_reserva,
     risco_iminente, equipamento_monitorado, recursos_disponiveis, necessita_parada_programada,
     periodicidade_parada, criticidade, prioridade, prioridade_nivel, prazo_dias, priorizado_em
   )
   SELECT ?, ?, 'Aberta', ?, ?, ?, 4, NULL,
          afeta_seguranca_ambiente, afeta_custos, afeta_producao_qualidade, possui_reserva,
          risco_iminente, equipamento_monitorado, recursos_disponiveis, necessita_parada_programada,
          periodicidade_parada, criticidade, prioridade, prioridade_nivel, prazo_dias, priorizado_em
   FROM notas WHERE id = ?`,
).insert(numero, tipo, equipamentoId, notaId, equipeId, notaId);

export const associatePriorityHistory = (notaId, ordemId) => sql(
  "UPDATE historico_prioridade SET ordem_id = ? WHERE nota_id = ? AND ordem_id IS NULL",
).run(ordemId, notaId);

export const priorityHistory = (id) => sql(`
  SELECT h.*, c.confirmado_por AS paralisacao_confirmada_por,
         c.confirmado_em AS paralisacao_confirmada_em, u.nome AS paralisacao_confirmada_por_nome
  FROM historico_prioridade h
  JOIN ordens o ON o.nota_id = h.nota_id
  LEFT JOIN confirmacoes_paralisacao_prioridade c ON c.historico_prioridade_id = h.id
  LEFT JOIN usuarios u ON u.id = c.confirmado_por
  WHERE o.id = ? ORDER BY h.id DESC
`).all(id);

export const createFromPlan = ({ numero, equipamentoId, planoId, equipeId, dataProgramada }) => sql(`
  INSERT INTO ordens (numero, tipo, status, equipamento_id, plano_id, equipe_id, hh_previsto, data_programada)
  VALUES (?, 'Preventiva', 'Programada', ?, ?, ?, 4, ?)
`).insert(numero, equipamentoId, planoId, equipeId, dataProgramada);

export const updateSchedule = (id, { inicio, fim, planoId, status }) =>
  sql("UPDATE ordens SET data_programada = ?, data_fim_programada = ?, plano_id = ?, status = ? WHERE id = ?")
    .run(inicio, fim, planoId, status, id);

export const updatePlanning = (id, plan) => sql(`
  UPDATE ordens SET hh_previsto = ?, escopo_tecnico = ?, especialidades = ?, ferramentas = ?, procedimentos = ?,
    requisitos_seguranca = ?, criterios_aceitacao = ?, tarefas_planejadas = ?::jsonb,
    materiais_planejados = ?::jsonb, planejamento_pronto = ?
  WHERE id = ?
`).run(
  plan.hh_previsto, plan.escopo, plan.especialidades, plan.ferramentas, plan.procedimentos,
  plan.requisitos_seguranca, plan.criterios_aceitacao, JSON.stringify(plan.tarefas),
  JSON.stringify(plan.materiais), plan.pronto, id,
);

export const saveReschedule = (id, oldDates, newDates, justification, usuarioId) => sql(`
  INSERT INTO historico_reprogramacao_ordem (
    ordem_id, data_programada_anterior, data_fim_anterior, data_programada_nova, data_fim_nova, justificativa, usuario_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`).insert(id, oldDates.inicio, oldDates.fim, newDates.inicio, newDates.fim, justification, usuarioId);

export const recordStatusChange = (id, from, to, action, justification, userId) => sql(`
  INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, acao, justificativa, usuario_id)
  VALUES (?, ?, ?, ?, ?, ?)
`).insert(id, from, to, action, justification, userId);

export const transitionStatus = (id, expectedStatus, nextStatus, { encerramento = null, statusPrevio = null } = {}) => sql(`
  UPDATE ordens SET status = ?, data_encerramento = COALESCE(?::text, data_encerramento), status_previo_bloqueio = ?
  WHERE id = ? AND status = ?
`).run(nextStatus, encerramento, statusPrevio, id, expectedStatus);

export const listStatusHistory = (id) => sql(`
  SELECT h.*, u.nome AS usuario_nome
  FROM historico_status_ordem h JOIN usuarios u ON u.id = h.usuario_id
  WHERE h.ordem_id = ? ORDER BY h.id
`).all(id);

export const listRescheduleHistory = (id) => sql(`
  SELECT h.*, u.nome AS usuario_nome
  FROM historico_reprogramacao_ordem h JOIN usuarios u ON u.id = h.usuario_id
  WHERE h.ordem_id = ? ORDER BY h.id
`).all(id);

export const createImpediment = ({ ordemId, tipo, descricao, usuarioId }) => sql(`
  INSERT INTO impedimentos_ordem (ordem_id, tipo, descricao, registrado_por)
  VALUES (?, ?, ?, ?)
`).insert(ordemId, tipo, descricao, usuarioId);

export const listImpediments = (id) => sql(`
  SELECT i.*, u.nome AS registrado_por_nome, r.nome AS resolvido_por_nome
  FROM impedimentos_ordem i
  JOIN usuarios u ON u.id = i.registrado_por
  LEFT JOIN usuarios r ON r.id = i.resolvido_por
  WHERE i.ordem_id = ? ORDER BY i.id
`).all(id);

export const resolveImpediment = (orderId, id, usuarioId, resolucao) => sql(`
  UPDATE impedimentos_ordem
  SET resolvido_por = ?, resolvido_em = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      resolucao = ?
  WHERE ordem_id = ? AND id = ? AND resolvido_em IS NULL
`).run(usuarioId, resolucao, orderId, id);

export const distribute = (id, { status, responsavelId, expectedStatus }) =>
  sql("UPDATE ordens SET status = ?, responsavel_id = ? WHERE id = ? AND status = ?").affected(status, responsavelId, id, expectedStatus);

export const updateStatus = (id, { status, encerramento }) =>
  sql("UPDATE ordens SET status = ?, data_encerramento = COALESCE(?::text, data_encerramento) WHERE id = ?").affected(status, encerramento, id);

export const markInExecution = (id) => sql("UPDATE ordens SET status = 'Em execução' WHERE id = ?").run(id);

// Encerra com a data de hoje se ainda não estiver encerrada. Devolve as linhas alteradas.
export const closeIfOpen = (id) => sql(`
  UPDATE ordens SET status = 'Encerrada', data_encerramento = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'DD/MM/YYYY')
  WHERE id = ? AND status <> 'Encerrada'
`).affected(id);

export const setRequiresPermit = (id, exige) => sql("UPDATE ordens SET exige_pt = ? WHERE id = ?").run(exige, id);

// OMs do executante, com equipamento, plano e cronômetro (Início do executante).
export const listAssignedTo = (usuarioId) => sql(`
  SELECT o.id, o.numero, o.tipo, o.status, o.hh_previsto, o.data_programada, o.data_fim_programada, o.exige_pt,
         e.tag AS equipamento, e.descricao AS equipamento_descricao, e.localizacao AS area, e.criticidade,
         p.descricao AS plano,
         x.iniciado_em, x.finalizado_em, x.num_executantes
  FROM ordens o
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN planos_preventivos p ON p.id = o.plano_id
  LEFT JOIN execucoes_om x ON x.ordem_id = o.id
  WHERE o.responsavel_id = ?
  ORDER BY o.data_programada NULLS FIRST, o.numero
`).all(usuarioId);

// OMs criadas em [from, to), por área/equipe, com o HH apropriado (relatório em PDF).
export const listForReport = ({ from, to, area, equipeId }) => sql(`
  SELECT o.numero, o.tipo, o.status, e.tag AS equipamento, e.localizacao AS area, eq.nome AS equipe, u.nome AS executante,
         o.data_programada, o.data_fim_programada, o.hh_previsto, o.data_encerramento, o.criado_em,
         (SELECT SUM(a.hh_apropriado) FROM apontamentos a WHERE a.ordem_id = o.id AND a.tipo = 'Apropriação') AS hh_apropriado
  FROM ordens o
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN equipes eq ON eq.id = o.equipe_id
  LEFT JOIN usuarios u ON u.id = o.responsavel_id
  WHERE o.criado_em >= @from AND o.criado_em < @to
    AND (@area::text IS NULL OR e.localizacao = @area::text) AND (@equipe::int IS NULL OR o.equipe_id = @equipe::int)
  ORDER BY eq.nome, o.criado_em DESC
`).all({ from, to, area, equipe: equipeId });

// OMs não encerradas cujo prazo (término previsto ou data programada) já passou.
export const listOverdue = (hoje) => sql(`
  SELECT o.id, o.numero, o.responsavel_id, COALESCE(o.data_fim_programada, o.data_programada) AS prazo,
         e.tag, e.criticidade
  FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  WHERE o.status NOT IN ('Encerrada','Cancelada')
    AND o.data_programada ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND COALESCE(o.data_fim_programada, o.data_programada) < ?
`).all(hoje);

export const countOverdue = (hoje) => sql(`
  SELECT COUNT(*) AS total FROM ordens
  WHERE status NOT IN ('Encerrada','Cancelada') AND data_programada ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND COALESCE(data_fim_programada, data_programada) < ?
`).scalar("total", hoje);

export const countByStatus = (status) => sql("SELECT COUNT(*) AS total FROM ordens WHERE status = ?").scalar("total", status);

export const countScheduledWithoutExecutante = () =>
  sql("SELECT COUNT(*) AS total FROM ordens WHERE status = 'Programada' AND responsavel_id IS NULL").scalar("total");