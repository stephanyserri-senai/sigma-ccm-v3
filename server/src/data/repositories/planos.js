// Planos de manutenção preventiva.
import { sql } from "../connection.js";

export const listForSelect = () => sql(`
  SELECT p.id, p.descricao, p.periodicidade, p.equipamento_id, e.tag AS equipamento
  FROM planos_preventivos p LEFT JOIN equipamentos e ON e.id = p.equipamento_id ORDER BY p.descricao
`).all();

export const listWithOrders = () => sql(`
        SELECT p.*, e.tag AS equipamento, eq.nome AS equipe,
          (SELECT string_agg(o.numero, ', ') FROM ordens o WHERE o.plano_id = p.id) AS oms_geradas
  FROM planos_preventivos p LEFT JOIN equipamentos e ON e.id = p.equipamento_id
  LEFT JOIN equipes eq ON eq.id = p.equipe_id
  ORDER BY p.id DESC
`).all();

export const findById = (id) => sql("SELECT * FROM planos_preventivos WHERE id = ?").get(id);
export const exists = (id) => sql("SELECT 1 FROM planos_preventivos WHERE id = ?").exists(id);

// Planos com próxima data até `limite` e sem OM em aberto gerada por eles (notificações).
export const listDueWithoutOpenOrder = (limite) => sql(`
  SELECT p.id, p.descricao, p.proxima_data, e.tag, e.criticidade
  FROM planos_preventivos p LEFT JOIN equipamentos e ON e.id = p.equipamento_id
  WHERE p.proxima_data ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND p.proxima_data <= ?
    AND NOT EXISTS (SELECT 1 FROM ordens o WHERE o.plano_id = p.id AND o.status NOT IN ('Encerrada','Cancelada'))
`).all(limite);

export const create = ({ equipamentoId, descricao, periodicidade, proximaData, equipeId }) => sql(`
  INSERT INTO planos_preventivos (equipamento_id, descricao, periodicidade, proxima_data, equipe_id)
  VALUES (?, ?, ?, ?, ?)
`).insert(equipamentoId, descricao, periodicidade, proximaData, equipeId);

export const update = (id, { equipamentoId, descricao, periodicidade, proximaData, equipeId }) => sql(`
  UPDATE planos_preventivos SET equipamento_id = ?, descricao = ?, periodicidade = ?, proxima_data = ?, equipe_id = ?
  WHERE id = ?
`).affected(equipamentoId, descricao, periodicidade, proximaData, equipeId, id);

export const remove = (id) => sql("DELETE FROM planos_preventivos WHERE id = ?").affected(id);
