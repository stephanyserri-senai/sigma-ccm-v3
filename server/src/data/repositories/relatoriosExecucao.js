// Relatório de execução da OM (um por OM), com as durações de parada e reparo.
import { sql } from "../connection.js";

export const findByOrder = (ordemId) => sql(
  "SELECT id, usuario_id, atividade_realizada, resultado, materiais_utilizados, observacoes, indisponibilidade_horas, tempo_reparo_horas, atualizado_em FROM relatorios_execucao WHERE ordem_id = ?",
).get(ordemId);

// Cria ou substitui o relatório da OM. Devolve o id informado pelo banco.
export const upsert = ({ ordemId, usuarioId, atividade, resultado, materiais, observacoes, indisponibilidade, reparo }) => sql(`
  INSERT INTO relatorios_execucao
    (ordem_id, usuario_id, atividade_realizada, resultado, materiais_utilizados, observacoes, indisponibilidade_horas, tempo_reparo_horas, atualizado_em)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(ordem_id) DO UPDATE SET
    usuario_id = excluded.usuario_id,
    atividade_realizada = excluded.atividade_realizada,
    resultado = excluded.resultado,
    materiais_utilizados = excluded.materiais_utilizados,
    observacoes = excluded.observacoes,
    indisponibilidade_horas = excluded.indisponibilidade_horas,
    tempo_reparo_horas = excluded.tempo_reparo_horas,
    atualizado_em = datetime('now')
`).run(ordemId, usuarioId, atividade, resultado, materiais, observacoes, indisponibilidade, reparo).lastInsertRowid;
