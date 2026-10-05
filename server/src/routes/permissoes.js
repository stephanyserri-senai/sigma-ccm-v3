import { Router } from "express";
import { parseJson } from "../formularios.js";
import { activeModel, evaluateRequest, formUpload, insertResponse, submissionData, uploadErrors } from "../formularios-envio.js";

const MAX_HORAS = 24;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const pad = (value) => String(value).padStart(2, "0");

// Data e hora locais no formato do campo datetime-local (AAAA-MM-DDTHH:MM).
export function localDateTime(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A OM pode ser executada se não exige PT ou se há PT aprovada dentro da validade.
export function validPermit(db, orderId) {
  const now = localDateTime();
  return db.prepare(`
    SELECT id, numero FROM permissoes_trabalho
    WHERE ordem_id = ? AND status = 'Aprovada' AND validade_inicio <= ? AND validade_fim >= ?
    ORDER BY validade_fim DESC LIMIT 1
  `).get(orderId, now, now) || null;
}

export function orderPermits(db, orderId) {
  return db.prepare(`
    SELECT p.id, p.numero, p.status, p.validade_inicio, p.validade_fim, p.solicitada_em, p.decidida_em, p.parecer,
           s.nome AS solicitante, a.nome AS aprovador
    FROM permissoes_trabalho p
    LEFT JOIN usuarios s ON s.id = p.solicitante_id
    LEFT JOIN usuarios a ON a.id = p.aprovador_id
    WHERE p.ordem_id = ? ORDER BY p.id DESC
  `).all(orderId);
}

// Permissão de Trabalho (APR/PT): solicitar → aprovar/reprovar → encerrar, sempre auditado.
export default function createPermitsRouter({ db, auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const gestao = requireRole("CCM", "PCM");
  const isManager = (req) => req.user.papel !== "EXECUTANTE";
  const findOrder = (id) => db.prepare("SELECT id, numero, status, responsavel_id, equipamento_id, exige_pt FROM ordens WHERE id = ?").get(Number(id));

  const select = `
    SELECT p.*, o.numero AS ordem_numero, o.responsavel_id, o.exige_pt, e.tag AS equipamento,
           s.nome AS solicitante, a.nome AS aprovador, f.nome AS encerrada_por_nome,
           r.nao_conformidades
    FROM permissoes_trabalho p
    JOIN ordens o ON o.id = p.ordem_id
    LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    LEFT JOIN usuarios s ON s.id = p.solicitante_id
    LEFT JOIN usuarios a ON a.id = p.aprovador_id
    LEFT JOIN usuarios f ON f.id = p.encerrada_por
    LEFT JOIN formularios_respostas r ON r.id = p.resposta_id`;
  const present = (row) => {
    const { responsavel_id: _owner, ...rest } = row;
    const now = localDateTime();
    return { ...rest, exige_pt: Boolean(row.exige_pt), nao_conformidades: parseJson(row.nao_conformidades, []),
      vigente: row.status === "Aprovada" && row.validade_inicio <= now && row.validade_fim >= now };
  };
  const canSee = (req, row) => isManager(req) || row.solicitante_id === req.user.id || row.responsavel_id === req.user.id;

  router.get("/", (req, res) => {
    const filters = [];
    const params = [];
    if (req.query.status) { filters.push("p.status = ?"); params.push(String(req.query.status)); }
    if (req.query.ordem_id) { filters.push("p.ordem_id = ?"); params.push(Number(req.query.ordem_id)); }
    if (!isManager(req)) { filters.push("(p.solicitante_id = ? OR o.responsavel_id = ?)"); params.push(req.user.id, req.user.id); }
    res.json(db.prepare(`${select} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY CASE p.status WHEN 'Solicitada' THEN 0 WHEN 'Aprovada' THEN 1 ELSE 2 END, p.id DESC LIMIT 200`)
      .all(...params).map(present));
  });

  router.get("/:id", (req, res) => {
    const row = db.prepare(`${select} WHERE p.id = ?`).get(req.params.id);
    if (!row || !canSee(req, row)) return res.status(404).json({ error: "Permissão não encontrada." });
    res.json(present(row));
  });

  router.post("/", formUpload.any(), (req, res) => {
    const dados = submissionData(req);
    if (!dados) return res.status(400).json({ error: "Envio inválido." });
    const order = findOrder(dados.ordem_id);
    if (!order || (!isManager(req) && order.responsavel_id !== req.user.id)) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
    if (order.status === "Encerrada" || order.status === "Cancelada") return res.status(409).json({ error: `A OM ${order.numero} está ${order.status.toLowerCase()}.` });
    const model = activeModel(db, dados.modelo_id);
    if (!model || model.tipo !== "Permissão") return res.status(400).json({ error: "Selecione um formulário ativo do tipo Permissão." });
    const inicio = String(dados.validade_inicio || "");
    const fim = String(dados.validade_fim || "");
    if (!DATE_TIME.test(inicio) || !DATE_TIME.test(fim) || Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fim))) {
      return res.status(400).json({ error: "Informe o início e o fim da validade." });
    }
    const hours = (Date.parse(fim) - Date.parse(inicio)) / 3600000;
    if (hours <= 0) return res.status(400).json({ error: "O fim da validade deve ser depois do início." });
    if (hours > MAX_HORAS) return res.status(400).json({ error: `A validade da PT é de no máximo ${MAX_HORAS} horas.` });
    if (fim < localDateTime()) return res.status(400).json({ error: "A validade informada já terminou." });
    const result = evaluateRequest(model, dados.respostas, req.files);
    if (result.error) return res.status(400).json({ error: result.error });

    const created = db.transaction(() => {
      const respostaId = insertResponse(db, { model, ordemId: order.id, equipamentoId: order.equipamento_id, result, userId: req.user.id });
      const next = (db.prepare("SELECT MAX(id) AS id FROM permissoes_trabalho").get().id || 0) + 1;
      const numero = `PT-${String(next).padStart(5, "0")}`;
      const info = db.prepare(`
        INSERT INTO permissoes_trabalho (numero, ordem_id, modelo_id, resposta_id, validade_inicio, validade_fim, solicitante_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(numero, order.id, model.id, respostaId, inicio, fim, req.user.id);
      // Uma OM com PT solicitada passa a exigir PT aprovada para iniciar a execução.
      db.prepare("UPDATE ordens SET exige_pt = 1 WHERE id = ?").run(order.id);
      audit(req.user.id, "solicitar_permissao_trabalho", "permissao_trabalho", info.lastInsertRowid,
        `${numero} · OM ${order.numero} · ${inicio} a ${fim} · ${result.naoConformidades.length} alerta(s) de risco`);
      return { id: info.lastInsertRowid, numero, nao_conformidades: result.naoConformidades };
    }).immediate();
    res.status(201).json(created);
  });

  const transition = (from, to, action, { requireParecer = false, allow }) => (req, res) => {
    const row = db.prepare(`${select} WHERE p.id = ?`).get(req.params.id);
    if (!row || !canSee(req, row)) return res.status(404).json({ error: "Permissão não encontrada." });
    const denied = allow(req, row);
    if (denied) return res.status(403).json({ error: denied });
    if (row.status !== from) return res.status(409).json({ error: `A ${row.numero} está ${row.status.toLowerCase()}.` });
    const parecer = String((req.body || {}).parecer || "").trim().slice(0, 1000) || null;
    if (requireParecer && !parecer) return res.status(400).json({ error: "Informe o motivo." });
    db.transaction(() => {
      if (to === "Encerrada") {
        db.prepare("UPDATE permissoes_trabalho SET status = ?, encerrada_por = ?, encerrada_em = datetime('now'), observacao_encerramento = ? WHERE id = ?")
          .run(to, req.user.id, parecer, row.id);
      } else if (to === "Cancelada") {
        db.prepare("UPDATE permissoes_trabalho SET status = ?, parecer = COALESCE(?, parecer) WHERE id = ?").run(to, parecer, row.id);
      } else {
        db.prepare("UPDATE permissoes_trabalho SET status = ?, aprovador_id = ?, decidida_em = datetime('now'), parecer = ? WHERE id = ?")
          .run(to, req.user.id, parecer, row.id);
      }
      audit(req.user.id, action, "permissao_trabalho", row.id, `${row.numero} · OM ${row.ordem_numero}${parecer ? ` · ${parecer}` : ""}`);
    }).immediate();
    res.json(present(db.prepare(`${select} WHERE p.id = ?`).get(row.id)));
  };
  // Segregação de funções: quem solicitou não aprova nem reprova a própria PT.
  const approver = (req, row) => (!isManager(req) ? "Somente PCM ou CCM aprovam permissões de trabalho."
    : row.solicitante_id === req.user.id ? "Quem solicitou a PT não pode aprová-la nem reprová-la." : null);

  router.post("/:id/aprovar", gestao, transition("Solicitada", "Aprovada", "aprovar_permissao_trabalho", { allow: approver }));
  router.post("/:id/reprovar", gestao, transition("Solicitada", "Reprovada", "reprovar_permissao_trabalho", { allow: approver, requireParecer: true }));
  router.post("/:id/cancelar", transition("Solicitada", "Cancelada", "cancelar_permissao_trabalho", {
    allow: (req, row) => (row.solicitante_id === req.user.id || isManager(req) ? null : "Somente quem solicitou pode cancelar."),
  }));
  router.post("/:id/encerrar", transition("Aprovada", "Encerrada", "encerrar_permissao_trabalho", {
    allow: (req, row) => (row.solicitante_id === req.user.id || isManager(req) ? null : "Somente quem solicitou, o PCM ou o CCM encerram a PT."),
  }));

  // PCM/CCM definem se a OM exige PT aprovada para iniciar a execução.
  router.patch("/ordem/:id/exigencia", gestao, (req, res) => {
    const order = findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "OM não encontrada." });
    const exige = (req.body || {}).exige_pt ? 1 : 0;
    db.transaction(() => {
      db.prepare("UPDATE ordens SET exige_pt = ? WHERE id = ?").run(exige, order.id);
      audit(req.user.id, "exigencia_pt_ordem", "ordem", order.id, `OM ${order.numero} · ${exige ? "exige PT" : "não exige PT"}`);
    }).immediate();
    res.json({ ok: true, exige_pt: Boolean(exige) });
  });

  router.use(uploadErrors);
  return router;
}
