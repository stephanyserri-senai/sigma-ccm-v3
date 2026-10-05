// Passagens de turno (registro imutável) e confirmações de leitura.
import { sql } from "../connection.js";

// Últimas passagens; com `pendentes`, só as de outros autores ainda não lidas por `usuarioId`.
export const list = (usuarioId, pendentes) => sql(`
  SELECT p.id, p.data, p.turno, p.equipe_id, e.nome AS equipe, p.autor_id, u.nome AS autor,
         p.ocorrencias, p.feito, p.pendencias, p.avisos, p.criado_em,
         EXISTS (SELECT 1 FROM passagens_turno_leituras l WHERE l.passagem_id = p.id AND l.usuario_id = ?) AS lido_por_mim
  FROM passagens_turno p
  LEFT JOIN equipes e ON e.id = p.equipe_id
  LEFT JOIN usuarios u ON u.id = p.autor_id
  WHERE (? = 0 OR (p.autor_id <> ? AND NOT EXISTS (
    SELECT 1 FROM passagens_turno_leituras l WHERE l.passagem_id = p.id AND l.usuario_id = ?)))
  ORDER BY p.data DESC, CASE p.turno WHEN 'Noite' THEN 0 WHEN 'Tarde' THEN 1 ELSE 2 END, p.id DESC
  LIMIT 60
`).all(usuarioId, pendentes ? 1 : 0, usuarioId, usuarioId);

export const listReaders = (passagemId) => sql(`
  SELECT l.usuario_id, u.nome, l.lido_em FROM passagens_turno_leituras l
  JOIN usuarios u ON u.id = l.usuario_id WHERE l.passagem_id = ? ORDER BY l.lido_em
`).all(passagemId);

export const findById = (id) => sql("SELECT id, autor_id, data, turno FROM passagens_turno WHERE id = ?").get(id);

export const create = ({ data, turno, equipeId, autorId, ocorrencias, feito, pendencias, avisos }) => sql(`
  INSERT INTO passagens_turno (data, turno, equipe_id, autor_id, ocorrencias, feito, pendencias, avisos)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(data, turno, equipeId, autorId, ocorrencias, feito, pendencias, avisos).lastInsertRowid;

// Devolve true se a leitura foi registrada agora (false se já existia).
export const markRead = (passagemId, usuarioId) =>
  sql("INSERT OR IGNORE INTO passagens_turno_leituras (passagem_id, usuario_id) VALUES (?, ?)").run(passagemId, usuarioId).changes > 0;

// Passagens dos últimos 7 dias (até `hoje`), de outros autores, ainda não lidas.
export const countUnread = (usuarioId, hoje) => sql(`
  SELECT COUNT(*) AS total FROM passagens_turno p
  WHERE p.autor_id <> ? AND p.data >= date(?, '-7 days')
    AND NOT EXISTS (SELECT 1 FROM passagens_turno_leituras l WHERE l.passagem_id = p.id AND l.usuario_id = ?)
`).get(usuarioId, hoje, usuarioId).total;
