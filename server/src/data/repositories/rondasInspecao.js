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
           + (SELECT COALESCE(SUM(jsonb_array_length(rp.nao_conformidades::jsonb)), 0) FROM ronda_pontos rp WHERE rp.ronda_id = x.id) AS desvios
  FROM rondas_inspecao x LEFT JOIN usuarios u ON u.id = x.usuario_id
  WHERE (?::int = 1 OR x.usuario_id = ?::int) AND (?::text = '' OR x.status = ?::text)
  ORDER BY CASE x.status WHEN 'Em andamento' THEN 0 ELSE 1 END, x.id DESC LIMIT 100
`).all(todas ? 1 : 0, usuarioId ?? null, status, status);

export const findOpen = (rotaId, usuarioId) =>
  sql("SELECT id FROM rondas_inspecao WHERE rota_id = ? AND usuario_id = ? AND status = 'Em andamento'").get(rotaId, usuarioId);

// Cria a ronda copiando os pontos informados (da rota) na mesma sequência.
export async function create({ rotaId, rotaNome, usuarioId, pontos }) {
  const id = await sql("INSERT INTO rondas_inspecao (rota_id, rota_nome, usuario_id) VALUES (?, ?, ?)").insert(rotaId, rotaNome, usuarioId);
  const insert = sql("INSERT INTO ronda_pontos (ronda_id, sequencia, equipamento_id, modelo_id, instrucao) VALUES (?, ?, ?, ?, ?)");
  for (const point of pontos) await insert.run(id, point.sequencia, point.equipamento_id, point.modelo_id, point.instrucao);
  return id;
}

export const conclude = (id, observacao) =>
  sql("UPDATE rondas_inspecao SET status = 'Concluída', concluida_em = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), observacao = ? WHERE id = ?").run(observacao, id);

export const countInProgress = () => sql("SELECT COUNT(*) AS total FROM rondas_inspecao WHERE status = 'Em andamento'").scalar("total");
export const countInProgressBy = (usuarioId) =>
  sql("SELECT COUNT(*) AS total FROM rondas_inspecao WHERE usuario_id = ? AND status = 'Em andamento'").scalar("total", usuarioId);

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
  sql("SELECT COUNT(*) AS total FROM ronda_pontos WHERE ronda_id = ? AND status = 'Pendente'").scalar("total", rondaId);

// `registradoEm` (UTC) nulo usa o momento atual do banco. Não conformidades em JSON.
export const markInspected = (pontoId, { respostaId, naoConformidades, registradoEm }) => sql(
  "UPDATE ronda_pontos SET status = 'Inspecionado', resposta_id = ?, nao_conformidades = ?, registrado_em = COALESCE(?::text, to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')) WHERE id = ?",
).run(respostaId, naoConformidades, registradoEm, pontoId);

export const markSkipped = (pontoId, motivo) =>
  sql("UPDATE ronda_pontos SET status = 'Não inspecionado', motivo = ?, registrado_em = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?").run(motivo, pontoId);
