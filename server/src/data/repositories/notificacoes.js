// Notificações de eventos críticos, leituras, destinatários (encaminhamentos) e ações.
// `quem` = { papel, usuario }: a pessoa que consulta (define o que ela pode ver).
import { sql } from "../connection.js";

// Visibilidade: perfil do usuário, destinatário direto ou encaminhamento.
const VISIBLE = `(
  (',' || n.papeis || ',') LIKE '%,' || @papel || ',%'
  OR n.usuario_id = @usuario
  OR EXISTS (SELECT 1 FROM notificacoes_destinatarios d WHERE d.notificacao_id = n.id AND d.usuario_id = @usuario)
)`;
const UNREAD = "NOT EXISTS (SELECT 1 FROM notificacoes_leituras l WHERE l.notificacao_id = n.id AND l.usuario_id = @usuario)";
const SEVERITY_ORDER = "CASE n.severidade WHEN 'Crítica' THEN 0 WHEN 'Alta' THEN 1 WHEN 'Média' THEN 2 ELSE 3 END";
const STATUS_SQL = { abertas: "n.status <> 'Resolvida'", resolvidas: "n.status = 'Resolvida'", todas: "1 = 1" };

// ---------------------------------------------------------------- Geração automática
// Cria o evento ou atualiza o que mudou (sem reabrir resolvidas). Devolve as linhas alteradas.
export const upsertEvent = (event, papeis) => sql(`
  INSERT INTO notificacoes (chave, tipo, severidade, titulo, mensagem, entidade, entidade_id, link, papeis, usuario_id)
  VALUES (@chave, @tipo, @severidade, @titulo, @mensagem, @entidade, @entidade_id, @link, '${papeis}', @usuario_id)
  ON CONFLICT(chave) DO UPDATE SET
    severidade = excluded.severidade, titulo = excluded.titulo, mensagem = excluded.mensagem,
    usuario_id = excluded.usuario_id, atualizada_em = datetime('now')
  WHERE notificacoes.status <> 'Resolvida'
    AND (notificacoes.mensagem <> excluded.mensagem OR notificacoes.severidade <> excluded.severidade
         OR COALESCE(notificacoes.usuario_id, 0) <> COALESCE(excluded.usuario_id, 0))
`).run(event).changes;

export const listOpenOfTypes = (tipos) => sql(`
  SELECT id, chave FROM notificacoes WHERE status <> 'Resolvida' AND tipo IN (${tipos.map(() => "?").join(",")})
`).all(...tipos);

export const resolveAutomatically = (id) => sql(`
  UPDATE notificacoes SET status = 'Resolvida', resolvida_em = datetime('now'),
         resolucao = 'Resolvida automaticamente: a condição deixou de existir.'
  WHERE id = ?
`).run(id).changes;

// ---------------------------------------------------------------- Consulta
export const countUnread = (quem) => sql(`
  SELECT COUNT(*) AS nao_lidas, COALESCE(SUM(n.severidade = 'Crítica'), 0) AS criticas
  FROM notificacoes n WHERE n.status <> 'Resolvida' AND ${VISIBLE} AND ${UNREAD}
`).get(quem);

export const countUnreadTotal = (quem) => sql(`
  SELECT COUNT(*) AS total FROM notificacoes n
  WHERE n.status <> 'Resolvida' AND ${VISIBLE}
    AND NOT EXISTS (SELECT 1 FROM notificacoes_leituras l WHERE l.notificacao_id = n.id AND l.usuario_id = @usuario)
`).get(quem).total;

// `status`: abertas | resolvidas | todas; `severidade` opcional; `naoLidas` restringe às não lidas.
export const list = (quem, { status, severidade, naoLidas }) => sql(`
  SELECT n.id, n.tipo, n.severidade, n.titulo, n.mensagem, n.entidade, n.entidade_id, n.link, n.status,
         n.criada_em, n.atualizada_em, n.resolvida_em, n.resolucao, r.nome AS resolvida_por,
         NOT ${UNREAD} AS lida,
         (SELECT COUNT(*) FROM notificacoes_acoes a WHERE a.notificacao_id = n.id) AS acoes
  FROM notificacoes n LEFT JOIN usuarios r ON r.id = n.resolvida_por
  WHERE ${STATUS_SQL[status]} AND ${VISIBLE} AND (@severidade IS NULL OR n.severidade = @severidade)
    AND (@naoLidas = 0 OR ${UNREAD})
  ORDER BY ${SEVERITY_ORDER}, n.id DESC LIMIT 300
`).all({ ...quem, severidade, naoLidas: naoLidas ? 1 : 0 });

export const countBySeverity = (quem, status) => sql(`
  SELECT n.severidade, COUNT(*) AS total FROM notificacoes n WHERE ${STATUS_SQL[status]} AND ${VISIBLE} GROUP BY n.severidade
`).all(quem);

export const findVisible = (quem, id) => sql(`SELECT n.* FROM notificacoes n WHERE n.id = @id AND ${VISIBLE}`).get({ ...quem, id });

export const listActions = (id) => sql(`
  SELECT a.id, a.tipo, a.texto, a.criado_em, u.nome AS usuario, d.nome AS destinatario
  FROM notificacoes_acoes a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN usuarios d ON d.id = a.destinatario_id
  WHERE a.notificacao_id = ? ORDER BY a.id
`).all(id);

export const listForwardedTo = (id) => sql(`
  SELECT u.nome FROM notificacoes_destinatarios d JOIN usuarios u ON u.id = d.usuario_id WHERE d.notificacao_id = ? ORDER BY d.incluido_em
`).all(id).map((item) => item.nome);

// ---------------------------------------------------------------- Leitura e tratamento
export const markAllRead = (quem) => sql(`
  INSERT OR IGNORE INTO notificacoes_leituras (notificacao_id, usuario_id)
  SELECT n.id, @usuario FROM notificacoes n WHERE n.status <> 'Resolvida' AND ${VISIBLE}
`).run(quem).changes;

export const markRead = (id, usuarioId) =>
  sql("INSERT OR IGNORE INTO notificacoes_leituras (notificacao_id, usuario_id) VALUES (?, ?)").run(id, usuarioId);

export const markUnread = (id, usuarioId) =>
  sql("DELETE FROM notificacoes_leituras WHERE notificacao_id = ? AND usuario_id = ?").run(id, usuarioId);

export const addAction = ({ id, usuarioId, tipo, texto }) =>
  sql("INSERT INTO notificacoes_acoes (notificacao_id, usuario_id, tipo, texto) VALUES (?, ?, ?, ?)").run(id, usuarioId, tipo, texto);

export const addForwardAction = ({ id, usuarioId, texto, destinatarioId }) =>
  sql("INSERT INTO notificacoes_acoes (notificacao_id, usuario_id, tipo, texto, destinatario_id) VALUES (?, ?, 'Encaminhamento', ?, ?)")
    .run(id, usuarioId, texto, destinatarioId);

export const addRecipient = ({ id, usuarioId, incluidoPor }) =>
  sql("INSERT OR IGNORE INTO notificacoes_destinatarios (notificacao_id, usuario_id, incluido_por) VALUES (?, ?, ?)").run(id, usuarioId, incluidoPor);

export const resolve = (id, { usuarioId, resolucao }) =>
  sql("UPDATE notificacoes SET status = 'Resolvida', resolvida_em = datetime('now'), resolvida_por = ?, resolucao = ? WHERE id = ?")
    .run(usuarioId, resolucao, id);

export const markInTreatment = (id) =>
  sql("UPDATE notificacoes SET status = 'Em tratamento', atualizada_em = datetime('now') WHERE id = ?").run(id);
