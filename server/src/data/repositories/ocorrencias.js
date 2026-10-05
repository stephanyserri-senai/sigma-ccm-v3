// Ocorrências de HH (folga, férias, falta, atestado), enviadas pelo executante em campo.
import { sql } from "../connection.js";

// Ocorrências que tocam [from, to), com a equipe da pessoa (para o IAMOT).
export const listForLabor = (from, to) => sql(`
  SELECT COALESCE(u.equipe_id, c.equipe_id) AS equipe_id, oc.data_inicio,
         COALESCE(oc.data_fim, oc.data_inicio) AS data_fim, oc.horas_dia
  FROM ocorrencias_hh oc
  JOIN colaboradores c ON c.id = oc.colaborador_id
  LEFT JOIN usuarios u ON u.id = c.usuario_id
  WHERE COALESCE(u.equipe_id, c.equipe_id) IS NOT NULL AND oc.data_inicio < ? AND COALESCE(oc.data_fim, oc.data_inicio) >= ?
`).all(to, from);

// Mesmo recorte, incluindo pessoas sem equipe (capacidade do Planejamento).
export const listForPlanning = (from, to) => sql(`
  SELECT COALESCE(u.equipe_id, c.equipe_id) AS equipe_id, oc.data_inicio,
         COALESCE(oc.data_fim, oc.data_inicio) AS data_fim, oc.horas_dia
  FROM ocorrencias_hh oc
  JOIN colaboradores c ON c.id = oc.colaborador_id
  LEFT JOIN usuarios u ON u.id = c.usuario_id
  WHERE oc.data_inicio < ? AND COALESCE(oc.data_fim, oc.data_inicio) >= ?
`).all(to, from);

// Lista detalhada da semana (acompanhamento de CCM/PCM).
export const listInWeek = (semana, proxima) => sql(`
  SELECT oc.id, oc.colaborador_id, COALESCE(p.nome, c.nome) AS colaborador, e.nome AS equipe,
         oc.tipo, oc.data_inicio, COALESCE(oc.data_fim, oc.data_inicio) AS data_fim,
         oc.horas_dia, oc.observacao, oc.criado_em, u.nome AS enviado_por
  FROM ocorrencias_hh oc
  JOIN colaboradores c ON c.id = oc.colaborador_id
  LEFT JOIN usuarios p ON p.id = c.usuario_id
  LEFT JOIN equipes e ON e.id = COALESCE(p.equipe_id, c.equipe_id)
  LEFT JOIN usuarios u ON u.id = oc.registrado_por
  WHERE oc.data_inicio < ? AND COALESCE(oc.data_fim, oc.data_inicio) >= ?
  ORDER BY oc.data_inicio, colaborador
`).all(proxima, semana);

export const listSentBy = (usuarioId) => sql(`
  SELECT oc.id, COALESCE(p.nome, c.nome) AS colaborador, oc.tipo, oc.data_inicio,
         COALESCE(oc.data_fim, oc.data_inicio) AS data_fim, oc.horas_dia, oc.observacao, oc.criado_em
  FROM ocorrencias_hh oc JOIN colaboradores c ON c.id = oc.colaborador_id
  LEFT JOIN usuarios p ON p.id = c.usuario_id
  WHERE oc.registrado_por = ? ORDER BY oc.id DESC LIMIT 50
`).all(usuarioId);

export const findById = (id) => sql("SELECT id, colaborador_id, registrado_por FROM ocorrencias_hh WHERE id = ?").get(id);

export const create = ({ colaboradorId, tipo, inicio, fim, horasDia, observacao, usuarioId }) => sql(`
  INSERT INTO ocorrencias_hh (colaborador_id, tipo, data_inicio, data_fim, horas_dia, observacao, registrado_por, criado_em)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`).run(colaboradorId, tipo, inicio, fim, horasDia, observacao, usuarioId).lastInsertRowid;

export const remove = (id) => sql("DELETE FROM ocorrencias_hh WHERE id = ?").run(id);

// Ocorrências que tocam a semana [inicio, fim] (inclusive), de todos ou de quem enviou.
export const countInWeek = (fim, inicio) => sql(`
  SELECT COUNT(*) AS total FROM ocorrencias_hh WHERE data_inicio <= ? AND COALESCE(data_fim, data_inicio) >= ?
`).get(fim, inicio).total;

export const countInWeekSentBy = (usuarioId, fim, inicio) => sql(`
  SELECT COUNT(*) AS total FROM ocorrencias_hh WHERE registrado_por = ? AND data_inicio <= ? AND COALESCE(data_fim, data_inicio) >= ?
`).get(usuarioId, fim, inicio).total;
