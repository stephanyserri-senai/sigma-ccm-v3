// HH disponível lançado por equipe e semana (base do IAMOT).
import { sql } from "../connection.js";

export const listInRange = (from, to) => sql(`
  SELECT equipe_id, semana_inicio, hh_disponivel FROM hh_disponivel
  WHERE semana_inicio >= ? AND semana_inicio < ?
`).all(from, to);

export const upsert = ({ equipeId, semana, horas, usuarioId }) => sql(`
  INSERT INTO hh_disponivel (equipe_id, semana_inicio, hh_disponivel, registrado_por, atualizado_em)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(equipe_id, semana_inicio) DO UPDATE SET
    hh_disponivel = excluded.hh_disponivel,
    registrado_por = excluded.registrado_por,
    atualizado_em = datetime('now')
`).run(equipeId, semana, horas, usuarioId);

export const remove = (equipeId, semana) =>
  sql("DELETE FROM hh_disponivel WHERE equipe_id = ? AND semana_inicio = ?").run(equipeId, semana);
