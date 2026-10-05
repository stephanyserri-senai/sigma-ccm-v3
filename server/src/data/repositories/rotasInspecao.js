// Rotas de inspeção: sequência de pontos (equipamento + formulário + instrução).
import { sql } from "../connection.js";

export const listSummary = (incluirInativas) => sql(`
  SELECT r.id, r.nome, r.descricao, r.area, r.ativo, r.atualizado_em,
         (SELECT COUNT(*) FROM rota_pontos p WHERE p.rota_id = r.id) AS pontos,
         (SELECT COUNT(*) FROM rondas_inspecao x WHERE x.rota_id = r.id) AS rondas,
         (SELECT MAX(x.concluida_em) FROM rondas_inspecao x WHERE x.rota_id = r.id) AS ultima_ronda
  FROM rotas_inspecao r WHERE (? = 1 OR r.ativo = 1) ORDER BY r.nome
`).all(incluirInativas ? 1 : 0);

export const findById = (id) => sql("SELECT * FROM rotas_inspecao WHERE id = ?").get(id);
export const findState = (id) => sql("SELECT id, ativo FROM rotas_inspecao WHERE id = ?").get(id);
export const findName = (id) => sql("SELECT id, nome FROM rotas_inspecao WHERE id = ?").get(id);
export const findActive = (id) => sql("SELECT id, nome FROM rotas_inspecao WHERE id = ? AND ativo = 1").get(id);

export const listPoints = (rotaId) => sql(`
  SELECT p.id, p.sequencia, p.equipamento_id, e.tag AS equipamento, e.descricao AS equipamento_descricao, e.localizacao,
         p.modelo_id, m.nome AS modelo_nome, m.tipo AS modelo_tipo, m.ativo AS modelo_ativo, p.instrucao
  FROM rota_pontos p
  JOIN equipamentos e ON e.id = p.equipamento_id
  JOIN formularios_modelos m ON m.id = p.modelo_id
  WHERE p.rota_id = ? ORDER BY p.sequencia
`).all(rotaId);

export const hasRounds = (rotaId) => Boolean(sql("SELECT 1 FROM rondas_inspecao WHERE rota_id = ?").get(rotaId));

export const create = ({ nome, descricao, area, usuarioId }) => sql(
  "INSERT INTO rotas_inspecao (nome, descricao, area, criado_por, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))",
).run(nome, descricao, area, usuarioId, usuarioId).lastInsertRowid;

export const update = (id, { nome, descricao, area, ativo, usuarioId }) => sql(
  "UPDATE rotas_inspecao SET nome = ?, descricao = ?, area = ?, ativo = ?, atualizado_por = ?, atualizado_em = datetime('now') WHERE id = ?",
).run(nome, descricao, area, ativo, usuarioId, id);

export const deactivate = (id, usuarioId) =>
  sql("UPDATE rotas_inspecao SET ativo = 0, atualizado_por = ?, atualizado_em = datetime('now') WHERE id = ?").run(usuarioId, id);

export const remove = (id) => sql("DELETE FROM rotas_inspecao WHERE id = ?").run(id);

// Substitui os pontos da rota, numerando a sequência a partir de 1.
export function replacePoints(rotaId, pontos) {
  sql("DELETE FROM rota_pontos WHERE rota_id = ?").run(rotaId);
  const insert = sql("INSERT INTO rota_pontos (rota_id, sequencia, equipamento_id, modelo_id, instrucao) VALUES (?, ?, ?, ?, ?)");
  pontos.forEach((point, index) => insert.run(rotaId, index + 1, point.equipamento_id, point.modelo_id, point.instrucao));
}
