import { Router } from "express";

const TIPOS_INTERCORRENCIA = ["Desvio", "Alteração de rota", "Alteração de serviço", "Outro"];
const MAX_EXECUTANTES = 50;

// Execução cronometrada da OM (executantes, início/fim e intercorrências).
export function loadExecution(db, orderId) {
  const execucao = db.prepare(`
    SELECT x.id, x.usuario_id, u.nome AS usuario_nome, x.num_executantes, x.iniciado_em,
           x.finalizado_em, x.duracao_horas, x.hh_calculado
    FROM execucoes_om x LEFT JOIN usuarios u ON u.id = x.usuario_id WHERE x.ordem_id = ?
  `).get(orderId) || null;
  if (execucao) {
    execucao.executantes = db.prepare("SELECT nome FROM execucao_executantes WHERE execucao_id = ? ORDER BY id")
      .all(execucao.id).map((row) => row.nome);
  }
  const intercorrencias = db.prepare(`
    SELECT i.id, i.tipo, i.descricao, i.registrado_em, u.nome AS usuario_nome
    FROM intercorrencias_om i LEFT JOIN usuarios u ON u.id = i.usuario_id
    WHERE i.ordem_id = ? ORDER BY i.id
  `).all(orderId);
  return { execucao, intercorrencias };
}

export default function createExecutionRouter({ db, auth, requireRole, audit, registrarApontamento }) {
  const router = Router();

  function requireAssignedOrder(req, res, next) {
    const order = db.prepare("SELECT * FROM ordens WHERE id = ?").get(req.params.id);
    if (!order || order.responsavel_id !== req.user.id) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
    if (order.status === "Encerrada" || order.status === "Cancelada") return res.status(409).json({ error: `A OM está ${order.status.toLowerCase()}.` });
    req.order = order;
    next();
  }
  const guard = [auth, requireRole("EXECUTANTE"), requireAssignedOrder];
  const fail = (status, message) => Object.assign(new Error(message), { status });

  router.post("/:id/execucao/iniciar", guard, (req, res, next) => {
    const order = req.order;
    const body = req.body || {};
    const quantidade = Number(body.num_executantes);
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_EXECUTANTES) {
      return res.status(400).json({ error: `Informe o número de executantes (1 a ${MAX_EXECUTANTES}).` });
    }
    const nomes = (Array.isArray(body.nomes) ? body.nomes : [])
      .map((nome) => String(nome ?? "").trim().slice(0, 120)).filter(Boolean);
    if (nomes.length > quantidade) return res.status(400).json({ error: "Há mais nomes do que executantes informados." });

    try {
      const started = db.transaction(() => {
        if (db.prepare("SELECT 1 FROM execucoes_om WHERE ordem_id = ?").get(order.id)) throw fail(409, "A execução desta OM já foi iniciada.");
        if (db.prepare("SELECT 1 FROM apontamentos WHERE ordem_id = ? AND tipo = 'Apropriação'").get(order.id)) {
          throw fail(409, "Esta OM já possui mão de obra apropriada.");
        }
        const info = db.prepare("INSERT INTO execucoes_om (ordem_id, usuario_id, num_executantes) VALUES (?, ?, ?)")
          .run(order.id, req.user.id, quantidade);
        const insertName = db.prepare("INSERT INTO execucao_executantes (execucao_id, nome) VALUES (?, ?)");
        nomes.forEach((nome) => insertName.run(info.lastInsertRowid, nome));
        if (order.status !== "Em execução") db.prepare("UPDATE ordens SET status = 'Em execução' WHERE id = ?").run(order.id);
        audit(req.user.id, "iniciar_execucao_om", "ordem", order.id, `OM ${order.numero} · ${quantidade} executante(s)`);
        return { id: info.lastInsertRowid };
      }).immediate();
      res.status(201).json(started);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });

  router.post("/:id/execucao/intercorrencias", guard, (req, res) => {
    const order = req.order;
    const body = req.body || {};
    const tipo = String(body.tipo || "").trim();
    const descricao = String(body.descricao || "").trim().slice(0, 2000);
    if (!TIPOS_INTERCORRENCIA.includes(tipo)) return res.status(400).json({ error: "Tipo de intercorrência inválido." });
    if (!descricao) return res.status(400).json({ error: "Descreva a intercorrência." });
    const execucao = db.prepare("SELECT id, finalizado_em FROM execucoes_om WHERE ordem_id = ?").get(order.id);
    if (!execucao || execucao.finalizado_em) return res.status(409).json({ error: "Intercorrências só podem ser registradas com a OM em andamento." });

    const created = db.transaction(() => {
      const info = db.prepare("INSERT INTO intercorrencias_om (ordem_id, execucao_id, usuario_id, tipo, descricao) VALUES (?, ?, ?, ?, ?)")
        .run(order.id, execucao.id, req.user.id, tipo, descricao);
      audit(req.user.id, "registrar_intercorrencia_om", "ordem", order.id, `OM ${order.numero} · ${tipo}`);
      return { id: info.lastInsertRowid };
    }).immediate();
    res.status(201).json(created);
  });

  router.post("/:id/execucao/finalizar", guard, (req, res, next) => {
    const order = req.order;
    try {
      const result = db.transaction(() => {
        const execucao = db.prepare(`
          SELECT id, num_executantes, finalizado_em, (julianday('now') - julianday(iniciado_em)) * 24 AS horas
          FROM execucoes_om WHERE ordem_id = ?
        `).get(order.id);
        if (!execucao) throw fail(409, "Inicie a OM antes de finalizar.");
        if (execucao.finalizado_em) throw fail(409, "A execução desta OM já foi finalizada.");
        const duracao = Math.max(0, execucao.horas);
        // HH = tempo cronometrado × executantes; o mínimo de 0,01 h mantém o registro válido.
        const hh = Math.max(0.01, Math.round(duracao * execucao.num_executantes * 100) / 100);
        const apontamento = registrarApontamento(order, req.user, "Apropriação", hh,
          `Cronômetro: ${duracao.toFixed(2)} h × ${execucao.num_executantes} executante(s)`);
        db.prepare(`
          UPDATE execucoes_om SET finalizado_em = datetime('now'), duracao_horas = ?, hh_calculado = ?, apontamento_id = ?
          WHERE id = ?
        `).run(duracao, hh, apontamento.id, execucao.id);
        return { ...apontamento, hh, duracao_horas: duracao, num_executantes: execucao.num_executantes };
      }).immediate();
      res.status(201).json(result);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === "DUPLICATE_APONTAMENTO") return res.status(409).json({ error: error.message });
      next(error);
    }
  });

  return router;
}
