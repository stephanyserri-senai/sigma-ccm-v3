// Respostas guardadas dos envios da fila offline (X-Idempotency-Key), mantidas por 30 dias.
import { sql } from "../connection.js";

export const purgeExpired = () =>
  sql("DELETE FROM requisicoes_idempotentes WHERE criado_em < to_char(clock_timestamp() AT TIME ZONE 'UTC' - interval '30 days', 'YYYY-MM-DD HH24:MI:SS')").run();

export const find = (chave) => sql("SELECT usuario_id, status, resposta FROM requisicoes_idempotentes WHERE chave = ?").get(chave);

export const save = ({ chave, usuarioId, metodo, rota, status, resposta }) => sql(`
  INSERT INTO requisicoes_idempotentes (chave, usuario_id, metodo, rota, status, resposta) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT DO NOTHING
`).run(chave, usuarioId, metodo, rota, status, resposta);
