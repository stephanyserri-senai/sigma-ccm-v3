// Equipes de manutenção (próprias ou terceirizadas).
import { sql } from "../connection.js";

export const listAll = () => sql("SELECT * FROM equipes ORDER BY nome").all();
export const listForSelect = () => sql("SELECT id, nome, tipo FROM equipes ORDER BY nome").all();
export const listNames = () => sql("SELECT id, nome FROM equipes ORDER BY nome").all();

export const findById = (id) => sql("SELECT id, nome FROM equipes WHERE id = ?").get(id);
export const exists = (id) => Boolean(sql("SELECT 1 FROM equipes WHERE id = ?").get(id));
export const findFirst = () => sql("SELECT id FROM equipes ORDER BY id LIMIT 1").get();

// Equipes com a quantidade de usuários ativos (Mão de obra).
export const listWithHeadcount = () => sql(`
  SELECT e.id AS equipe_id, e.nome AS equipe, e.tipo,
         (SELECT COUNT(*) FROM usuarios u WHERE u.equipe_id = e.id AND u.ativo = 1) AS colaboradores
  FROM equipes e ORDER BY e.nome
`).all();

// Equipes com pessoas ativas e o HH disponível lançado na semana (Planejamento).
export const listWithWeekAvailability = (semana) => sql(`
  SELECT e.id, e.nome,
         (SELECT COUNT(*) FROM usuarios u WHERE u.equipe_id = e.id AND u.ativo = 1) AS pessoas,
         h.hh_disponivel
  FROM equipes e LEFT JOIN hh_disponivel h ON h.equipe_id = e.id AND h.semana_inicio = ?
  ORDER BY e.nome
`).all(semana);

export const create = ({ nome, tipo, especialidade }) =>
  sql("INSERT INTO equipes (nome, tipo, especialidade) VALUES (?, ?, ?)").run(nome, tipo, especialidade).lastInsertRowid;

export const update = (id, { nome, tipo, especialidade }) =>
  sql("UPDATE equipes SET nome = ?, tipo = ?, especialidade = ? WHERE id = ?").run(nome, tipo, especialidade, id).changes;

export const remove = (id) => sql("DELETE FROM equipes WHERE id = ?").run(id).changes;
