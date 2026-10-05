// Evidências (imagens) anexadas à OM pelo executante.
import { sql } from "../connection.js";

export const listSummaryByOrder = (ordemId) =>
  sql("SELECT id, nome_arquivo, tipo_mime, enviado_em FROM evidencias_om WHERE ordem_id = ? ORDER BY id").all(ordemId);

export const listByOrder = (ordemId) => sql(`
  SELECT id, ordem_id, usuario_id, nome_arquivo, tipo_mime, enviado_em
  FROM evidencias_om WHERE ordem_id = ? ORDER BY id
`).all(ordemId);

export const findFile = (id, ordemId) => sql(`
  SELECT nome_arquivo, tipo_mime, conteudo
  FROM evidencias_om WHERE id = ? AND ordem_id = ?
`).get(id, ordemId);

export const create = ({ ordemId, usuarioId, nomeArquivo, tipoMime, conteudo }) => Number(sql(`
  INSERT INTO evidencias_om (ordem_id, usuario_id, nome_arquivo, tipo_mime, conteudo)
  VALUES (?, ?, ?, ?, ?)
`).run(ordemId, usuarioId, nomeArquivo, tipoMime, conteudo).lastInsertRowid);
