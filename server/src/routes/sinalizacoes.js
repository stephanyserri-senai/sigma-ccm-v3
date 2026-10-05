import { Router } from "express";
import { parseJson } from "../formularios.js";

// Qualidade de dados: a IA sinaliza e sugere; a decisão (aceitar/rejeitar) é sempre humana (PCM/CCM).
export default function createSignalsRouter({ db, auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const gestao = requireRole("CCM", "PCM");
  const isManager = (req) => req.user.papel !== "EXECUTANTE";

  // Executante vê apenas as sinalizações dos apontamentos que ele mesmo registrou.
  const visibleSql = "(@gestao = 1 OR (s.entidade_tipo = 'apontamento' AND a.usuario_id = @usuario))";
  const select = `
    SELECT s.id, s.entidade_tipo, s.entidade_id, s.ordem_numero, s.campo, s.valor_atual, s.valor_sugerido, s.valor_aplicado,
           s.tipo, s.score, s.explicacao, s.status, s.criado_em, s.decidido_em, s.justificativa,
           o.id AS ordem_id, e.tag AS equipamento, a.tipo AS apontamento_tipo, a.data AS apontamento_data, a.hh_apropriado,
           au.nome AS apontado_por, d.nome AS decidido_por
    FROM sinalizacoes_ia s
    LEFT JOIN apontamentos a ON s.entidade_tipo = 'apontamento' AND a.id = s.entidade_id
    LEFT JOIN usuarios au ON au.id = a.usuario_id
    LEFT JOIN ordens o ON o.numero = s.ordem_numero
    LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    LEFT JOIN usuarios d ON d.id = s.decidido_por`;
  const present = ({ explicacao, ...row }) => ({ ...row, fatores: parseJson(explicacao, []) });
  const scope = (req) => ({ gestao: isManager(req) ? 1 : 0, usuario: req.user.id });

  router.get("/", (req, res) => {
    const status = ["Nova", "Aceita", "Rejeitada"].includes(req.query.status) ? req.query.status : null;
    res.json(db.prepare(`${select} WHERE ${visibleSql} AND (@status IS NULL OR s.status = @status) ORDER BY CASE s.status WHEN 'Nova' THEN 0 ELSE 1 END, s.id DESC`)
      .all({ ...scope(req), status }).map(present));
  });

  router.get("/contador", (req, res) => {
    res.json(db.prepare(`
      SELECT COUNT(*) AS novas FROM sinalizacoes_ia s
      LEFT JOIN apontamentos a ON s.entidade_tipo = 'apontamento' AND a.id = s.entidade_id
      WHERE s.status = 'Nova' AND ${visibleSql}
    `).get(scope(req)));
  });

  router.get("/:id", (req, res) => {
    const row = db.prepare(`${select} WHERE s.id = @id AND ${visibleSql}`).get({ ...scope(req), id: Number(req.params.id) });
    if (!row) return res.status(404).json({ error: "Sinalização não encontrada." });
    res.json(present(row));
  });

  const pending = (req, res) => {
    const signal = db.prepare("SELECT * FROM sinalizacoes_ia WHERE id = ?").get(req.params.id);
    if (!signal) { res.status(404).json({ error: "Sinalização não encontrada." }); return null; }
    if (signal.status !== "Nova") { res.status(409).json({ error: `Esta sinalização já foi ${signal.status.toLowerCase()}.` }); return null; }
    return signal;
  };
  const text = (value) => String(value ?? "").trim().slice(0, 1000) || null;

  // Aceitar: corrige o apontamento com o valor sugerido ou com o valor definido pela pessoa.
  router.post("/:id/aceitar", gestao, (req, res) => {
    const signal = pending(req, res);
    if (!signal) return;
    const body = req.body || {};
    const valor = body.valor === undefined || body.valor === null || body.valor === "" ? signal.valor_sugerido : Number(body.valor);
    if (!Number.isFinite(valor) || valor <= 0 || valor > 1000) return res.status(400).json({ error: "Informe um valor de HH válido (maior que zero)." });
    const justificativa = text(body.justificativa);
    db.transaction(() => {
      if (signal.entidade_tipo === "apontamento" && signal.entidade_id) {
        db.prepare("UPDATE apontamentos SET hh_apropriado = ? WHERE id = ?").run(valor, signal.entidade_id);
        // Apropriação feita pelo cronômetro: mantém o HH da execução coerente com o apontamento.
        db.prepare("UPDATE execucoes_om SET hh_calculado = ? WHERE apontamento_id = ?").run(valor, signal.entidade_id);
      }
      db.prepare(`
        UPDATE sinalizacoes_ia SET status = 'Aceita', valor_aplicado = ?, decidido_por = ?, decidido_em = datetime('now'), justificativa = ?
        WHERE id = ?
      `).run(valor, req.user.id, justificativa, signal.id);
      audit(req.user.id, "aceitar_sinal", "sinalizacao", signal.id,
        `OM ${signal.ordem_numero} · ${signal.tipo} · ${signal.campo}: ${signal.valor_atual} → ${valor}${valor !== signal.valor_sugerido ? ` (sugerido ${signal.valor_sugerido})` : ""}${justificativa ? ` · ${justificativa}` : ""}`);
    }).immediate();
    res.json({ ok: true, status: "Aceita", valor_aplicado: valor });
  });

  // Rejeitar: mantém o valor registrado; a justificativa é obrigatória para rastreabilidade.
  router.post("/:id/rejeitar", gestao, (req, res) => {
    const signal = pending(req, res);
    if (!signal) return;
    const justificativa = text((req.body || {}).justificativa);
    if (!justificativa) return res.status(400).json({ error: "Informe por que o valor registrado está correto." });
    db.transaction(() => {
      db.prepare("UPDATE sinalizacoes_ia SET status = 'Rejeitada', decidido_por = ?, decidido_em = datetime('now'), justificativa = ? WHERE id = ?")
        .run(req.user.id, justificativa, signal.id);
      audit(req.user.id, "rejeitar_sinal", "sinalizacao", signal.id,
        `OM ${signal.ordem_numero} · ${signal.tipo} · valor ${signal.valor_atual} mantido · ${justificativa}`);
    }).immediate();
    res.json({ ok: true, status: "Rejeitada" });
  });

  return router;
}
