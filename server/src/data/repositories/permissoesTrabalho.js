// Permissões de Trabalho (APR/PT): solicitada → aprovada/reprovada/cancelada → encerrada.
import { sql } from "../connection.js";

const SELECT = `
  SELECT p.*, o.numero AS ordem_numero, o.responsavel_id, o.exige_pt, e.tag AS equipamento,
         s.nome AS solicitante, a.nome AS aprovador, f.nome AS encerrada_por_nome,
         r.nao_conformidades
  FROM permissoes_trabalho p
  JOIN ordens o ON o.id = p.ordem_id
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN usuarios s ON s.id = p.solicitante_id
  LEFT JOIN usuarios a ON a.id = p.aprovador_id
  LEFT JOIN usuarios f ON f.id = p.encerrada_por
  LEFT JOIN formularios_respostas r ON r.id = p.resposta_id`;

// Filtros opcionais: status, ordemId e envolvidoId (quem solicitou ou o responsável pela OM).
export function list({ status = null, ordemId = null, envolvidoId = null } = {}) {
  const filters = [];
  const params = [];
  if (status != null) { filters.push("p.status = ?"); params.push(status); }
  if (ordemId != null) { filters.push("p.ordem_id = ?"); params.push(ordemId); }
  if (envolvidoId != null) { filters.push("(p.solicitante_id = ? OR o.responsavel_id = ?)"); params.push(envolvidoId, envolvidoId); }
  return sql(`${SELECT} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY CASE p.status WHEN 'Solicitada' THEN 0 WHEN 'Aprovada' THEN 1 ELSE 2 END, p.id DESC LIMIT 200`)
    .all(...params);
}

export const findDetail = (id) => sql(`${SELECT} WHERE p.id = ?`).get(id);

// PT aprovada e vigente em `agora` (AAAA-MM-DDTHH:MM, horário local).
export const findValid = (ordemId, agora) => sql(`
  SELECT id, numero FROM permissoes_trabalho
  WHERE ordem_id = ? AND status = 'Aprovada' AND validade_inicio <= ? AND validade_fim >= ?
  ORDER BY validade_fim DESC LIMIT 1
`).get(ordemId, agora, agora);

export const listByOrder = (ordemId) => sql(`
  SELECT p.id, p.numero, p.status, p.validade_inicio, p.validade_fim, p.solicitada_em, p.decidida_em, p.parecer,
         s.nome AS solicitante, a.nome AS aprovador
  FROM permissoes_trabalho p
  LEFT JOIN usuarios s ON s.id = p.solicitante_id
  LEFT JOIN usuarios a ON a.id = p.aprovador_id
  WHERE p.ordem_id = ? ORDER BY p.id DESC
`).all(ordemId);

// PTs aguardando aprovação, com a OM, o solicitante e os alertas da APR (notificações).
export const listAwaiting = () => sql(`
  SELECT p.id, p.numero, p.validade_inicio, o.numero AS ordem_numero, s.nome AS solicitante, r.nao_conformidades
  FROM permissoes_trabalho p
  JOIN ordens o ON o.id = p.ordem_id
  LEFT JOIN usuarios s ON s.id = p.solicitante_id
  LEFT JOIN formularios_respostas r ON r.id = p.resposta_id
  WHERE p.status = 'Solicitada'
`).all();

export const countAwaiting = () => sql("SELECT COUNT(*) AS total FROM permissoes_trabalho WHERE status = 'Solicitada'").get().total;
export const countAwaitingRequestedBy = (usuarioId) =>
  sql("SELECT COUNT(*) AS total FROM permissoes_trabalho WHERE solicitante_id = ? AND status = 'Solicitada'").get(usuarioId).total;

export const maxId = () => sql("SELECT MAX(id) AS id FROM permissoes_trabalho").get().id;

export const create = ({ numero, ordemId, modeloId, respostaId, inicio, fim, solicitanteId }) => sql(`
  INSERT INTO permissoes_trabalho (numero, ordem_id, modelo_id, resposta_id, validade_inicio, validade_fim, solicitante_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(numero, ordemId, modeloId, respostaId, inicio, fim, solicitanteId).lastInsertRowid;

export const decide = (id, { status, aprovadorId, parecer }) =>
  sql("UPDATE permissoes_trabalho SET status = ?, aprovador_id = ?, decidida_em = datetime('now'), parecer = ? WHERE id = ?")
    .run(status, aprovadorId, parecer, id);

export const cancel = (id, { status, parecer }) =>
  sql("UPDATE permissoes_trabalho SET status = ?, parecer = COALESCE(?, parecer) WHERE id = ?").run(status, parecer, id);

export const close = (id, { status, usuarioId, observacao }) =>
  sql("UPDATE permissoes_trabalho SET status = ?, encerrada_por = ?, encerrada_em = datetime('now'), observacao_encerramento = ? WHERE id = ?")
    .run(status, usuarioId, observacao, id);
