// Equipamentos (ativos), com hierarquia pai/filho e TAG única.
import { sql } from "../connection.js";

export const listForSelect = () => sql("SELECT id, tag, descricao FROM equipamentos ORDER BY tag").all();

export const listWithParent = () => sql(`
  SELECT e.*, p.tag AS equipamento_pai
  FROM equipamentos e LEFT JOIN equipamentos p ON p.id = e.pai_id
  ORDER BY e.tag
`).all();

// Equipamentos de uma área (ou de todas, com área nula).
export const listInArea = (area) =>
  sql("SELECT id, tag, descricao FROM equipamentos e WHERE (? IS NULL OR e.localizacao = ?) ORDER BY tag").all(area, area);

export const countInArea = (area) =>
  sql("SELECT COUNT(*) AS total FROM equipamentos e WHERE (? IS NULL OR e.localizacao = ?)").get(area, area).total;

// Áreas (localizações) distintas com equipamento cadastrado.
export const listAreas = () => sql(
  "SELECT DISTINCT localizacao FROM equipamentos WHERE localizacao IS NOT NULL AND trim(localizacao) <> '' ORDER BY localizacao",
).all().map((row) => row.localizacao);

export const findById = (id) => sql("SELECT id FROM equipamentos WHERE id = ?").get(id);
export const exists = (id) => Boolean(sql("SELECT 1 FROM equipamentos WHERE id = ?").get(id));
export const findTag = (id) => sql("SELECT tag FROM equipamentos WHERE id = ?").get(id);

// TAGs com o prefixo informado (para gerar a próxima sequência), opcionalmente ignorando um equipamento.
export const listTagsWithPrefix = (prefix, excludeId = null) =>
  sql("SELECT tag FROM equipamentos WHERE tag LIKE ? AND (? IS NULL OR id <> ?)").all(`${prefix}-%`, excludeId, excludeId).map((row) => row.tag);

export const tagExists = (tag, excludeId = null) =>
  Boolean(sql("SELECT 1 FROM equipamentos WHERE tag = ? AND (? IS NULL OR id <> ?)").get(tag, excludeId, excludeId));

// Comparação sem diferenciar maiúsculas/minúsculas (validação antes de gravar).
export const tagTakenIgnoringCase = (tag, excludeId = null) => Boolean(excludeId == null
  ? sql("SELECT 1 FROM equipamentos WHERE tag = ? COLLATE NOCASE").get(tag)
  : sql("SELECT 1 FROM equipamentos WHERE tag = ? COLLATE NOCASE AND id <> ?").get(tag, excludeId));

export const create = ({ tag, descricao, localizacao, classe, criticidade, paiId }) => sql(`
  INSERT INTO equipamentos (tag, descricao, localizacao, classe, criticidade, pai_id)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(tag, descricao, localizacao, classe, criticidade, paiId).lastInsertRowid;

export const update = (id, { tag, descricao, localizacao, classe, criticidade, paiId }) => sql(`
  UPDATE equipamentos
  SET tag = ?, descricao = ?, localizacao = ?, classe = ?, criticidade = ?, pai_id = ?
  WHERE id = ?
`).run(tag, descricao, localizacao, classe, criticidade, paiId, id).changes;

export const remove = (id) => sql("DELETE FROM equipamentos WHERE id = ?").run(id).changes;
