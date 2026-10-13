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
  sql("SELECT id, tag, descricao FROM equipamentos e WHERE (?::text IS NULL OR e.localizacao = ?::text) ORDER BY tag").all(area, area);

export const countInArea = (area) =>
  sql("SELECT COUNT(*) AS total FROM equipamentos e WHERE (?::text IS NULL OR e.localizacao = ?::text)").scalar("total", area, area);

// Áreas (localizações) distintas com equipamento cadastrado.
export const listAreas = () => sql(
  "SELECT DISTINCT localizacao FROM equipamentos WHERE localizacao IS NOT NULL AND trim(localizacao) <> '' ORDER BY localizacao",
).column("localizacao");

export const findById = (id) => sql("SELECT id FROM equipamentos WHERE id = ?").get(id);
export const exists = (id) => sql("SELECT 1 FROM equipamentos WHERE id = ?").exists(id);
export const findTag = (id) => sql("SELECT tag FROM equipamentos WHERE id = ?").get(id);

// TAGs com o prefixo informado (para gerar a próxima sequência), opcionalmente ignorando um equipamento.
export const listTagsWithPrefix = (prefix, excludeId = null) =>
  sql("SELECT tag FROM equipamentos WHERE tag ILIKE ? AND (?::int IS NULL OR id <> ?::int)").column("tag", `${prefix}-%`, excludeId, excludeId);

export const tagExists = (tag, excludeId = null) =>
  sql("SELECT 1 FROM equipamentos WHERE tag = ? AND (?::int IS NULL OR id <> ?::int)").exists(tag, excludeId, excludeId);

// Comparação sem diferenciar maiúsculas/minúsculas (validação antes de gravar).
export const tagTakenIgnoringCase = (tag, excludeId = null) => (excludeId == null
  ? sql("SELECT 1 FROM equipamentos WHERE lower(tag) = lower(?)").exists(tag)
  : sql("SELECT 1 FROM equipamentos WHERE lower(tag) = lower(?) AND id <> ?").exists(tag, excludeId));

export const create = ({ tag, descricao, localizacao, classe, criticidade, paiId }) => sql(`
  INSERT INTO equipamentos (tag, descricao, localizacao, classe, criticidade, pai_id)
  VALUES (?, ?, ?, ?, ?, ?)
`).insert(tag, descricao, localizacao, classe, criticidade, paiId);

export const update = (id, { tag, descricao, localizacao, classe, criticidade, paiId }) => sql(`
  UPDATE equipamentos
  SET tag = ?, descricao = ?, localizacao = ?, classe = ?, criticidade = ?, pai_id = ?
  WHERE id = ?
`).affected(tag, descricao, localizacao, classe, criticidade, paiId, id);

export const remove = (id) => sql("DELETE FROM equipamentos WHERE id = ?").affected(id);
