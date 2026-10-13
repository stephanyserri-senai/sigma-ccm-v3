// Parâmetros e metas dos KPIs em vigor (chave → valor).
import { sql } from "../connection.js";

export const listValues = () => sql("SELECT chave, valor FROM parametros_kpi").all();

export const listUpdates = () => sql(`
  SELECT p.chave, p.atualizado_em, u.nome AS atualizado_por
  FROM parametros_kpi p LEFT JOIN usuarios u ON u.id = p.atualizado_por
`).all();

export const upsert = (chave, valor, usuarioId) => sql(`
  INSERT INTO parametros_kpi (chave, valor, atualizado_por, atualizado_em) VALUES (?, ?, ?, to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
`).run(chave, valor, usuarioId);

// Cria os parâmetros que ainda não existem com o valor padrão (os existentes não mudam).
export const insertMissing = async (parametros) => {
  const insert = sql("INSERT INTO parametros_kpi (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO NOTHING");
  for (const item of parametros) await insert.run(item.chave, item.padrao);
};
