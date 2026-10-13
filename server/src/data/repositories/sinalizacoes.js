// Sinalizações da IA (qualidade de dados) e a decisão humana sobre cada uma.
import { sql } from "../connection.js";

const VISIBLE = "(@gestao::int = 1 OR (s.entidade_tipo = 'apontamento' AND a.usuario_id = @usuario::int))";
const SELECT = `
  SELECT s.id, s.entidade_tipo, s.entidade_id, s.ordem_numero, s.campo, s.valor_atual, s.valor_sugerido, s.valor_aplicado,
         s.tipo, s.score, s.explicacao, s.status, s.criado_em, s.decidido_em, s.justificativa,
         o.id AS ordem_id, e.tag AS equipamento, a.tipo AS apontamento_tipo, a.data AS apontamento_data, a.hh_apropriado,
         au.nome AS apontado_por, d.nome AS decidido_por
  FROM sinalizacoes_ia s
  LEFT JOIN apontamentos a ON s.entidade_tipo = 'apontamento' AND a.id = s.entidade_id
  LEFT JOIN usuarios au ON au.id = a.usuario_id
  LEFT JOIN ordens o ON o.numero = s.ordem_numero
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN usuarios d ON d.id = s.decidido_por`;

// `escopo` controla a visibilidade; as rotas atuais liberam consulta apenas para CCM/PCM.
export const listVisible = (escopo, status) => sql(
  `${SELECT} WHERE ${VISIBLE} AND (@status::text IS NULL OR s.status = @status::text) ORDER BY CASE s.status WHEN 'Nova' THEN 0 ELSE 1 END, s.id DESC`,
).all({ ...escopo, status });

export const countNewVisible = (escopo) => sql(`
  SELECT COUNT(*) AS novas FROM sinalizacoes_ia s
  LEFT JOIN apontamentos a ON s.entidade_tipo = 'apontamento' AND a.id = s.entidade_id
  WHERE s.status = 'Nova' AND ${VISIBLE}
`).get(escopo);

export const findVisible = (escopo, id) => sql(`${SELECT} WHERE s.id = @id::int AND ${VISIBLE}`).get({ ...escopo, id });

export const findById = (id) => sql("SELECT * FROM sinalizacoes_ia WHERE id = ?").get(id);

export const listNew = () =>
  sql("SELECT id, tipo, ordem_numero, campo, valor_atual, valor_sugerido, score FROM sinalizacoes_ia WHERE status = 'Nova'").all();

export const countNew = () => sql("SELECT COUNT(*) AS total FROM sinalizacoes_ia WHERE status = 'Nova'").scalar("total");

export const countNewForAppointmentsOf = (usuarioId) => sql(`
  SELECT COUNT(*) AS total FROM sinalizacoes_ia s JOIN apontamentos a ON s.entidade_tipo = 'apontamento' AND a.id = s.entidade_id
  WHERE s.status = 'Nova' AND a.usuario_id = ?
`).scalar("total", usuarioId);

// Últimas sinalizações criadas em [from, to), opcionalmente de uma área (Visão geral).
export const listRecent = (from, to, area) => (area == null
  ? sql(`
    SELECT s.id, s.tipo, s.status, s.score, s.criado_em, s.ordem_numero,
           e.tag AS equipamento, e.localizacao AS area
    FROM sinalizacoes_ia s
    LEFT JOIN ordens o ON o.numero = s.ordem_numero
    LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    WHERE s.criado_em >= ? AND s.criado_em < ?
    ORDER BY s.criado_em DESC LIMIT 8
  `).all(from, to)
  : sql(`
    SELECT s.id, s.tipo, s.status, s.score, s.criado_em, s.ordem_numero,
           e.tag AS equipamento, e.localizacao AS area
    FROM sinalizacoes_ia s
    LEFT JOIN ordens o ON o.numero = s.ordem_numero
    LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    WHERE s.criado_em >= ? AND s.criado_em < ? AND e.localizacao = ?
    ORDER BY s.criado_em DESC LIMIT 8
  `).all(from, to, area));

// Sinalização de HH apropriado fora do esperado, criada na apropriação.
export const createForAppointment = ({ apontamentoId, ordemNumero, valorAtual, valorSugerido, tipo, score, explicacao }) => sql(`
  INSERT INTO sinalizacoes_ia (entidade_tipo, entidade_id, ordem_numero, campo, valor_atual, valor_sugerido, tipo, score, explicacao, status)
  VALUES ('apontamento', ?, ?, 'HH apropriado', ?, ?, ?, ?, ?, 'Nova')
`).insert(apontamentoId, ordemNumero, valorAtual, valorSugerido, tipo, score, explicacao);

export const accept = (id, { valor, usuarioId, justificativa }) => sql(`
  UPDATE sinalizacoes_ia SET status = 'Aceita', valor_aplicado = ?, decidido_por = ?, decidido_em = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), justificativa = ?
  WHERE id = ?
`).run(valor, usuarioId, justificativa, id);

export const reject = (id, { usuarioId, justificativa }) =>
  sql("UPDATE sinalizacoes_ia SET status = 'Rejeitada', decidido_por = ?, decidido_em = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), justificativa = ? WHERE id = ?")
    .run(usuarioId, justificativa, id);
