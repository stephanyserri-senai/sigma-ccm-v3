// Notas de manutenção (solicitações que viram OM).
import { sql } from "../connection.js";

export const listWithEquipment = () => sql(
  `SELECT n.*, e.tag AS equipamento, o.id AS ordem_id, o.numero AS ordem_numero, o.status AS ordem_status,
          u.nome AS executante, o.data_programada AS ordem_data_programada,
          (SELECT c.confirmado_em FROM historico_prioridade h
           JOIN confirmacoes_paralisacao_prioridade c ON c.historico_prioridade_id = h.id
           WHERE h.nota_id = n.id ORDER BY h.id DESC LIMIT 1) AS paralisacao_confirmada_em
   FROM notas n LEFT JOIN equipamentos e ON e.id = n.equipamento_id
   LEFT JOIN LATERAL (SELECT * FROM ordens WHERE nota_id = n.id ORDER BY id LIMIT 1) o ON TRUE
   LEFT JOIN usuarios u ON u.id = o.responsavel_id
   ORDER BY n.id DESC`,
).all();

export const findById = (id) => sql("SELECT * FROM notas WHERE id = ?").get(id);

// Maior número numérico já usado (ou null, se não houver notas).
export const maxNumero = () => sql("SELECT MAX(CAST(numero AS INTEGER)) m FROM notas").scalar("m");

export const create = ({ numero, equipamentoId, descricao, tipo, solicitanteId }) => sql(
  "INSERT INTO notas (numero, equipamento_id, descricao, tipo, status, solicitante_id, priorizacao_pendente) VALUES (?,?,?,?, 'Aberta', ?, TRUE)",
).insert(numero, equipamentoId, descricao, tipo, solicitanteId);

export const markConverted = (id) => sql("UPDATE notas SET status = 'Em OM' WHERE id = ? AND status = 'Aberta'").run(id);

export const updatePriority = (id, priority) => sql(`
  UPDATE notas SET
    afeta_seguranca_ambiente = ?, afeta_custos = ?, afeta_producao_qualidade = ?, possui_reserva = ?,
    risco_iminente = ?, equipamento_monitorado = ?, recursos_disponiveis = ?,
    necessita_parada_programada = ?, periodicidade_parada = ?, criticidade = ?,
    prioridade = ?, prioridade_nivel = ?, prazo_dias = ?, priorizacao_pendente = FALSE,
    priorizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  WHERE id = ? AND status = 'Aberta'
`).run(
  priority.afeta_seguranca_ambiente, priority.afeta_custos, priority.afeta_producao_qualidade, priority.possui_reserva,
  priority.risco_iminente, priority.equipamento_monitorado, priority.recursos_disponiveis,
  priority.necessita_parada_programada, priority.periodicidade_parada, priority.criticidade,
  priority.prioridade, priority.prioridade_nivel, priority.prazo_dias, id,
);

export const recordPriority = (notaId, usuarioId, priority) => sql(`
  INSERT INTO historico_prioridade (
    nota_id, afeta_seguranca_ambiente, afeta_custos, afeta_producao_qualidade, possui_reserva,
    risco_iminente, equipamento_monitorado, recursos_disponiveis, necessita_parada_programada,
    periodicidade_parada, criticidade, prioridade, prioridade_nivel, prazo_dias, priorizado_por
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`).insert(
  notaId, priority.afeta_seguranca_ambiente, priority.afeta_custos, priority.afeta_producao_qualidade,
  priority.possui_reserva, priority.risco_iminente, priority.equipamento_monitorado,
  priority.recursos_disponiveis, priority.necessita_parada_programada, priority.periodicidade_parada,
  priority.criticidade, priority.prioridade, priority.prioridade_nivel, priority.prazo_dias, usuarioId,
);

export const associatePriorityHistory = (notaId, ordemId) => sql(
  "UPDATE historico_prioridade SET ordem_id = ? WHERE nota_id = ? AND ordem_id IS NULL",
).run(ordemId, notaId);

export const priorityHistory = (notaId) => sql(
  `SELECT h.*, c.confirmado_por AS paralisacao_confirmada_por,
          c.confirmado_em AS paralisacao_confirmada_em, u.nome AS paralisacao_confirmada_por_nome
   FROM historico_prioridade h
   LEFT JOIN confirmacoes_paralisacao_prioridade c ON c.historico_prioridade_id = h.id
   LEFT JOIN usuarios u ON u.id = c.confirmado_por
   WHERE h.nota_id = ? ORDER BY h.id DESC`,
).all(notaId);

export const latestPriority = (notaId) => sql(
  "SELECT id, prioridade FROM historico_prioridade WHERE nota_id = ? ORDER BY id DESC LIMIT 1",
).get(notaId);

export const confirmShutdown = (historyId, usuarioId) => sql(`
  INSERT INTO confirmacoes_paralisacao_prioridade (historico_prioridade_id, confirmado_por)
  VALUES (?, ?) ON CONFLICT (historico_prioridade_id) DO NOTHING RETURNING id
`).get(historyId, usuarioId);

export const hasShutdownConfirmation = (historyId) => sql(
  "SELECT id FROM confirmacoes_paralisacao_prioridade WHERE historico_prioridade_id = ?",
).exists(historyId);

export const countOpen = () => sql("SELECT COUNT(*) AS total FROM notas WHERE status = 'Aberta'").scalar("total");
