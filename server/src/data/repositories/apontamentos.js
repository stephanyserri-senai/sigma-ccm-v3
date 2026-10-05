// Apontamentos da OM: as três condições de encerramento (Apropriação, Relatório, Validação).
import { sql } from "../connection.js";

export const listTypesByOrder = (ordemId) =>
  sql("SELECT DISTINCT tipo FROM apontamentos WHERE ordem_id = ?").all(ordemId).map((row) => row.tipo);

export const listByOrder = (ordemId) => sql(`
  SELECT a.id, a.tipo, a.hh_apropriado, a.descricao, a.data,
         COALESCE(u.nome, c.nome) AS usuario_nome
  FROM apontamentos a
  LEFT JOIN usuarios u ON u.id = a.usuario_id
  LEFT JOIN colaboradores c ON c.id = a.colaborador_id
  WHERE a.ordem_id = ? ORDER BY a.id
`).all(ordemId);

export const findByOrderAndType = (ordemId, tipo) =>
  sql("SELECT id FROM apontamentos WHERE ordem_id = ? AND tipo = ?").get(ordemId, tipo);

export const hasAppropriation = (ordemId) =>
  Boolean(sql("SELECT 1 FROM apontamentos WHERE ordem_id = ? AND tipo = 'Apropriação'").get(ordemId));

// `data` (UTC) nula usa o momento atual do banco.
export const create = ({ ordemId, usuarioId, tipo, horas, descricao = null, data = null }) => sql(`
  INSERT INTO apontamentos (ordem_id, usuario_id, tipo, hh_apropriado, descricao, data)
  VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
`).run(ordemId, usuarioId, tipo, horas, descricao, data).lastInsertRowid;

// Registro "Relatório" da OM, criado uma única vez.
export const createReportIfMissing = (ordemId, usuarioId, descricao) => sql(`
  INSERT INTO apontamentos (ordem_id, usuario_id, tipo, hh_apropriado, descricao)
  SELECT ?, ?, 'Relatório', 0, ?
  WHERE NOT EXISTS (SELECT 1 FROM apontamentos WHERE ordem_id = ? AND tipo = 'Relatório')
`).run(ordemId, usuarioId, descricao, ordemId);

export const updateHours = (id, horas) => sql("UPDATE apontamentos SET hh_apropriado = ? WHERE id = ?").run(horas, id);

// Apropriações com data local em [from, to) e a equipe a que o HH pertence
// (equipe de quem apropriou; sem ela, a equipe da OM).
export const listAppropriationsByTeamDay = (from, to) => sql(`
  SELECT COALESCE(u.equipe_id, c.equipe_id, o.equipe_id) AS equipe_id,
         date(a.data, 'localtime') AS dia, a.hh_apropriado AS hh
  FROM apontamentos a
  JOIN ordens o ON o.id = a.ordem_id
  LEFT JOIN usuarios u ON u.id = a.usuario_id
  LEFT JOIN colaboradores c ON c.id = a.colaborador_id
  WHERE a.tipo = 'Apropriação' AND date(a.data, 'localtime') >= ? AND date(a.data, 'localtime') < ?
`).all(from, to);

// HH apropriado por equipamento (com a área), opcionalmente de uma equipe.
export const sumAppropriatedByEquipment = (from, to, equipeId) => sql(`
  SELECT o.equipamento_id, e.localizacao AS area, SUM(a.hh_apropriado) AS hh
  FROM apontamentos a
  JOIN ordens o ON o.id = a.ordem_id
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN usuarios u ON u.id = a.usuario_id
  LEFT JOIN colaboradores c ON c.id = a.colaborador_id
  WHERE a.tipo = 'Apropriação' AND date(a.data, 'localtime') >= ? AND date(a.data, 'localtime') < ?
    AND (? IS NULL OR COALESCE(u.equipe_id, c.equipe_id, o.equipe_id) = ?)
  GROUP BY o.equipamento_id
`).all(from, to, equipeId, equipeId);
