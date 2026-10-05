import { Router } from "express";
import { notificacoesRepo, transaction, usuariosRepo } from "../data/index.js";
import { SEVERIDADES, generateNotifications } from "../notificacoes.js";

export default function createNotificationsRouter({ auth, audit }) {
  const router = Router();
  router.use(auth);
  const isManager = (req) => req.user.papel !== "EXECUTANTE";
  const who = (req) => ({ papel: req.user.papel, usuario: req.user.id });

  const findVisible = (req) => notificacoesRepo.findVisible(who(req), Number(req.params.id));

  router.get("/contador", (req, res) => {
    generateNotifications();
    res.json(notificacoesRepo.countUnread(who(req)));
  });

  router.get("/", (req, res) => {
    generateNotifications();
    const status = ["abertas", "resolvidas", "todas"].includes(req.query.status) ? req.query.status : "abertas";
    const severidade = SEVERIDADES.includes(req.query.severidade) ? req.query.severidade : null;
    const itens = notificacoesRepo.list(who(req), { status, severidade, naoLidas: req.query.nao_lidas === "1" })
      .map((row) => ({ ...row, lida: Boolean(row.lida) }));
    const contagem = Object.fromEntries(SEVERIDADES.map((item) => [item, 0]));
    for (const row of notificacoesRepo.countBySeverity(who(req), status)) contagem[row.severidade] = row.total;
    res.json({ itens, contagem, status });
  });

  router.get("/destinatarios", (req, res) => {
    res.json(usuariosRepo.listActiveExcept(req.user.id));
  });

  router.get("/:id", (req, res) => {
    const row = findVisible(req);
    if (!row) return res.status(404).json({ error: "Notificação não encontrada." });
    res.json({
      ...row,
      acoes: notificacoesRepo.listActions(row.id),
      encaminhada_para: notificacoesRepo.listForwardedTo(row.id),
    });
  });

  router.post("/lidas", (req, res) => {
    res.json({ marcadas: notificacoesRepo.markAllRead(who(req)) });
  });

  router.post("/:id/lida", (req, res) => {
    const row = findVisible(req);
    if (!row) return res.status(404).json({ error: "Notificação não encontrada." });
    notificacoesRepo.markRead(row.id, req.user.id);
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
    transaction(() => {
      notificacoesRepo.addAction({ id: row.id, usuarioId: req.user.id, tipo: resolver ? "Resolução" : "Resposta", texto });
      if (resolver) notificacoesRepo.resolve(row.id, { usuarioId: req.user.id, resolucao: texto });
      else notificacoesRepo.markInTreatment(row.id);
      notificacoesRepo.markRead(row.id, req.user.id);
      audit(req.user.id, resolver ? "resolver_notificacao" : "responder_notificacao", "notificacao", row.id, `${row.tipo} · ${row.titulo} · ${texto.slice(0, 200)}`);
    });
    res.json({ ok: true, status: resolver ? "Resolvida" : "Em tratamento" });
  });

  // Encaminhar: o destinatário passa a ver o evento como não lido.
  router.post("/:id/encaminhar", (req, res) => {
    const row = findVisible(req);
    if (!row) return res.status(404).json({ error: "Notificação não encontrada." });
    if (row.status === "Resolvida") return res.status(409).json({ error: "A notificação já foi resolvida." });
    const target = usuariosRepo.findActive(Number((req.body || {}).usuario_id));
    if (!target || target.id === req.user.id) return res.status(400).json({ error: "Selecione um usuário ativo para encaminhar." });
    const texto = String(req.body.texto || "").trim().slice(0, 2000) || null;
    transaction(() => {
      notificacoesRepo.addRecipient({ id: row.id, usuarioId: target.id, incluidoPor: req.user.id });
      notificacoesRepo.markUnread(row.id, target.id);
      notificacoesRepo.addForwardAction({ id: row.id, usuarioId: req.user.id, texto, destinatarioId: target.id });
      audit(req.user.id, "encaminhar_notificacao", "notificacao", row.id, `${row.titulo} → ${target.nome}${texto ? ` · ${texto.slice(0, 200)}` : ""}`);
    });
    res.json({ ok: true, encaminhada_para: target.nome });
  });

  return router;
}
