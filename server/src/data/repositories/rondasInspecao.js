// Rondas de inspeção (execução de uma rota) e seus pontos, copiados da rota ao iniciar.
import { sql } from "../connection.js";

export const findById = (id) => sql("SELECT * FROM rondas_inspecao WHERE id = ?").get(id);

export const findWithUser = (id) => sql(`
  SELECT x.*, u.nome AS usuario_nome FROM rondas_inspecao x LEFT JOIN usuarios u ON u.id = x.usuario_id WHERE x.id = ?
`).get(id);

// Até 100 rondas, em andamento primeiro. Sem `todas`, só as de `usuarioId`; `status` vazio = todos.
export const list = ({ todas, usuarioId, status }) => sql(`
  SELECT x.id, x.rota_id, x.rota_nome, x.status, x.iniciada_em, x.concluida_em, u.nome AS usuario_nome,
         (SELECT COUNT(*) FROM ronda_pontos rp WHERE rp.ronda_id = x.id) AS pontos,
         (SELECT COUNT(*) FROM ronda_pontos rp WHERE rp.ronda_id = x.id AND rp.status <> 'Pendente') AS pontos_feitos,
         (SELECT COUNT(*) FROM ronda_pontos rp WHERE rp.ronda_id = x.id AND rp.status = 'Não inspecionado')
           + (SELECT COALESCE(SUM(json_array_length(rp.nao_conformidades)), 0) FROM ronda_pontos rp WHERE rp.ronda_id = x.id) AS desvios
  FROM rondas_inspecao x LEFT JOIN usuarios u ON u.id = x.usuario_id
  WHERE (? = 1 OR x.usuario_id = ?) AND (? = '' OR x.status = ?)
  ORDER BY CASE x.status WHEN 'Em andamento' THEN 0 ELSE 1 END, x.id DESC LIMIT 100
`).all(todas ? 1 : 0, usuarioId, status, status);

export const findOpen = (rotaId, usuarioId) =>
  sql("SELECT id FROM rondas_inspecao WHERE rota_id = ? AND usuario_id = ? AND status = 'Em andamento'").get(rotaId, usuarioId);

// Cria a ronda copiando os pontos informados (da rota) na mesma sequência.
export function create({ rotaId, rotaNome, usuarioId, pontos }) {
  const id = sql("INSERT INTO rondas_inspecao (rota_id, rota_nome, usuario_id) VALUES (?, ?, ?)").run(rotaId, rotaNome, usuarioId).lastInsertRowid;
  const insert = sql("INSERT INTO ronda_pontos (ronda_id, sequencia, equipamento_id, modelo_id, instrucao) VALUES (?, ?, ?, ?, ?)");
  pontos.forEach((point) => insert.run(id, point.sequencia, point.equipamento_id, point.modelo_id, point.instrucao));
  return id;
}

export const conclude = (id, observacao) =>
  sql("UPDATE rondas_inspecao SET status = 'Concluída', concluida_em = datetime('now'), observacao = ? WHERE id = ?").run(observacao, id);

export const countInProgress = () => sql("SELECT COUNT(*) AS total FROM rondas_inspecao WHERE status = 'Em andamento'").get().total;
export const countInProgressBy = (usuarioId) =>
  sql("SELECT COUNT(*) AS total FROM rondas_inspecao WHERE usuario_id = ? AND status = 'Em andamento'").get(usuarioId).total;

// ---------------------------------------------------------------- Pontos da ronda
export const listPoints = (rondaId) => sql(`
  SELECT rp.id, rp.sequencia, rp.equipamento_id, e.tag AS equipamento, e.descricao AS equipamento_descricao, e.localizacao,
         rp.modelo_id, m.nome AS modelo_nome, rp.instrucao, rp.status, rp.resposta_id, rp.nao_conformidades, rp.motivo, rp.registrado_em
  FROM ronda_pontos rp
  LEFT JOIN equipamentos e ON e.id = rp.equipamento_id
  LEFT JOIN formularios_modelos m ON m.id = rp.modelo_id
  WHERE rp.ronda_id = ? ORDER BY rp.sequencia
`).all(rondaId);

export const findPoint = (pontoId, rondaId) => sql("SELECT * FROM ronda_pontos WHERE id = ? AND ronda_id = ?").get(pontoId, rondaId);

export const countPendingPoints = (rondaId) =>
  sql("SELECT COUNT(*) AS total FROM ronda_pontos WHERE ronda_id = ? AND status = 'Pendente'").get(rondaId).total;

// `registradoEm` (UTC) nulo usa o momento atual do banco. Não conformidades em JSON.
export const markInspected = (pontoId, { respostaId, naoConformidades, registradoEm }) => sql(
  "UPDATE ronda_pontos SET status = 'Inspecionado', resposta_id = ?, nao_conformidades = ?, registrado_em = COALESCE(?, datetime('now')) WHERE id = ?",
).run(respostaId, naoConformidades, registradoEm, pontoId);

export const markSkipped = (pontoId, motivo) =>
  sql("UPDATE ronda_pontos SET status = 'Não inspecionado', motivo = ?, registrado_em = datetime('now') WHERE id = ?").run(motivo, pontoId);
