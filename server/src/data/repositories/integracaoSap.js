import { sql } from "../connection.js";

export const enqueue = ({ ordemId, payload }) => sql(`
  INSERT INTO integracoes_sap_fila (ordem_id, status, payload, proxima_tentativa, atualizado_em)
  VALUES (?, 'PENDENTE', ?::jsonb, to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
          to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  ON CONFLICT (ordem_id) DO UPDATE SET
    payload = excluded.payload,
    status = CASE WHEN integracoes_sap_fila.status IN ('ENVIADO_AO_SAP','REGISTRO_DUPLICADO') THEN integracoes_sap_fila.status ELSE 'PENDENTE' END,
    proxima_tentativa = CASE WHEN integracoes_sap_fila.status IN ('ENVIADO_AO_SAP','REGISTRO_DUPLICADO') THEN integracoes_sap_fila.proxima_tentativa ELSE excluded.proxima_tentativa END,
    atualizado_em = excluded.atualizado_em
  RETURNING id
`).insert(ordemId, JSON.stringify(payload));

export const findByOrder = (ordemId) => sql("SELECT * FROM integracoes_sap_fila WHERE ordem_id = ?").get(ordemId);

export const list = () => sql(`
  SELECT f.id, f.ordem_id, o.numero AS numero_ordem, f.status, f.tentativas, f.proxima_tentativa,
         f.ultimo_erro, f.criado_em, f.atualizado_em, o.sap_enviado_em
  FROM integracoes_sap_fila f JOIN ordens o ON o.id = f.ordem_id
  ORDER BY f.id DESC LIMIT 200
`).all();

export const listClosedOrders = () =>
  sql("SELECT id, numero FROM ordens WHERE status = 'Encerrada' ORDER BY id").all();

export const claim = (id) => sql(`
  UPDATE integracoes_sap_fila
  SET status = 'PROCESSANDO', tentativas = tentativas + 1,
      atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  WHERE id = ? AND status IN ('PENDENTE','ERRO')
    AND (proxima_tentativa IS NULL OR proxima_tentativa <= to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  RETURNING *
`).get(id);

export const finish = (id, { status, erro = null, proximaTentativa = null }) => sql(`
  UPDATE integracoes_sap_fila SET status = ?, ultimo_erro = ?, proxima_tentativa = ?,
    atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  WHERE id = ?
`).run(status, erro, proximaTentativa, id);

export const setOrderStatus = (ordemId, status, erro = null) => sql(`
  UPDATE ordens SET sap_status = ?, sap_ultimo_erro = ?, sap_enviado_em =
    CASE WHEN ? IN ('ENVIADO_AO_SAP','REGISTRO_DUPLICADO') THEN to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') ELSE sap_enviado_em END
  WHERE id = ?
`).run(status, erro, status, ordemId);

export const log = ({ ordemId, tentativa, status, codigoHttp = null, resposta = null }) => sql(`
  INSERT INTO integracoes_sap_logs (ordem_id, tentativa, status, codigo_http, resposta)
  VALUES (?, ?, ?, ?, ?)
`).run(ordemId, tentativa, status, codigoHttp, resposta ? String(resposta).slice(0, 4000) : null);

export const findOrderForPayload = (ordemId) => sql(`
  SELECT o.id, o.numero, o.data_encerramento, o.responsavel_id,
         u.nome AS executante_nome, c.matricula AS executante_matricula,
         COALESCE((SELECT SUM(a.hh_apropriado) FROM apontamentos a
                   WHERE a.ordem_id = o.id AND a.tipo = 'Apropriação'), 0) AS hh_apropriado,
         COALESCE((SELECT string_agg(a.descricao, E'\\n' ORDER BY a.id)
                   FROM apontamentos a WHERE a.ordem_id = o.id AND a.descricao IS NOT NULL), '') AS apontamentos_observacoes,
         r.observacoes, r.atividade_realizada, r.resultado
  FROM ordens o
  LEFT JOIN usuarios u ON u.id = o.responsavel_id
  LEFT JOIN colaboradores c ON c.id = (SELECT MIN(c2.id) FROM colaboradores c2 WHERE c2.usuario_id = o.responsavel_id)
  LEFT JOIN relatorios_execucao r ON r.ordem_id = o.id
  WHERE o.id = ?
`).get(ordemId);

export const listEvidenceForPayload = (ordemId) => sql(`
  SELECT id, nome_arquivo, tipo_mime, conteudo FROM evidencias_om WHERE ordem_id = ? ORDER BY id
`).all(ordemId);
