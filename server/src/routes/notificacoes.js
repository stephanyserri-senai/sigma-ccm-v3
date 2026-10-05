import { Router } from "express";
import { SEVERIDADES, VISIBLE_SQL, generateNotifications } from "../notificacoes.js";

const SEVERITY_ORDER = `CASE n.severidade WHEN 'Crítica' THEN 0 WHEN 'Alta' THEN 1 WHEN 'Média' THEN 2 ELSE 3 END`;

export default function createNotificationsRouter({ db, auth, audit }) {
  const router = Router();
  router.use(auth);
  const isManager = (req) => req.user.papel !== "EXECUTANTE";
  const who = (req) => ({ papel: req.user.papel, usuario: req.user.id });
  const unreadSql = "NOT EXISTS (SELECT 1 FROM notificacoes_leituras l WHERE l.notificacao_id = n.id AND l.usuario_id = @usuario)";

  const findVisible = (req) => db.prepare(`SELECT n.* FROM notificacoes n WHERE n.id = @id AND ${VISIBLE_SQL}`)
    .get({ ...who(req), id: Number(req.params.id) });

  router.get("/contador", (req, res) => {
    generateNotifications(db);
    res.json(db.prepare(`
      SELECT COUNT(*) AS nao_lidas, COALESCE(SUM(n.severidade = 'Crítica'), 0) AS criticas
      FROM notificacoes n WHERE n.status <> 'Resolvida' AND ${VISIBLE_SQL} AND ${unreadSql}
    `).get(who(req)));
  });

  router.get("/", (req, res) => {
    generateNotifications(db);
    const status = ["abertas", "resolvidas", "todas"].includes(req.query.status) ? req.query.status : "abertas";
    const severidade = SEVERIDADES.includes(req.query.severidade) ? req.query.severidade : null;
    const statusSql = status === "abertas" ? "n.status <> 'Resolvida'" : status === "resolvidas" ? "n.status = 'Resolvida'" : "1 = 1";
    const params = { ...who(req), severidade };
    const itens = db.prepare(`
      SELECT n.id, n.tipo, n.severidade, n.titulo, n.mensagem, n.entidade, n.entidade_id, n.link, n.status,
             n.criada_em, n.atualizada_em, n.resolvida_em, n.resolucao, r.nome AS resolvida_por,
             NOT ${unreadSql} AS lida,
             (SELECT COUNT(*) FROM notificacoes_acoes a WHERE a.notificacao_id = n.id) AS acoes
      FROM notificacoes n LEFT JOIN usuarios r ON r.id = n.resolvida_por
      WHERE ${statusSql} AND ${VISIBLE_SQL} AND (@severidade IS NULL OR n.severidade = @severidade)
        AND (@naoLidas = 0 OR ${unreadSql})
      ORDER BY ${SEVERITY_ORDER}, n.id DESC LIMIT 300
    `).all({ ...params, naoLidas: req.query.nao_lidas === "1" ? 1 : 0 }).map((row) => ({ ...row, lida: Boolean(row.lida) }));
    const contagem = Object.fromEntries(SEVERIDADES.map((item) => [item, 0]));
    for (const row of db.prepare(`
      SELECT n.severidade, COUNT(*) AS total FROM notificacoes n WHERE ${statusSql} AND ${VISIBLE_SQL} GROUP BY n.severidade
    `).all(who(req))) contagem[row.severidade] = row.total;
    res.json({ itens, contagem, status });
  });

  router.get("/destinatarios", (req, res) => {
    res.json(db.prepare(`
      SELECT u.id, u.nome, u.papel, e.nome AS equipe FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id
      WHERE u.ativo = 1 AND u.id <> ? ORDER BY u.nome
    `).all(req.user.id));
  });

  router.get("/:id", (req, res) => {
    const row = findVisible(req);
    if (!row) return res.status(404).json({ error: "Notificação não encontrada." });
    res.json({
      ...row,
      acoes: db.prepare(`
        SELECT a.id, a.tipo, a.texto, a.criado_em, u.nome AS usuario, d.nome AS destinatario
        FROM notificacoes_acoes a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN usuarios d ON d.id = a.destinatario_id
        WHERE a.notificacao_id = ? ORDER BY a.id
      `).all(row.id),
      encaminhada_para: db.prepare(`
        SELECT u.nome FROM notificacoes_destinatarios d JOIN usuarios u ON u.id = d.usuario_id WHERE d.notificacao_id = ? ORDER BY d.incluido_em
      `).all(row.id).map((item) => item.nome),
    });
  });

  router.post("/lidas", (req, res) => {
    const info = db.prepare(`
      INSERT OR IGNORE INTO notificacoes_leituras (notificacao_id, usuario_id)
      SELECT n.id, @usuario FROM notificacoes n WHERE n.status <> 'Resolvida' AND ${VISIBLE_SQL}
    `).run(who(req));
    res.json({ marcadas: info.changes });
  });

  router.post("/:id/lida", (req, res) => {
    const row = findVisible(req);
    if (!row) return res.status(404).json({ error: "Notificação não encontrada." });
    db.prepare("INSERT OR IGNORE INTO notificacoes_leituras (notificacao_id, usuario_id) VALUES (?, ?)").run(row.id, req.user.id);
    res.json({ ok: true });
  });

  // Responder: registra a ação tomada; PCM/CCM podem também marcar o evento como resolvido.
  router.post("/:id/responder", (req, res) => {
    const row = findVisible(req);
    if (!row) return res.status(404).json({ error: "Notificação não encontrada." });
    const texto = String((req.body || {}).texto || "").trim().slice(0, 2000);
    if (!texto) return res.status(400).json({ error: "Descreva a resposta ou a ação tomada." });
    const resolver = Boolean(req.body.resolver);
    if (resolver && !isManager(req)) return res.status(403).json({ error: "Somente PCM ou CCM resolvem notificações." });
    if (row.status === "Resolvida") return res.status(409).json({ error: "A notificação já foi resolvida." });
    db.transaction(() => {
      db.prepare("INSERT INTO notificacoes_acoes (notificacao_id, usuario_id, tipo, texto) VALUES (?, ?, ?, ?)")
        .run(row.id, req.user.id, resolver ? "Resolução" : "Resposta", texto);
      if (resolver) {
        db.prepare("UPDATE notificacoes SET status = 'Resolvida', resolvida_em = datetime('now'), resolvida_por = ?, resolucao = ? WHERE id = ?").run(req.user.id, texto, row.id);
      } else {
        db.prepare("UPDATE notificacoes SET status = 'Em tratamento', atualizada_em = datetime('now') WHERE id = ?").run(row.id);
      }
      db.prepare("INSERT OR IGNORE INTO notificacoes_leituras (notificacao_id, usuario_id) VALUES (?, ?)").run(row.id, req.user.id);
      audit(req.user.id, resolver ? "resolver_notificacao" : "responder_notificacao", "notificacao", row.id, `${row.tipo} · ${row.titulo} · ${texto.slice(0, 200)}`);
    }).immediate();
    res.json({ ok: true, status: resolver ? "Resolvida" : "Em tratamento" });
  });

  // Encaminhar: o destinatário passa a ver o evento como não lido.
  router.post("/:id/encaminhar", (req, res) => {
    const row = findVisible(req);
    if (!row) return res.status(404).json({ error: "Notificação não encontrada." });
    if (row.status === "Resolvida") return res.status(409).json({ error: "A notificação já foi resolvida." });
    const target = db.prepare("SELECT id, nome FROM usuarios WHERE id = ? AND ativo = 1").get(Number((req.body || {}).usuario_id));
    if (!target || target.id === req.user.id) return res.status(400).json({ error: "Selecione um usuário ativo para encaminhar." });
    const texto = String(req.body.texto || "").trim().slice(0, 2000) || null;
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO notificacoes_destinatarios (notificacao_id, usuario_id, incluido_por) VALUES (?, ?, ?)").run(row.id, target.id, req.user.id);
      db.prepare("DELETE FROM notificacoes_leituras WHERE notificacao_id = ? AND usuario_id = ?").run(row.id, target.id);
      db.prepare("INSERT INTO notificacoes_acoes (notificacao_id, usuario_id, tipo, texto, destinatario_id) VALUES (?, ?, 'Encaminhamento', ?, ?)")
        .run(row.id, req.user.id, texto, target.id);
      audit(req.user.id, "encaminhar_notificacao", "notificacao", row.id, `${row.titulo} → ${target.nome}${texto ? ` · ${texto.slice(0, 200)}` : ""}`);
    }).immediate();
    res.json({ ok: true, encaminhada_para: target.nome });
  });

  return router;
}
