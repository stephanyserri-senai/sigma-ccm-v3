// Parâmetros e metas dos KPIs em vigor (chave → valor).
import { sql } from "../connection.js";

export const listValues = () => sql("SELECT chave, valor FROM parametros_kpi").all();

export const listUpdates = () => sql(`
  SELECT p.chave, p.atualizado_em, u.nome AS atualizado_por
  FROM parametros_kpi p LEFT JOIN usuarios u ON u.id = p.atualizado_por
`).all();

export const upsert = (chave, valor, usuarioId) => sql(`
  INSERT INTO parametros_kpi (chave, valor, atualizado_por, atualizado_em) VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = datetime('now')
`).run(chave, valor, usuarioId);

// Cria os parâmetros que ainda não existem com o valor padrão (os existentes não mudam).
export const insertMissing = (parametros) => {
  const insert = sql("INSERT OR IGNORE INTO parametros_kpi (chave, valor) VALUES (?, ?)");
  parametros.forEach((item) => insert.run(item.chave, item.padrao));
};
