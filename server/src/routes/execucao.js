import { Router } from "express";
import { apontamentosRepo, execucoesRepo, ordensRepo, transaction } from "../data/index.js";
import { validPermit } from "./permissoes.js";
import { clientTimestamp } from "../offline.js";

const TIPOS_INTERCORRENCIA = ["Desvio", "Alteração de rota", "Alteração de serviço", "Outro"];
const MAX_EXECUTANTES = 50;

// Execução cronometrada da OM (executantes, início/fim e intercorrências).
export function loadExecution(orderId) {
  const execucao = execucoesRepo.findByOrder(orderId) || null;
  if (execucao) execucao.executantes = execucoesRepo.listExecutantes(execucao.id);
  const intercorrencias = execucoesRepo.listIncidentsByOrder(orderId);
  return { execucao, intercorrencias };
}

export default function createExecutionRouter({ auth, requireRole, audit, registrarApontamento }) {
  const router = Router();

  function requireAssignedOrder(req, res, next) {
    const order = ordensRepo.findById(req.params.id);
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
    // Registro feito offline: o cronômetro começa no momento real em que a OM foi iniciada no aparelho.
    const inicio = clientTimestamp(body.iniciado_em);
    if (inicio.error) return res.status(400).json({ error: inicio.error });

    try {
      const started = transaction(() => {
        if (execucoesRepo.exists(order.id)) throw fail(409, "A execução desta OM já foi iniciada.");
        // Redução de risco: OM que exige PT só inicia com permissão aprovada e dentro da validade.
        if (order.exige_pt && !validPermit(order.id)) {
          throw fail(409, "Esta OM exige Permissão de Trabalho aprovada e dentro da validade para iniciar.");
        }
        if (apontamentosRepo.hasAppropriation(order.id)) {
          throw fail(409, "Esta OM já possui mão de obra apropriada.");
        }
        const id = execucoesRepo.start({ ordemId: order.id, usuarioId: req.user.id, quantidade, iniciadoEm: inicio.value });
        nomes.forEach((nome) => execucoesRepo.addExecutante(id, nome));
        if (order.status !== "Em execução") ordensRepo.markInExecution(order.id);
        audit(req.user.id, "iniciar_execucao_om", "ordem", order.id, `OM ${order.numero} · ${quantidade} executante(s)`);
        return { id };
      });
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
    const momento = clientTimestamp(body.registrado_em);
    if (momento.error) return res.status(400).json({ error: momento.error });
    const execucao = execucoesRepo.findState(order.id);
    if (!execucao || execucao.finalizado_em) return res.status(409).json({ error: "Intercorrências só podem ser registradas com a OM em andamento." });

    const created = transaction(() => {
      const id = execucoesRepo.createIncident({
        ordemId: order.id, execucaoId: execucao.id, usuarioId: req.user.id, tipo, descricao, registradoEm: momento.value,
      });
      audit(req.user.id, "registrar_intercorrencia_om", "ordem", order.id, `OM ${order.numero} · ${tipo}`);
      return { id };
    });
    res.status(201).json(created);
  });

  router.post("/:id/execucao/finalizar", guard, (req, res, next) => {
    const order = req.order;
    const fim = clientTimestamp(req.body?.finalizado_em);
    if (fim.error) return res.status(400).json({ error: fim.error });
    try {
      const result = transaction(() => {
        const execucao = execucoesRepo.findForFinish(order.id, fim.value);
        if (!execucao) throw fail(409, "Inicie a OM antes de finalizar.");
        if (execucao.finalizado_em) throw fail(409, "A execução desta OM já foi finalizada.");
        if (execucao.horas < 0) throw fail(400, "O fim da execução é anterior ao início.");
        const duracao = Math.max(0, execucao.horas);
        // HH = tempo cronometrado × executantes; o mínimo de 0,01 h mantém o registro válido.
        const hh = Math.max(0.01, Math.round(duracao * execucao.num_executantes * 100) / 100);
        const apontamento = registrarApontamento(order, req.user, "Apropriação", hh,
          `Cronômetro: ${duracao.toFixed(2)} h × ${execucao.num_executantes} executante(s)`, execucao.fim);
        execucoesRepo.finish(execucao.id, { fim: execucao.fim, duracao, hh, apontamentoId: apontamento.id });
        return { ...apontamento, hh, duracao_horas: duracao, num_executantes: execucao.num_executantes };
      });
      res.status(201).json(result);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === "DUPLICATE_APONTAMENTO") return res.status(409).json({ error: error.message });
      next(error);
    }
  });

  return router;
}
