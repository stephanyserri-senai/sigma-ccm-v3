// Respostas de formulários (com o modelo congelado na versão) e seus anexos (fotos, assinaturas).
import { sql } from "../connection.js";

// Última resposta de um modelo numa OM, com o total de respostas.
export const findLatestForOrder = (ordemId, modeloId) => sql(`
  SELECT r.id, r.criado_em, r.nao_conformidades, u.nome AS usuario_nome,
         (SELECT COUNT(*) FROM formularios_respostas x WHERE x.ordem_id = r.ordem_id AND x.modelo_id = r.modelo_id) AS total
  FROM formularios_respostas r LEFT JOIN usuarios u ON u.id = r.usuario_id
  WHERE r.ordem_id = ? AND r.modelo_id = ? ORDER BY r.id DESC LIMIT 1
`).get(ordemId, modeloId);

// Filtros opcionais: modeloId, ordemId, equipamentoId e responsavelId (o que a pessoa
// preencheu ou o que pertence às OMs atribuídas a ela).
export function list({ modeloId = null, ordemId = null, equipamentoId = null, responsavelId = null } = {}) {
  const filters = [];
  const params = [];
  for (const [value, column] of [[modeloId, "r.modelo_id"], [ordemId, "r.ordem_id"], [equipamentoId, "r.equipamento_id"]]) {
    if (value != null) { filters.push(`${column} = ?`); params.push(value); }
  }
  if (responsavelId != null) { filters.push("(r.usuario_id = ? OR o.responsavel_id = ?)"); params.push(responsavelId, responsavelId); }
  return sql(`
    SELECT r.id, r.modelo_id, r.modelo_nome, r.modelo_tipo, r.modelo_versao, r.ordem_id, o.numero AS ordem_numero,
           r.equipamento_id, e.tag AS equipamento, r.nao_conformidades, r.criado_em, u.nome AS usuario_nome
    FROM formularios_respostas r
    LEFT JOIN ordens o ON o.id = r.ordem_id
    LEFT JOIN equipamentos e ON e.id = r.equipamento_id
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY r.id DESC LIMIT 200
  `).all(...params);
}

export const findDetail = (id) => sql(`
  SELECT r.*, o.numero AS ordem_numero, o.responsavel_id, e.tag AS equipamento, u.nome AS usuario_nome
  FROM formularios_respostas r
  LEFT JOIN ordens o ON o.id = r.ordem_id
  LEFT JOIN equipamentos e ON e.id = r.equipamento_id
  LEFT JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = ?
`).get(id);

// `criadoEm` (UTC) nulo usa o momento atual do banco. Campos, respostas e não conformidades já em JSON.
export const create = ({ modelo, ordemId, equipamentoId, respostas, naoConformidades, usuarioId, criadoEm }) => Number(sql(`
  INSERT INTO formularios_respostas (modelo_id, modelo_versao, modelo_nome, modelo_tipo, campos, ordem_id, equipamento_id, respostas, nao_conformidades, usuario_id, criado_em)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
`).run(modelo.id, modelo.versao, modelo.nome, modelo.tipo, modelo.campos, ordemId, equipamentoId,
  respostas, naoConformidades, usuarioId, criadoEm).lastInsertRowid);

// ---------------------------------------------------------------- Anexos
export const addAttachment = ({ respostaId, campoId, tipo, nomeArquivo, tipoMime, conteudo }) =>
  sql("INSERT INTO formularios_anexos (resposta_id, campo_id, tipo, nome_arquivo, tipo_mime, conteudo) VALUES (?, ?, ?, ?, ?, ?)")
    .run(respostaId, campoId, tipo, nomeArquivo, tipoMime, conteudo);

export const listAttachments = (respostaId) =>
  sql("SELECT id, campo_id, tipo, nome_arquivo, tipo_mime FROM formularios_anexos WHERE resposta_id = ? ORDER BY id").all(respostaId);

export const findAttachment = (id, respostaId) =>
  sql("SELECT tipo_mime, conteudo FROM formularios_anexos WHERE id = ? AND resposta_id = ?").get(id, respostaId);
