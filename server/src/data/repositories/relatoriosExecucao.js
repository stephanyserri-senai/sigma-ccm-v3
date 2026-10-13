// Relatório de execução da OM (um por OM), com as durações de parada e reparo.
import { sql } from "../connection.js";

export const findByOrder = (ordemId) => sql(
  `SELECT id, usuario_id, atividade_realizada, resultado, materiais_utilizados, observacoes,
          indisponibilidade_horas, tempo_reparo_horas, atualizado_em, tarefas_executadas,
          materiais_estruturados, medicoes_testes, causa_falha, solucao_aplicada,
          anomalias_adicionais, condicao_final_ativo, equipamento_testado, apto_retorno_operacao
   FROM relatorios_execucao WHERE ordem_id = ?`,
).get(ordemId);

// Cria ou substitui o relatório da OM. Devolve o id informado pelo banco.
export const upsert = ({
  ordemId, usuarioId, atividade, resultado, materiais, observacoes, indisponibilidade, reparo,
  tarefas, materiaisEstruturados, medicoes, causa, solucao, anomalias, condicaoFinal, testado, aptoRetorno,
}) => sql(`
  INSERT INTO relatorios_execucao
    (ordem_id, usuario_id, atividade_realizada, resultado, materiais_utilizados, observacoes,
     indisponibilidade_horas, tempo_reparo_horas, atualizado_em, tarefas_executadas,
     materiais_estruturados, medicoes_testes, causa_falha, solucao_aplicada, anomalias_adicionais,
     condicao_final_ativo, equipamento_testado, apto_retorno_operacao)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
          ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(ordem_id) DO UPDATE SET
    usuario_id = excluded.usuario_id,
    atividade_realizada = excluded.atividade_realizada,
    resultado = excluded.resultado,
    materiais_utilizados = excluded.materiais_utilizados,
    observacoes = excluded.observacoes,
    indisponibilidade_horas = excluded.indisponibilidade_horas,
    tempo_reparo_horas = excluded.tempo_reparo_horas,
    tarefas_executadas = excluded.tarefas_executadas,
    materiais_estruturados = excluded.materiais_estruturados,
    medicoes_testes = excluded.medicoes_testes,
    causa_falha = excluded.causa_falha,
    solucao_aplicada = excluded.solucao_aplicada,
    anomalias_adicionais = excluded.anomalias_adicionais,
    condicao_final_ativo = excluded.condicao_final_ativo,
    equipamento_testado = excluded.equipamento_testado,
    apto_retorno_operacao = excluded.apto_retorno_operacao,
    atualizado_em = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
`).insert(
  ordemId, usuarioId, atividade, resultado, materiais, observacoes, indisponibilidade, reparo,
  JSON.stringify(tarefas ?? []), JSON.stringify(materiaisEstruturados ?? []), JSON.stringify(medicoes ?? []),
  causa, solucao, anomalias, condicaoFinal, testado, aptoRetorno,
);
