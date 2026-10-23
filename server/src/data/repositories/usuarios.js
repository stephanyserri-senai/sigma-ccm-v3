// Usuários (login, perfis e vínculo com equipe). Colaborador = usuário (ver colaboradores.js).
import { sql } from "../connection.js";

export const findActiveByUsername = (username) =>
  sql("SELECT * FROM usuarios WHERE username = ? AND ativo = 1").get(username);

export const findIdByUsername = (username) =>
  sql("SELECT id FROM usuarios WHERE username = ?").get(username);

export const findProfile = (id) => sql(`
  SELECT u.id, u.nome, u.papel, u.username, u.email, u.equipe_id, e.nome AS equipe
  FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id WHERE u.id = ?
`).get(id);

export const findNameAndTeam = (id) => sql(`
  SELECT u.nome, e.nome AS equipe FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id WHERE u.id = ?
`).get(id);

export const findNameAndRole = (id) => sql("SELECT nome, papel FROM usuarios WHERE id = ?").get(id);

export const findTeamId = (id) => sql("SELECT equipe_id FROM usuarios WHERE id = ?").scalar("equipe_id", id);

export const findActive = (id) => sql("SELECT id, nome FROM usuarios WHERE id = ? AND ativo = 1").get(id);

export const findActiveExecutante = (id) =>
  sql("SELECT id FROM usuarios WHERE id = ? AND papel = 'EXECUTANTE' AND ativo = 1").get(id);

export const listWithTeam = () => sql(`
  SELECT u.id, u.nome, u.email, u.username, u.papel, u.ativo, u.criado_em, u.equipe_id, e.nome AS equipe
  FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id ORDER BY u.id
`).all();

export const listActiveExecutantes = () =>
  sql("SELECT id, nome, username FROM usuarios WHERE papel = 'EXECUTANTE' AND ativo = 1 ORDER BY nome").all();

// Executantes ativos com a equipe (candidatos da atribuição automática de OMs).
export const listExecutantesWithTeam = () =>
  sql("SELECT id, nome, equipe_id FROM usuarios WHERE papel = 'EXECUTANTE' AND ativo = 1 ORDER BY nome, id").all();

// Destinatários de encaminhamento: usuários ativos, exceto quem encaminha.
export const listActiveExcept = (id) => sql(`
  SELECT u.id, u.nome, u.papel, e.nome AS equipe FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id
  WHERE u.ativo = 1 AND u.id <> ? ORDER BY u.nome
`).all(id);

export const countAll = () => sql("SELECT COUNT(*) AS total FROM usuarios").scalar("total");

export function create({ nome, email = null, username, senhaHash, papel, equipeId = null }) {
  return sql("INSERT INTO usuarios (nome, email, username, senha_hash, papel, equipe_id) VALUES (?,?,?,?,?,?)")
    .insert(nome, email, username, senhaHash, papel, equipeId);
}

// Devolve o número de linhas alteradas (0 = usuário inexistente).
export const updateTeam = (id, equipeId) =>
  sql("UPDATE usuarios SET equipe_id = ? WHERE id = ?").affected(equipeId, id);
