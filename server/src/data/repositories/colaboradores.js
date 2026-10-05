// Colaboradores. Colaborador = usuário: cada usuário tem uma linha aqui, que serve de
// ponte para as chaves estrangeiras de ocorrências de HH e apontamentos antigos.
import { db, sql } from "../connection.js";

// Cria o vínculo para todo usuário que ainda não tem colaborador.
export const USER_COLLABORATOR_SYNC_SQL = `
  INSERT INTO colaboradores (nome, equipe_id, usuario_id)
  SELECT u.nome, u.equipe_id, u.id FROM usuarios u
  WHERE NOT EXISTS (SELECT 1 FROM colaboradores c WHERE c.usuario_id = u.id)
`;
export const syncFromUsers = () => db.exec(USER_COLLABORATOR_SYNC_SQL);

// Usuários ativos como colaboradores (o id é o do vínculo em colaboradores).
export const listActiveUsers = () => sql(`
  SELECT MIN(c.id) AS id, u.nome FROM usuarios u JOIN colaboradores c ON c.usuario_id = u.id
  WHERE u.ativo = 1 GROUP BY u.id ORDER BY u.nome
`).all();

// Pessoas (usuários ativos) de uma equipe.
export const listTeamMembers = (equipeId) => sql(`
  SELECT MIN(c.id) AS id, u.nome, u.username
  FROM usuarios u JOIN colaboradores c ON c.usuario_id = u.id
  WHERE u.equipe_id = ? AND u.ativo = 1 GROUP BY u.id ORDER BY u.nome
`).all(equipeId);

export const listWithTeamAndUser = () => sql(`
  SELECT c.*, e.nome AS equipe, u.username
  FROM colaboradores c
  LEFT JOIN equipes e ON e.id = c.equipe_id
  LEFT JOIN usuarios u ON u.id = c.usuario_id
  ORDER BY c.nome
`).all();

// Colaborador vinculado a usuário, com a equipe atual do usuário.
export const findWithUserTeam = (id) => sql(`
  SELECT c.id, u.equipe_id FROM colaboradores c JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = ?
`).get(id);

export const create = ({ nome, matricula, especialidade, equipeId, usuarioId }) => sql(`
  INSERT INTO colaboradores (nome, matricula, especialidade, equipe_id, usuario_id)
  VALUES (?, ?, ?, ?, ?)
`).run(nome, matricula, especialidade, equipeId, usuarioId).lastInsertRowid;

export const update = (id, { nome, matricula, especialidade, equipeId, usuarioId }) => sql(`
  UPDATE colaboradores SET nome = ?, matricula = ?, especialidade = ?, equipe_id = ?, usuario_id = ?
  WHERE id = ?
`).run(nome, matricula, especialidade, equipeId, usuarioId, id).changes;

export const remove = (id) => sql("DELETE FROM colaboradores WHERE id = ?").run(id).changes;

// Mantém a equipe do vínculo principal igual à do usuário.
export const updateTeamForUser = (usuarioId, equipeId) =>
  sql("UPDATE colaboradores SET equipe_id = ? WHERE id = (SELECT MIN(id) FROM colaboradores WHERE usuario_id = ?)").run(equipeId, usuarioId);
