import { Router } from "express";
import { parseJson } from "../formularios.js";
import { activeModel, evaluateRequest, formUpload, insertResponse, submissionData, uploadErrors } from "../formularios-envio.js";

const MAX_PONTOS = 100;

// Rotas de inspeção: sequência de pontos (ativo + formulário) e a execução das rondas.
export default function createInspectionRouter({ db, auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const gestao = requireRole("CCM", "PCM");
  const isManager = (req) => req.user.papel !== "EXECUTANTE";

  const routePoints = db.prepare(`
    SELECT p.id, p.sequencia, p.equipamento_id, e.tag AS equipamento, e.descricao AS equipamento_descricao, e.localizacao,
           p.modelo_id, m.nome AS modelo_nome, m.tipo AS modelo_tipo, m.ativo AS modelo_ativo, p.instrucao
    FROM rota_pontos p
    JOIN equipamentos e ON e.id = p.equipamento_id
    JOIN formularios_modelos m ON m.id = p.modelo_id
    WHERE p.rota_id = ? ORDER BY p.sequencia
  `);

  // ----------------------------------------------------------- Rotas
  router.get("/rotas", (req, res) => {
    const todas = isManager(req) && req.query.todas === "1";
    res.json(db.prepare(`
      SELECT r.id, r.nome, r.descricao, r.area, r.ativo, r.atualizado_em,
             (SELECT COUNT(*) FROM rota_pontos p WHERE p.rota_id = r.id) AS pontos,
             (SELECT COUNT(*) FROM rondas_inspecao x WHERE x.rota_id = r.id) AS rondas,
             (SELECT MAX(x.concluida_em) FROM rondas_inspecao x WHERE x.rota_id = r.id) AS ultima_ronda
      FROM rotas_inspecao r WHERE (? = 1 OR r.ativo = 1) ORDER BY r.nome
    `).all(todas ? 1 : 0).map((row) => ({ ...row, ativo: Boolean(row.ativo) })));
  });

  router.get("/rotas/:id", (req, res) => {
    const route = db.prepare("SELECT * FROM rotas_inspecao WHERE id = ?").get(req.params.id);
    if (!route || (!route.ativo && !isManager(req))) return res.status(404).json({ error: "Rota não encontrada." });
    res.json({ ...route, ativo: Boolean(route.ativo), pontos: routePoints.all(route.id).map((point) => ({ ...point, modelo_ativo: Boolean(point.modelo_ativo) })) });
  });

  function validateRoute(body) {
    const nome = String(body.nome || "").trim().slice(0, 120);
    if (!nome) return { error: "Informe o nome da rota." };
    const pontos = Array.isArray(body.pontos) ? body.pontos : [];
    if (!pontos.length) return { error: "Adicione pelo menos um ponto à rota." };
    if (pontos.length > MAX_PONTOS) return { error: `Use no máximo ${MAX_PONTOS} pontos.` };
    const clean = [];
    for (const [index, point] of pontos.entries()) {
      const equipamento = db.prepare("SELECT id FROM equipamentos WHERE id = ?").get(Number(point.equipamento_id));
      if (!equipamento) return { error: `Ponto ${index + 1}: selecione o equipamento.` };
      const model = activeModel(db, point.modelo_id);
      if (!model) return { error: `Ponto ${index + 1}: selecione um formulário ativo.` };
      clean.push({ equipamento_id: equipamento.id, modelo_id: model.id, instrucao: String(point.instrucao || "").trim().slice(0, 500) || null });
    }
    return {
      nome, pontos: clean,
      descricao: String(body.descricao || "").trim().slice(0, 1000) || null,
      area: String(body.area || "").trim().slice(0, 120) || null,
    };
  }
  const savePoints = (routeId, pontos) => {
    db.prepare("DELETE FROM rota_pontos WHERE rota_id = ?").run(routeId);
    const insert = db.prepare("INSERT INTO rota_pontos (rota_id, sequencia, equipamento_id, modelo_id, instrucao) VALUES (?, ?, ?, ?, ?)");
    pontos.forEach((point, index) => insert.run(routeId, index + 1, point.equipamento_id, point.modelo_id, point.instrucao));
  };

  router.post("/rotas", gestao, (req, res) => {
    const valid = validateRoute(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const created = db.transaction(() => {
      const info = db.prepare("INSERT INTO rotas_inspecao (nome, descricao, area, criado_por, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))")
        .run(valid.nome, valid.descricao, valid.area, req.user.id, req.user.id);
      savePoints(info.lastInsertRowid, valid.pontos);
      audit(req.user.id, "criar_rota_inspecao", "rota_inspecao", info.lastInsertRowid, `${valid.nome} · ${valid.pontos.length} ponto(s)`);
      return { id: info.lastInsertRowid };
    }).immediate();
    res.status(201).json(created);
  });

  // Alterar a rota não afeta rondas já iniciadas: cada ronda copia os pontos ao começar.
  router.put("/rotas/:id", gestao, (req, res) => {
    const route = db.prepare("SELECT id, ativo FROM rotas_inspecao WHERE id = ?").get(req.params.id);
    if (!route) return res.status(404).json({ error: "Rota não encontrada." });
    const valid = validateRoute(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const ativo = req.body.ativo === undefined ? route.ativo : (req.body.ativo ? 1 : 0);
    db.transaction(() => {
      db.prepare("UPDATE rotas_inspecao SET nome = ?, descricao = ?, area = ?, ativo = ?, atualizado_por = ?, atualizado_em = datetime('now') WHERE id = ?")
        .run(valid.nome, valid.descricao, valid.area, ativo, req.user.id, route.id);
      savePoints(route.id, valid.pontos);
      audit(req.user.id, "editar_rota_inspecao", "rota_inspecao", route.id, `${valid.nome} · ${valid.pontos.length} ponto(s)${ativo ? "" : " · inativa"}`);
    }).immediate();
    res.json({ ok: true });
  });

  router.delete("/rotas/:id", gestao, (req, res) => {
    const route = db.prepare("SELECT id, nome FROM rotas_inspecao WHERE id = ?").get(req.params.id);
    if (!route) return res.status(404).json({ error: "Rota não encontrada." });
    const result = db.transaction(() => {
      if (db.prepare("SELECT 1 FROM rondas_inspecao WHERE rota_id = ?").get(route.id)) {
        db.prepare("UPDATE rotas_inspecao SET ativo = 0, atualizado_por = ?, atualizado_em = datetime('now') WHERE id = ?").run(req.user.id, route.id);
        audit(req.user.id, "desativar_rota_inspecao", "rota_inspecao", route.id, route.nome);
        return { desativada: true };
      }
      db.prepare("DELETE FROM rotas_inspecao WHERE id = ?").run(route.id);
      audit(req.user.id, "excluir_rota_inspecao", "rota_inspecao", route.id, route.nome);
      return { excluida: true };
    }).immediate();
    res.json(result);
  });

  // ----------------------------------------------------------- Rondas
  const findRound = (req) => {
    const round = db.prepare(`
      SELECT x.*, u.nome AS usuario_nome FROM rondas_inspecao x LEFT JOIN usuarios u ON u.id = x.usuario_id WHERE x.id = ?
    `).get(req.params.id);
    if (!round || (!isManager(req) && round.usuario_id !== req.user.id)) return null;
    return round;
  };
  const roundPoints = (roundId) => db.prepare(`
    SELECT rp.id, rp.sequencia, rp.equipamento_id, e.tag AS equipamento, e.descricao AS equipamento_descricao, e.localizacao,
           rp.modelo_id, m.nome AS modelo_nome, rp.instrucao, rp.status, rp.resposta_id, rp.nao_conformidades, rp.motivo, rp.registrado_em
    FROM ronda_pontos rp
    LEFT JOIN equipamentos e ON e.id = rp.equipamento_id
    LEFT JOIN formularios_modelos m ON m.id = rp.modelo_id
    WHERE rp.ronda_id = ? ORDER BY rp.sequencia
  `).all(roundId).map((point) => ({ ...point, nao_conformidades: parseJson(point.nao_conformidades, []) }));
  // Desvios: não conformidades das respostas e pontos não inspecionados.
  const deviations = (points) => points.flatMap((point) => point.status === "Não inspecionado"
    ? [{ ponto_id: point.id, sequencia: point.sequencia, equipamento_id: point.equipamento_id, equipamento: point.equipamento, tipo: "Ponto não inspecionado", descricao: point.motivo }]
    : point.nao_conformidades.map((item) => ({ ponto_id: point.id, sequencia: point.sequencia, equipamento_id: point.equipamento_id, equipamento: point.equipamento, tipo: "Não conformidade", descricao: `${item.rotulo}: ${item.valor} (${item.motivo})` })));

  router.get("/rondas", (req, res) => {
    const rows = db.prepare(`
      SELECT x.id, x.rota_id, x.rota_nome, x.status, x.iniciada_em, x.concluida_em, u.nome AS usuario_nome,
             (SELECT COUNT(*) FROM ronda_pontos rp WHERE rp.ronda_id = x.id) AS pontos,
             (SELECT COUNT(*) FROM ronda_pontos rp WHERE rp.ronda_id = x.id AND rp.status <> 'Pendente') AS pontos_feitos,
             (SELECT COUNT(*) FROM ronda_pontos rp WHERE rp.ronda_id = x.id AND rp.status = 'Não inspecionado')
               + (SELECT COALESCE(SUM(json_array_length(rp.nao_conformidades)), 0) FROM ronda_pontos rp WHERE rp.ronda_id = x.id) AS desvios
      FROM rondas_inspecao x LEFT JOIN usuarios u ON u.id = x.usuario_id
      WHERE (? = 1 OR x.usuario_id = ?) AND (? = '' OR x.status = ?)
      ORDER BY CASE x.status WHEN 'Em andamento' THEN 0 ELSE 1 END, x.id DESC LIMIT 100
    `).all(isManager(req) ? 1 : 0, req.user.id, String(req.query.status || ""), String(req.query.status || ""));
    res.json(rows);
  });

  router.post("/rondas", (req, res) => {
    const route = db.prepare("SELECT id, nome FROM rotas_inspecao WHERE id = ? AND ativo = 1").get(Number((req.body || {}).rota_id));
    if (!route) return res.status(400).json({ error: "Selecione uma rota ativa." });
    const open = db.prepare("SELECT id FROM rondas_inspecao WHERE rota_id = ? AND usuario_id = ? AND status = 'Em andamento'").get(route.id, req.user.id);
    if (open) return res.status(409).json({ error: "Você já tem uma ronda em andamento nesta rota.", id: open.id });
    const points = routePoints.all(route.id);
    if (!points.length) return res.status(400).json({ error: "A rota não tem pontos." });
    const created = db.transaction(() => {
      const info = db.prepare("INSERT INTO rondas_inspecao (rota_id, rota_nome, usuario_id) VALUES (?, ?, ?)").run(route.id, route.nome, req.user.id);
      const insert = db.prepare("INSERT INTO ronda_pontos (ronda_id, sequencia, equipamento_id, modelo_id, instrucao) VALUES (?, ?, ?, ?, ?)");
      points.forEach((point) => insert.run(info.lastInsertRowid, point.sequencia, point.equipamento_id, point.modelo_id, point.instrucao));
      audit(req.user.id, "iniciar_ronda_inspecao", "ronda_inspecao", info.lastInsertRowid, `${route.nome} · ${points.length} ponto(s)`);
      return { id: info.lastInsertRowid };
    }).immediate();
    res.status(201).json(created);
  });

  router.get("/rondas/:id", (req, res) => {
    const round = findRound(req);
    if (!round) return res.status(404).json({ error: "Ronda não encontrada." });
    const pontos = roundPoints(round.id);
    res.json({ ...round, pontos, desvios: deviations(pontos) });
  });

  // Cada ponto só pode ser registrado pelo executor da ronda, enquanto ela está em andamento.
  const pendingPoint = (req, res) => {
    const round = db.prepare("SELECT * FROM rondas_inspecao WHERE id = ?").get(req.params.id);
    if (!round || round.usuario_id !== req.user.id) { res.status(404).json({ error: "Ronda não encontrada." }); return null; }
    if (round.status !== "Em andamento") { res.status(409).json({ error: "A ronda já foi concluída." }); return null; }
    const point = db.prepare("SELECT * FROM ronda_pontos WHERE id = ? AND ronda_id = ?").get(req.params.pontoId, round.id);
    if (!point) { res.status(404).json({ error: "Ponto não encontrado." }); return null; }
    if (point.status !== "Pendente") { res.status(409).json({ error: "Este ponto já foi registrado." }); return null; }
    return { round, point };
  };

  router.post("/rondas/:id/pontos/:pontoId/resposta", formUpload.any(), (req, res) => {
    const found = pendingPoint(req, res);
    if (!found) return;
    const model = activeModel(db, found.point.modelo_id);
    if (!model) return res.status(409).json({ error: "O formulário deste ponto foi desativado." });
    const result = evaluateRequest(model, submissionData(req)?.respostas, req.files);
    if (result.error) return res.status(400).json({ error: result.error });
    const saved = db.transaction(() => {
      const id = insertResponse(db, { model, equipamentoId: found.point.equipamento_id, result, userId: req.user.id });
      db.prepare("UPDATE ronda_pontos SET status = 'Inspecionado', resposta_id = ?, nao_conformidades = ?, registrado_em = datetime('now') WHERE id = ?")
        .run(id, JSON.stringify(result.naoConformidades), found.point.id);
      audit(req.user.id, "inspecionar_ponto_ronda", "ronda_inspecao", found.round.id,
        `Ponto ${found.point.sequencia} · resposta ${id} · ${result.naoConformidades.length} não conformidade(s)`);
      return { resposta_id: id, nao_conformidades: result.naoConformidades };
    }).immediate();
    res.status(201).json(saved);
  });

  router.post("/rondas/:id/pontos/:pontoId/pular", (req, res) => {
    const found = pendingPoint(req, res);
    if (!found) return;
    const motivo = String((req.body || {}).motivo || "").trim().slice(0, 500);
    if (!motivo) return res.status(400).json({ error: "Informe por que o ponto não foi inspecionado." });
    db.transaction(() => {
      db.prepare("UPDATE ronda_pontos SET status = 'Não inspecionado', motivo = ?, registrado_em = datetime('now') WHERE id = ?").run(motivo, found.point.id);
      audit(req.user.id, "pular_ponto_ronda", "ronda_inspecao", found.round.id, `Ponto ${found.point.sequencia} · ${motivo}`);
    }).immediate();
    res.json({ ok: true });
  });

  router.post("/rondas/:id/concluir", (req, res) => {
    const round = db.prepare("SELECT * FROM rondas_inspecao WHERE id = ?").get(req.params.id);
    if (!round || round.usuario_id !== req.user.id) return res.status(404).json({ error: "Ronda não encontrada." });
    if (round.status !== "Em andamento") return res.status(409).json({ error: "A ronda já foi concluída." });
    const pending = db.prepare("SELECT COUNT(*) AS total FROM ronda_pontos WHERE ronda_id = ? AND status = 'Pendente'").get(round.id).total;
    if (pending) return res.status(409).json({ error: `Ainda há ${pending} ponto(s) pendente(s). Inspecione ou registre o motivo de não inspecionar.` });
    const pontos = roundPoints(round.id);
    const desvios = deviations(pontos);
    db.transaction(() => {
      db.prepare("UPDATE rondas_inspecao SET status = 'Concluída', concluida_em = datetime('now'), observacao = ? WHERE id = ?")
        .run(String((req.body || {}).observacao || "").trim().slice(0, 1000) || null, round.id);
      audit(req.user.id, "concluir_ronda_inspecao", "ronda_inspecao", round.id, `${round.rota_nome} · ${pontos.length} ponto(s) · ${desvios.length} desvio(s)`);
    }).immediate();
    res.json({ ok: true, desvios: desvios.length });
  });

  router.use(uploadErrors);
  return router;
}
