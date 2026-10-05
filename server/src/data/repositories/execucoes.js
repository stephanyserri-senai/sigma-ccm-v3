// Execução cronometrada da OM (execucoes_om), nomes dos executantes e intercorrências.
import { sql } from "../connection.js";

export const findByOrder = (ordemId) => sql(`
  SELECT x.id, x.usuario_id, u.nome AS usuario_nome, x.num_executantes, x.iniciado_em,
         x.finalizado_em, x.duracao_horas, x.hh_calculado
  FROM execucoes_om x LEFT JOIN usuarios u ON u.id = x.usuario_id WHERE x.ordem_id = ?
`).get(ordemId);

export const findState = (ordemId) => sql("SELECT id, finalizado_em FROM execucoes_om WHERE ordem_id = ?").get(ordemId);
export const exists = (ordemId) => Boolean(sql("SELECT 1 FROM execucoes_om WHERE ordem_id = ?").get(ordemId));
export const isRunning = (ordemId) => Boolean(sql("SELECT 1 FROM execucoes_om WHERE ordem_id = ? AND finalizado_em IS NULL").get(ordemId));

export const listExecutantes = (execucaoId) =>
  sql("SELECT nome FROM execucao_executantes WHERE execucao_id = ? ORDER BY id").all(execucaoId).map((row) => row.nome);

// `iniciadoEm` (UTC) nulo usa o momento atual do banco.
export const start = ({ ordemId, usuarioId, quantidade, iniciadoEm }) => sql(
  "INSERT INTO execucoes_om (ordem_id, usuario_id, num_executantes, iniciado_em) VALUES (?, ?, ?, COALESCE(?, datetime('now')))",
).run(ordemId, usuarioId, quantidade, iniciadoEm).lastInsertRowid;

export const addExecutante = (execucaoId, nome) =>
  sql("INSERT INTO execucao_executantes (execucao_id, nome) VALUES (?, ?)").run(execucaoId, nome);

// Execução com o fim considerado (informado ou agora) e as horas decorridas desde o início.
export const findForFinish = (ordemId, fim) => sql(`
  SELECT id, num_executantes, finalizado_em, COALESCE(?, datetime('now')) AS fim,
         (julianday(COALESCE(?, datetime('now'))) - julianday(iniciado_em)) * 24 AS horas
  FROM execucoes_om WHERE ordem_id = ?
`).get(fim, fim, ordemId);

export const finish = (id, { fim, duracao, hh, apontamentoId }) => sql(`
  UPDATE execucoes_om SET finalizado_em = ?, duracao_horas = ?, hh_calculado = ?, apontamento_id = ?
  WHERE id = ?
`).run(fim, duracao, hh, apontamentoId, id);

// Mantém o HH da execução igual ao do apontamento corrigido.
export const updateHoursByAppointment = (apontamentoId, hh) =>
  sql("UPDATE execucoes_om SET hh_calculado = ? WHERE apontamento_id = ?").run(hh, apontamentoId);

// ---------------------------------------------------------------- Intercorrências
export const listIncidentsByOrder = (ordemId) => sql(`
  SELECT i.id, i.tipo, i.descricao, i.registrado_em, u.nome AS usuario_nome
  FROM intercorrencias_om i LEFT JOIN usuarios u ON u.id = i.usuario_id
  WHERE i.ordem_id = ? ORDER BY i.id
`).all(ordemId);

// Intercorrências registradas (data local) em [semana, proxima), para o acompanhamento de Mão de obra.
export const listIncidentsInRange = (semana, proxima) => sql(`
  SELECT i.id, i.tipo, i.descricao, i.registrado_em, o.id AS ordem_id, o.numero AS ordem_numero,
         eq.tag AS equipamento, e.nome AS equipe, u.nome AS enviado_por
  FROM intercorrencias_om i
  JOIN ordens o ON o.id = i.ordem_id
  LEFT JOIN equipamentos eq ON eq.id = o.equipamento_id
  LEFT JOIN usuarios u ON u.id = i.usuario_id
  LEFT JOIN equipes e ON e.id = COALESCE(u.equipe_id, o.equipe_id)
  WHERE date(i.registrado_em, 'localtime') >= ? AND date(i.registrado_em, 'localtime') < ?
  ORDER BY i.id DESC
`).all(semana, proxima);

export const createIncident = ({ ordemId, execucaoId, usuarioId, tipo, descricao, registradoEm }) => sql(
  "INSERT INTO intercorrencias_om (ordem_id, execucao_id, usuario_id, tipo, descricao, registrado_em) VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))",
).run(ordemId, execucaoId, usuarioId, tipo, descricao, registradoEm).lastInsertRowid;
