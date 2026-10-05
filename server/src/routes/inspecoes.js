import { Router } from "express";
import { equipamentosRepo, rondasInspecaoRepo, rotasInspecaoRepo, transaction } from "../data/index.js";
import { parseJson } from "../formularios.js";
import { activeModel, evaluateRequest, formUpload, insertResponse, submissionData, uploadErrors } from "../formularios-envio.js";
import { clientTimestamp } from "../offline.js";

const MAX_PONTOS = 100;

// Rotas de inspeção: sequência de pontos (ativo + formulário) e a execução das rondas.
export default function createInspectionRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const gestao = requireRole("CCM", "PCM");
  const isManager = (req) => req.user.papel !== "EXECUTANTE";

  // ----------------------------------------------------------- Rotas
  router.get("/rotas", (req, res) => {
    const todas = isManager(req) && req.query.todas === "1";
    res.json(rotasInspecaoRepo.listSummary(todas).map((row) => ({ ...row, ativo: Boolean(row.ativo) })));
  });

  router.get("/rotas/:id", (req, res) => {
    const route = rotasInspecaoRepo.findById(req.params.id);
    if (!route || (!route.ativo && !isManager(req))) return res.status(404).json({ error: "Rota não encontrada." });
    res.json({ ...route, ativo: Boolean(route.ativo), pontos: rotasInspecaoRepo.listPoints(route.id).map((point) => ({ ...point, modelo_ativo: Boolean(point.modelo_ativo) })) });
  });

  function validateRoute(body) {
    const nome = String(body.nome || "").trim().slice(0, 120);
    if (!nome) return { error: "Informe o nome da rota." };
    const pontos = Array.isArray(body.pontos) ? body.pontos : [];
    if (!pontos.length) return { error: "Adicione pelo menos um ponto à rota." };
    if (pontos.length > MAX_PONTOS) return { error: `Use no máximo ${MAX_PONTOS} pontos.` };
    const clean = [];
    for (const [index, point] of pontos.entries()) {
      const equipamento = equipamentosRepo.findById(Number(point.equipamento_id));
      if (!equipamento) return { error: `Ponto ${index + 1}: selecione o equipamento.` };
      const model = activeModel(point.modelo_id);
      if (!model) return { error: `Ponto ${index + 1}: selecione um formulário ativo.` };
      clean.push({ equipamento_id: equipamento.id, modelo_id: model.id, instrucao: String(point.instrucao || "").trim().slice(0, 500) || null });
    }
    return {
      nome, pontos: clean,
      descricao: String(body.descricao || "").trim().slice(0, 1000) || null,
      area: String(body.area || "").trim().slice(0, 120) || null,
    };
  }

  router.post("/rotas", gestao, (req, res) => {
    const valid = validateRoute(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const created = transaction(() => {
      const id = rotasInspecaoRepo.create({ nome: valid.nome, descricao: valid.descricao, area: valid.area, usuarioId: req.user.id });
      rotasInspecaoRepo.replacePoints(id, valid.pontos);
      audit(req.user.id, "criar_rota_inspecao", "rota_inspecao", id, `${valid.nome} · ${valid.pontos.length} ponto(s)`);
      return { id };
    });
    res.status(201).json(created);
  });

  // Alterar a rota não afeta rondas já iniciadas: cada ronda copia os pontos ao começar.
  router.put("/rotas/:id", gestao, (req, res) => {
    const route = rotasInspecaoRepo.findState(req.params.id);
    if (!route) return res.status(404).json({ error: "Rota não encontrada." });
    const valid = validateRoute(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const ativo = req.body.ativo === undefined ? route.ativo : (req.body.ativo ? 1 : 0);
    transaction(() => {
      rotasInspecaoRepo.update(route.id, { nome: valid.nome, descricao: valid.descricao, area: valid.area, ativo, usuarioId: req.user.id });
      rotasInspecaoRepo.replacePoints(route.id, valid.pontos);
      audit(req.user.id, "editar_rota_inspecao", "rota_inspecao", route.id, `${valid.nome} · ${valid.pontos.length} ponto(s)${ativo ? "" : " · inativa"}`);
    });
    res.json({ ok: true });
  });

  router.delete("/rotas/:id", gestao, (req, res) => {
    const route = rotasInspecaoRepo.findName(req.params.id);
    if (!route) return res.status(404).json({ error: "Rota não encontrada." });
    const result = transaction(() => {
      if (rotasInspecaoRepo.hasRounds(route.id)) {
        rotasInspecaoRepo.deactivate(route.id, req.user.id);
        audit(req.user.id, "desativar_rota_inspecao", "rota_inspecao", route.id, route.nome);
        return { desativada: true };
      }
      rotasInspecaoRepo.remove(route.id);
      audit(req.user.id, "excluir_rota_inspecao", "rota_inspecao", route.id, route.nome);
      return { excluida: true };
    });
    res.json(result);
  });

  // ----------------------------------------------------------- Rondas
  const findRound = (req) => {
    const round = rondasInspecaoRepo.findWithUser(req.params.id);
    if (!round || (!isManager(req) && round.usuario_id !== req.user.id)) return null;
    return round;
  };
  const roundPoints = (roundId) => rondasInspecaoRepo.listPoints(roundId).map((point) => ({ ...point, nao_conformidades: parseJson(point.nao_conformidades, []) }));
  // Desvios: não conformidades das respostas e pontos não inspecionados.
  const deviations = (points) => points.flatMap((point) => point.status === "Não inspecionado"
    ? [{ ponto_id: point.id, sequencia: point.sequencia, equipamento_id: point.equipamento_id, equipamento: point.equipamento, tipo: "Ponto não inspecionado", descricao: point.motivo }]
    : point.nao_conformidades.map((item) => ({ ponto_id: point.id, sequencia: point.sequencia, equipamento_id: point.equipamento_id, equipamento: point.equipamento, tipo: "Não conformidade", descricao: `${item.rotulo}: ${item.valor} (${item.motivo})` })));

  router.get("/rondas", (req, res) => {
    const rows = rondasInspecaoRepo.list({ todas: isManager(req), usuarioId: req.user.id, status: String(req.query.status || "") });
    res.json(rows);
  });

  router.post("/rondas", (req, res) => {
    const route = rotasInspecaoRepo.findActive(Number((req.body || {}).rota_id));
    if (!route) return res.status(400).json({ error: "Selecione uma rota ativa." });
    const open = rondasInspecaoRepo.findOpen(route.id, req.user.id);
    if (open) return res.status(409).json({ error: "Você já tem uma ronda em andamento nesta rota.", id: open.id });
    const points = rotasInspecaoRepo.listPoints(route.id);
    if (!points.length) return res.status(400).json({ error: "A rota não tem pontos." });
    const created = transaction(() => {
      const id = rondasInspecaoRepo.create({ rotaId: route.id, rotaNome: route.nome, usuarioId: req.user.id, pontos: points });
      audit(req.user.id, "iniciar_ronda_inspecao", "ronda_inspecao", id, `${route.nome} · ${points.length} ponto(s)`);
      return { id };
    });
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
    const round = rondasInspecaoRepo.findById(req.params.id);
    if (!round || round.usuario_id !== req.user.id) { res.status(404).json({ error: "Ronda não encontrada." }); return null; }
    if (round.status !== "Em andamento") { res.status(409).json({ error: "A ronda já foi concluída." }); return null; }
    const point = rondasInspecaoRepo.findPoint(req.params.pontoId, round.id);
    if (!point) { res.status(404).json({ error: "Ponto não encontrado." }); return null; }
    if (point.status !== "Pendente") { res.status(409).json({ error: "Este ponto já foi registrado." }); return null; }
    return { round, point };
  };

  router.post("/rondas/:id/pontos/:pontoId/resposta", formUpload.any(), (req, res) => {
    const found = pendingPoint(req, res);
    if (!found) return;
    const model = activeModel(found.point.modelo_id);
    if (!model) return res.status(409).json({ error: "O formulário deste ponto foi desativado." });
    const dados = submissionData(req) || {};
    const result = evaluateRequest(model, dados.respostas, req.files);
    if (result.error) return res.status(400).json({ error: result.error });
    const preenchido = clientTimestamp(dados.preenchido_em);
    if (preenchido.error) return res.status(400).json({ error: preenchido.error });
    const saved = transaction(() => {
      const id = insertResponse({ model, equipamentoId: found.point.equipamento_id, result, userId: req.user.id, criadoEm: preenchido.value });
      rondasInspecaoRepo.markInspected(found.point.id, { respostaId: id, naoConformidades: JSON.stringify(result.naoConformidades), registradoEm: preenchido.value });
      audit(req.user.id, "inspecionar_ponto_ronda", "ronda_inspecao", found.round.id,
        `Ponto ${found.point.sequencia} · resposta ${id} · ${result.naoConformidades.length} não conformidade(s)`);
      return { resposta_id: id, nao_conformidades: result.naoConformidades };
    });
    res.status(201).json(saved);
  });

  router.post("/rondas/:id/pontos/:pontoId/pular", (req, res) => {
    const found = pendingPoint(req, res);
    if (!found) return;
    const motivo = String((req.body || {}).motivo || "").trim().slice(0, 500);
    if (!motivo) return res.status(400).json({ error: "Informe por que o ponto não foi inspecionado." });
    transaction(() => {
      rondasInspecaoRepo.markSkipped(found.point.id, motivo);
      audit(req.user.id, "pular_ponto_ronda", "ronda_inspecao", found.round.id, `Ponto ${found.point.sequencia} · ${motivo}`);
    });
    res.json({ ok: true });
  });

  router.post("/rondas/:id/concluir", (req, res) => {
    const round = rondasInspecaoRepo.findById(req.params.id);
    if (!round || round.usuario_id !== req.user.id) return res.status(404).json({ error: "Ronda não encontrada." });
    if (round.status !== "Em andamento") return res.status(409).json({ error: "A ronda já foi concluída." });
    const pending = rondasInspecaoRepo.countPendingPoints(round.id);
    if (pending) return res.status(409).json({ error: `Ainda há ${pending} ponto(s) pendente(s). Inspecione ou registre o motivo de não inspecionar.` });
    const pontos = roundPoints(round.id);
    const desvios = deviations(pontos);
    transaction(() => {
      rondasInspecaoRepo.conclude(round.id, String((req.body || {}).observacao || "").trim().slice(0, 1000) || null);
      audit(req.user.id, "concluir_ronda_inspecao", "ronda_inspecao", round.id, `${round.rota_nome} · ${pontos.length} ponto(s) · ${desvios.length} desvio(s)`);
    });
    res.json({ ok: true, desvios: desvios.length });
  });

  router.use(uploadErrors);
  return router;
}
