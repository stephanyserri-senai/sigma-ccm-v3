// Notas de manutenção (solicitações que viram OM).
import { sql } from "../connection.js";

export const listWithEquipment = () => sql(
  "SELECT n.*, e.tag AS equipamento FROM notas n LEFT JOIN equipamentos e ON e.id = n.equipamento_id ORDER BY n.id DESC",
).all();

export const findById = (id) => sql("SELECT * FROM notas WHERE id = ?").get(id);

// Maior número numérico já usado (ou null, se não houver notas).
export const maxNumero = () => sql("SELECT MAX(CAST(numero AS INTEGER)) m FROM notas").get().m;

export const create = ({ numero, equipamentoId, descricao, tipo, solicitanteId }) => sql(
  "INSERT INTO notas (numero, equipamento_id, descricao, tipo, status, solicitante_id) VALUES (?,?,?,?, 'Aberta', ?)",
).run(numero, equipamentoId, descricao, tipo, solicitanteId).lastInsertRowid;

export const markConverted = (id) => sql("UPDATE notas SET status = 'Em OM' WHERE id = ?").run(id);

export const countOpen = () => sql("SELECT COUNT(*) AS total FROM notas WHERE status = 'Aberta'").get().total;
