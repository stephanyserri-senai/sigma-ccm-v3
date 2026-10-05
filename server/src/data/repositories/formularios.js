// Modelos de formulário (motor No-Code) e vínculos de formulários com OMs.
// `campos` e `regras` são gravados como JSON (texto).
import { sql } from "../connection.js";

export const listWithStats = (incluirInativos) => sql(`
  SELECT m.id, m.nome, m.tipo, m.descricao, m.versao, m.ativo, m.regras, m.campos, m.atualizado_em, u.nome AS atualizado_por,
         (SELECT COUNT(*) FROM formularios_respostas r WHERE r.modelo_id = m.id) AS respostas
  FROM formularios_modelos m LEFT JOIN usuarios u ON u.id = COALESCE(m.atualizado_por, m.criado_por)
  WHERE (? = 1 OR m.ativo = 1) ORDER BY m.nome
`).all(incluirInativos ? 1 : 0);

export const listActiveForOrders = () =>
  sql("SELECT id, nome, tipo, descricao, versao, regras FROM formularios_modelos WHERE ativo = 1 ORDER BY nome").all();

export const findById = (id) => sql("SELECT * FROM formularios_modelos WHERE id = ?").get(id);
export const findActive = (id) => sql("SELECT * FROM formularios_modelos WHERE id = ? AND ativo = 1").get(id);
export const findActiveName = (id) => sql("SELECT id, nome FROM formularios_modelos WHERE id = ? AND ativo = 1").get(id);
export const findVersion = (id) => sql("SELECT id, versao, ativo FROM formularios_modelos WHERE id = ?").get(id);
export const findName = (id) => sql("SELECT id, nome FROM formularios_modelos WHERE id = ?").get(id);
export const findByName = (nome) => sql("SELECT * FROM formularios_modelos WHERE nome = ?").get(nome);

export const countResponses = (id) => sql("SELECT COUNT(*) AS total FROM formularios_respostas WHERE modelo_id = ?").get(id).total;

export const create = ({ nome, tipo, descricao, campos, regras, usuarioId }) => sql(`
  INSERT INTO formularios_modelos (nome, tipo, descricao, campos, regras, criado_por, atualizado_por, atualizado_em)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`).run(nome, tipo, descricao, campos, regras, usuarioId, usuarioId).lastInsertRowid;

// Cada alteração incrementa a versão.
export const update = (id, { nome, tipo, descricao, campos, regras, ativo, usuarioId }) => sql(`
  UPDATE formularios_modelos SET nome = ?, tipo = ?, descricao = ?, campos = ?, regras = ?, ativo = ?,
         versao = versao + 1, atualizado_por = ?, atualizado_em = datetime('now') WHERE id = ?
`).run(nome, tipo, descricao, campos, regras, ativo, usuarioId, id);

export const deactivate = (id, usuarioId) =>
  sql("UPDATE formularios_modelos SET ativo = 0, atualizado_por = ?, atualizado_em = datetime('now') WHERE id = ?").run(usuarioId, id);

// Exclui o modelo e os vínculos com OMs (só para modelos sem respostas).
export function remove(id) {
  sql("DELETE FROM ordem_formularios WHERE modelo_id = ?").run(id);
  sql("DELETE FROM formularios_modelos WHERE id = ?").run(id);
}

// ---------------------------------------------------------------- Vínculos com OMs
export const listOrderLinks = (ordemId) => sql("SELECT modelo_id, obrigatorio FROM ordem_formularios WHERE ordem_id = ?").all(ordemId);

export const upsertOrderLink = ({ ordemId, modeloId, obrigatorio, usuarioId }) => sql(`
  INSERT INTO ordem_formularios (ordem_id, modelo_id, obrigatorio, vinculado_por) VALUES (?, ?, ?, ?)
  ON CONFLICT(ordem_id, modelo_id) DO UPDATE SET obrigatorio = excluded.obrigatorio, vinculado_por = excluded.vinculado_por, vinculado_em = datetime('now')
`).run(ordemId, modeloId, obrigatorio, usuarioId);

export const removeOrderLink = (ordemId, modeloId) =>
  sql("DELETE FROM ordem_formularios WHERE ordem_id = ? AND modelo_id = ?").run(ordemId, modeloId).changes;
