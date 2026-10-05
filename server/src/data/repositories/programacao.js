// Programação semanal: alocações de HH das OMs por equipe e dia (programacao_atividades).
import { sql } from "../connection.js";

export const listInRange = (from, to) => sql(`
  SELECT a.id, a.ordem_id, a.equipe_id, a.data, a.hh_previsto, a.observacao,
         o.numero, o.status, o.tipo, o.hh_previsto AS hh_previsto_om, eq.tag AS equipamento,
         u.nome AS executante, cu.nome AS criado_por
  FROM programacao_atividades a
  JOIN ordens o ON o.id = a.ordem_id
  LEFT JOIN equipamentos eq ON eq.id = o.equipamento_id
  LEFT JOIN usuarios u ON u.id = o.responsavel_id
  LEFT JOIN usuarios cu ON cu.id = a.criado_por
  WHERE a.data >= ? AND a.data < ?
  ORDER BY a.data, o.numero
`).all(from, to);

// OMs em aberto ainda não totalmente alocadas (HH alocado em todas as semanas < HH previsto).
export const listOrdersPendingAllocation = () => sql(`
  SELECT o.id, o.numero, o.tipo, o.status, o.equipe_id, eq.nome AS equipe, e.tag AS equipamento,
         o.hh_previsto, o.data_programada,
         COALESCE((SELECT SUM(a.hh_previsto) FROM programacao_atividades a WHERE a.ordem_id = o.id), 0) AS hh_alocado
  FROM ordens o
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN equipes eq ON eq.id = o.equipe_id
  WHERE o.status NOT IN ('Encerrada','Cancelada')
    AND COALESCE((SELECT SUM(a.hh_previsto) FROM programacao_atividades a WHERE a.ordem_id = o.id), 0) < o.hh_previsto
  ORDER BY CASE o.status WHEN 'Aberta' THEN 0 WHEN 'Programada' THEN 1 ELSE 2 END, o.numero
`).all();

export const listOpenOrdersWithAllocation = () => sql(`
  SELECT o.id, o.numero, o.status, o.hh_previsto, o.equipe_id, e.tag AS equipamento,
         COALESCE((SELECT SUM(a.hh_previsto) FROM programacao_atividades a WHERE a.ordem_id = o.id), 0) AS hh_alocado
  FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  WHERE o.status NOT IN ('Encerrada','Cancelada') ORDER BY o.numero
`).all();

export const countOpenOrdersWithoutAllocation = () => sql(`
  SELECT COUNT(*) AS total FROM ordens o WHERE o.status NOT IN ('Encerrada','Cancelada')
    AND NOT EXISTS (SELECT 1 FROM programacao_atividades a WHERE a.ordem_id = o.id)
`).get().total;

export const findById = (id) => sql("SELECT id, ordem_id FROM programacao_atividades WHERE id = ?").get(id);

export const findWithOrder = (id) => sql(`
  SELECT a.id, a.ordem_id, a.data, o.numero FROM programacao_atividades a JOIN ordens o ON o.id = a.ordem_id WHERE a.id = ?
`).get(id);

export const create = ({ ordemId, equipeId, data, hh, observacao, usuarioId }) => sql(`
  INSERT INTO programacao_atividades (ordem_id, equipe_id, data, hh_previsto, observacao, criado_por)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(ordemId, equipeId, data, hh, observacao, usuarioId).lastInsertRowid;

export const update = (id, { equipeId, data, hh, observacao }) => sql(`
  UPDATE programacao_atividades SET equipe_id = ?, data = ?, hh_previsto = ?, observacao = ?, atualizado_em = datetime('now')
  WHERE id = ?
`).run(equipeId, data, hh, observacao, id);

export const remove = (id) => sql("DELETE FROM programacao_atividades WHERE id = ?").run(id);

// Mantém a programação da OM coerente com as alocações: datas (primeira e última),
// equipe da primeira alocação e status Aberta → Programada.
export function syncOrderSchedule(ordemId) {
  const agg = sql("SELECT MIN(data) AS inicio, MAX(data) AS fim, COUNT(*) AS total FROM programacao_atividades WHERE ordem_id = ?").get(ordemId);
  if (!agg.total) return;
  const first = sql("SELECT equipe_id FROM programacao_atividades WHERE ordem_id = ? ORDER BY data, id LIMIT 1").get(ordemId);
  sql(`
    UPDATE ordens SET data_programada = ?, data_fim_programada = ?, equipe_id = ?,
           status = CASE WHEN status = 'Aberta' THEN 'Programada' ELSE status END
    WHERE id = ?
  `).run(agg.inicio, agg.fim !== agg.inicio ? agg.fim : null, first.equipe_id, ordemId);
}
