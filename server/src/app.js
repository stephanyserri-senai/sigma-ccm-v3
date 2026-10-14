import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { config } from "./config.js";
import {
  transaction, isUniqueViolation, isInvalidInput,
  apontamentosRepo, auditoriaRepo, colaboradoresRepo, equipamentosRepo, equipesRepo, evidenciasRepo, execucoesRepo,
  notasRepo, ordensRepo, planosRepo, relatoriosExecucaoRepo, sinalizacoesRepo, sistemaRepo, usuariosRepo,
} from "./data/index.js";
import { detectar } from "./ia.js";
import { dataBr, parseIsoDate } from "./iamot.js";
import { calculatePriority, priorityLabel } from "./priorizacao.js";
import createCadastrosRouter from "./routes/cadastros.js";
import createEvidenceRouter from "./routes/evidencias.js";
import createDashboardRouter from "./routes/dashboard.js";
import createLaborRouter from "./routes/maoDeObra.js";
import createIndicatorsRouter from "./routes/indicadores.js";
import createParametersRouter from "./routes/parametros.js";
import createPlanningRouter from "./routes/planejamento.js";
import createShiftHandoverRouter from "./routes/passagens.js";
import createFormsRouter from "./routes/formularios.js";
import createInspectionRouter from "./routes/inspecoes.js";
import createPermitsRouter, { orderPermits, validPermit } from "./routes/permissoes.js";
import createNotificationsRouter from "./routes/notificacoes.js";
import createSignalsRouter from "./routes/sinalizacoes.js";
import createAuditRouter from "./routes/auditoria.js";
import createReportsRouter from "./routes/relatorios.js";
import createExportRouter from "./routes/exportacao.js";
import createFieldRouter from "./routes/campo.js";
import { orderForms, pendingRequiredForms } from "./formularios.js";
import { clientTimestamp, idempotency } from "./offline.js";
import createExecutionRouter, { loadExecution } from "./routes/execucao.js";
import { enqueueSapOrder } from "./integracaoSap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Porta, segredo e validade do token vêm do ambiente (server/src/config.js).
const JWT_SECRET = config.jwtSecret;

// Aplicação Express sem listen: o servidor local (server.js) e a função serverless (api/index.js) a importam.
// A estrutura do banco vem de supabase/migrations e a carga inicial de `npm run db:bootstrap`, nunca daqui.
export const app = express();
// CORS: só as origens de CORS_ORIGIN. Requisições sem Origin (mesma origem, ferramentas) seguem normalmente.
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin));
  },
}));
app.use(express.json());
// Fila offline: reenvios com a mesma chave não repetem a operação.
app.use("/api", idempotency({ jwt, secret: JWT_SECRET }));
app.use("/api/dashboard", createDashboardRouter({ auth }));
app.use("/api/gestao-cadastros", createCadastrosRouter({ auth, requireRole, audit }));
app.use("/api/ordens", createEvidenceRouter({ auth, requireRole, audit }));
app.use("/api/ordens", createExecutionRouter({ auth, requireRole, audit, registrarApontamento }));
app.use("/api/mao-de-obra", createLaborRouter({ auth, requireRole, audit }));
app.use("/api/indicadores", createIndicatorsRouter({ auth, requireRole, audit }));
app.use("/api/parametros-kpi", createParametersRouter({ auth, requireRole, audit }));
app.use("/api/planejamento", createPlanningRouter({ auth, requireRole, audit }));
app.use("/api/passagens-turno", createShiftHandoverRouter({ auth, audit }));
app.use("/api/formularios", createFormsRouter({ auth, requireRole, audit }));
app.use("/api/inspecoes", createInspectionRouter({ auth, requireRole, audit }));
app.use("/api/permissoes", createPermitsRouter({ auth, requireRole, audit }));
app.use("/api/notificacoes", createNotificationsRouter({ auth, audit }));
app.use("/api/sinalizacoes", createSignalsRouter({ auth, requireRole, audit }));
app.use("/api/auditoria", createAuditRouter({ auth, requireRole }));
app.use("/api/relatorios", createReportsRouter({ auth, requireRole, audit }));
app.use("/api/exportacao", createExportRouter({ auth, requireRole, audit }));
app.use("/api/campo", createFieldRouter({ auth, requireRole }));

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------
function sign(user) {
  return jwt.sign({ id: user.id, papel: user.papel, nome: user.nome, username: user.username }, JWT_SECRET, { expiresIn: config.jwtExpiresIn });
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Sessão inválida ou expirada." });
  }
}
function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.user.papel) ? next() : res.status(403).json({ error: "Acesso não permitido para o seu perfil." });
}
async function audit(usuarioId, acao, entidade, entidadeId, detalhe) {
  await auditoriaRepo.record({ usuarioId, acao, entidade: entidade || null, entidadeId: entidadeId || null, detalhe: detalhe || null });
}

app.post("/api/auth/login", async (req, res) => {
  const { username, senha } = req.body || {};
  const user = await usuariosRepo.findActiveByUsername(username || "");
  if (!user || !await bcrypt.compare(String(senha || ""), user.senha_hash))
    return res.status(401).json({ error: "Usuário ou senha inválidos." });
  await audit(user.id, "login", "usuario", user.id, null);
  const equipe = user.equipe_id ? await equipesRepo.findById(user.equipe_id) : null;
  res.json({
    token: sign(user),
    user: { id: user.id, nome: user.nome, papel: user.papel, username: user.username, equipe_id: user.equipe_id, equipe: equipe?.nome || null },
  });
});

// Versão em produção (SemVer, igual ao package.json e à tag do git). Pública, sem dados sensíveis.
export const VERSAO = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).version;
app.get("/api/versao", (_req, res) => res.json({ sistema: "SIGMA·CCM", versao: VERSAO }));

app.get("/api/auth/me", auth, async (req, res) => {
  res.json(await usuariosRepo.findProfile(req.user.id));
});

// ---------------------------------------------------------------
// Cadastros auxiliares (para selects)
// ---------------------------------------------------------------
app.get("/api/cadastros", auth, async (req, res) => {
  res.json({
    equipamentos: await equipamentosRepo.listForSelect(),
    equipes: await equipesRepo.listForSelect(),
    planos: await planosRepo.listForSelect(),
    // Colaboradores são os usuários ativos (o id é o do vínculo em colaboradores).
    colaboradores: await colaboradoresRepo.listActiveUsers(),
  });
});

// ---------------------------------------------------------------
// Notas
// ---------------------------------------------------------------
app.get("/api/notas", auth, requireRole("CCM", "PCM"), async (req, res) => {
  res.json((await notasRepo.listWithEquipment()).map((note) => ({
    ...note,
    prioridade_label: priorityLabel(note.prioridade),
  })));
});

app.post("/api/notas", auth, requireRole("CCM", "PCM", "EXECUTANTE"), async (req, res) => {
  const { equipamento_id, descricao, tipo } = req.body || {};
  if (!descricao) return res.status(400).json({ error: "Informe a descrição da nota." });
  const max = await notasRepo.maxNumero() || 14233;
  const numero = String(max + 1);
  const id = await notasRepo.create({ numero, equipamentoId: equipamento_id || null, descricao, tipo: tipo || "Corretiva", solicitanteId: req.user.id });
  await audit(req.user.id, "abrir_nota", "nota", id, numero);
  res.status(201).json({ id, numero, priorizacao_pendente: true });
});

app.patch("/api/notas/:id/priorizacao", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const note = await notasRepo.findById(req.params.id);
  if (!note) return res.status(404).json({ error: "Nota não encontrada." });
  if (note.status !== "Aberta") return res.status(409).json({ error: "Só é possível priorizar uma nota ainda aberta." });
  const priority = calculatePriority(req.body || {});
  if (priority.error) return res.status(400).json({ error: priority.error });

  const result = await transaction(async () => {
    const updated = await notasRepo.updatePriority(note.id, priority);
    if (!updated.changes) return false;
    const historyId = await notasRepo.recordPriority(note.id, req.user.id, priority);
    await audit(req.user.id, "priorizar_nota", "nota", note.id, JSON.stringify({
      historico_id: historyId,
      criticidade: priority.criticidade,
      prioridade: priority.prioridade,
    }));
    return historyId;
  });
  if (!result) return res.status(409).json({ error: "A nota deixou de estar aberta e não foi priorizada." });
  res.json({ ok: true, ...priority, priorizado_em: await sistemaRepo.now(), historico_id: result });
});

app.get("/api/notas/:id/priorizacao/historico", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const note = await notasRepo.findById(req.params.id);
  if (!note) return res.status(404).json({ error: "Nota não encontrada." });
  const history = await notasRepo.priorityHistory(note.id);
  res.json(history.map((entry) => ({ ...entry, prioridade_label: priorityLabel(entry.prioridade) })));
});

app.post("/api/notas/:id/priorizacao/confirmar-paralisacao", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const note = await notasRepo.findById(req.params.id);
  if (!note) return res.status(404).json({ error: "Nota não encontrada." });
  if (note.status !== "Aberta") return res.status(409).json({ error: "A confirmação deve ser registrada antes da conversão da nota." });
  if (note.prioridade !== "IMEDIATO") {
    return res.status(409).json({ error: "A confirmação de paralisação só se aplica à prioridade Imediato." });
  }
  const latest = await notasRepo.latestPriority(note.id);
  if (!latest || latest.prioridade !== "IMEDIATO") {
    return res.status(409).json({ error: "A classificação Imediato não possui histórico vigente." });
  }
  if (await notasRepo.hasShutdownConfirmation(latest.id)) {
    return res.status(409).json({ error: "A paralisação já foi confirmada para esta classificação." });
  }
  const confirmationId = await transaction(async () => {
    const confirmation = await notasRepo.confirmShutdown(latest.id, req.user.id);
    if (!confirmation) return null;
    await audit(req.user.id, "confirmar_paralisacao_prioridade", "historico_prioridade", latest.id,
      `Confirmação ${confirmation.id} da nota ${note.numero}`);
    return confirmation.id;
  });
  if (!confirmationId) return res.status(409).json({ error: "A paralisação já foi confirmada para esta classificação." });
  res.status(201).json({
    ok: true,
    id: confirmationId,
    nota_id: note.id,
    confirmado_por: req.user.id,
    confirmado_em: await sistemaRepo.now(),
  });
});

app.post("/api/notas/:id/converter", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const nota = await notasRepo.findById(req.params.id);
  if (!nota) return res.status(404).json({ error: "Nota não encontrada." });
  if (nota.status !== "Aberta") return res.status(400).json({ error: "A nota já foi convertida." });
  if (nota.priorizacao_pendente) return res.status(409).json({ error: "Priorize a nota antes de convertê-la em OM." });
  if (nota.prioridade === "IMEDIATO") {
    const latest = await notasRepo.latestPriority(nota.id);
    if (!latest || latest.prioridade !== "IMEDIATO" || !await notasRepo.hasShutdownConfirmation(latest.id)) {
      return res.status(409).json({ error: "Registre a confirmação CCM/PCM de paralisação dos demais trabalhos antes de converter esta prioridade Imediato." });
    }
  }
  const max = await ordensRepo.maxNumero() || 40012352;
  const numero = String(max + 1);
  const equipe = await equipesRepo.findFirst();
  const id = await transaction(async () => {
    const converted = await notasRepo.markConverted(nota.id);
    if (!converted.changes) return null;
    const created = await ordensRepo.createFromNote({
      numero, tipo: nota.tipo, equipamentoId: nota.equipamento_id, notaId: nota.id, equipeId: equipe ? equipe.id : null,
    });
    await ordensRepo.recordStatusChange(created, null, "Aberta", "criar_ordem", "Convertida da nota de manutenção.", req.user.id);
    await notasRepo.associatePriorityHistory(nota.id, created);
    await ordensRepo.associatePriorityHistory(nota.id, created);
    await audit(req.user.id, "converter_nota", "ordem", created, numero);
    return created;
  });
  if (!id) return res.status(409).json({ error: "A nota já foi convertida por outra solicitação." });
  res.status(201).json({ id, numero });
});

// ---------------------------------------------------------------
// Ordens
// ---------------------------------------------------------------
const CONDICOES = ["Apropriação", "Relatório", "Validação"];

app.get("/api/ordens", auth, async (req, res) => {
  res.json((await ordensRepo.list({
    somenteDoResponsavel: req.user.papel === "EXECUTANTE",
    usuarioId: req.user.id,
  })).map((order) => ({ ...order, prioridade_label: priorityLabel(order.prioridade) })));
});

app.get("/api/ordens/executantes", auth, requireRole("CCM", "PCM"), async (_req, res) => {
  res.json(await usuariosRepo.listActiveExecutantes());
});

app.get("/api/ordens/:id", auth, async (req, res) => {
  const o = await ordensRepo.findDetail(req.params.id);
  if (!o) return res.status(404).json({ error: "Ordem não encontrada." });
  if (req.user.papel === "EXECUTANTE" && o.responsavel_id !== req.user.id) {
    return res.status(404).json({ error: "OM não encontrada." });
  }
  const aps = await apontamentosRepo.listByOrder(o.id);
  o.apontamentos = aps;
  o.relatorio = await relatoriosExecucaoRepo.findByOrder(o.id) || null;
  o.evidencias = await evidenciasRepo.listSummaryByOrder(o.id);
  Object.assign(o, await loadExecution(o.id));
  o.servidor_agora = await sistemaRepo.now();
  const tipos = new Set(aps.map((a) => a.tipo));
  o.condicoes = CONDICOES.map((c) => ({ tipo: c, ok: tipos.has(c) }));
  o.formularios = await orderForms(o.id);
  o.exige_pt = Boolean(o.exige_pt);
  o.permissoes = await orderPermits(o.id);
  o.pt_vigente = await validPermit(o.id);
  o.historico_status = await ordensRepo.listStatusHistory(o.id);
  o.historico_reprogramacao = await ordensRepo.listRescheduleHistory(o.id);
  o.impedimentos = await ordensRepo.listImpediments(o.id);
  const obrigatorios = o.formularios.filter((form) => form.obrigatorio);
  if (obrigatorios.length) o.condicoes.push({ tipo: "Checklists", ok: obrigatorios.every((form) => form.ultima_resposta) });
  o.prioridade_label = priorityLabel(o.prioridade);
  res.json(o);
});

app.get("/api/ordens/:id/priorizacao/historico", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  const history = await ordensRepo.priorityHistory(order.id);
  res.json(history.map((entry) => ({ ...entry, prioridade_label: priorityLabel(entry.prioridade) })));
});

app.get("/api/ordens/:id/historico", auth, async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (req.user.papel === "EXECUTANTE" && order.responsavel_id !== req.user.id) {
    return res.status(404).json({ error: "Ordem não encontrada." });
  }
  res.json({
    status: await ordensRepo.listStatusHistory(order.id),
    reprogramacoes: await ordensRepo.listRescheduleHistory(order.id),
    impedimentos: await ordensRepo.listImpediments(order.id),
  });
});

app.put("/api/ordens/:id/planejamento", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (!["Aberta", "Programada", "Distribuída", "Devolvida para ajuste"].includes(order.status)) {
    return res.status(409).json({ error: "O planejamento não pode ser alterado nesta etapa da OM." });
  }
  const body = req.body || {};
  const text = (value, max = 4000) => String(value || "").trim().slice(0, max) || null;
  const hhPrevisto = Number(body.hh_previsto);
  if (!Number.isFinite(hhPrevisto) || hhPrevisto <= 0 || hhPrevisto > 100000) {
    return res.status(400).json({ error: "Informe uma estimativa válida de mão de obra (HH maior que zero)." });
  }
  const rows = (value, label) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 100 || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw Object.assign(new Error(`${label} deve ser uma lista válida (máximo 100 itens).`), { status: 400 });
    }
    return value;
  };
  let tarefas;
  let materiais;
  try {
    tarefas = rows(body.tarefas, "As tarefas");
    materiais = rows(body.materiais, "Os materiais");
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  const validTarefas = tarefas.map((task) => ({
    descricao: String(task.descricao || "").trim().slice(0, 500),
    criterio: String(task.criterio || "").trim().slice(0, 500),
  }));
  if (validTarefas.some((task) => !task.descricao)) return res.status(400).json({ error: "Cada tarefa planejada precisa ter uma descrição." });
  const validMateriais = materiais.map((item) => ({
    descricao: String(item.descricao || "").trim().slice(0, 300),
    quantidade: Number(item.quantidade),
    unidade: String(item.unidade || "").trim().slice(0, 30),
    disponibilidade: ["Disponível", "Indisponível", "Compra/contratação necessária"].includes(item.disponibilidade) ? item.disponibilidade : "A verificar",
  }));
  if (validMateriais.some((item) => !item.descricao || !Number.isFinite(item.quantidade) || item.quantidade <= 0 || !item.unidade)) {
    return res.status(400).json({ error: "Cada material planejado precisa de descrição, quantidade positiva e unidade." });
  }
  const ready = body.pronto === true;
  if (ready && (!text(body.escopo) || !text(body.especialidades) || !validTarefas.length
    || !text(body.requisitos_seguranca) || !text(body.criterios_aceitacao))) {
    return res.status(400).json({ error: "Para marcar a OM pronta, preencha escopo, especialidades, ao menos uma tarefa, requisitos de segurança e critérios de aceitação." });
  }
  await transaction(async () => {
    await ordensRepo.updatePlanning(order.id, {
      hh_previsto: Math.round(hhPrevisto * 100) / 100,
      escopo: text(body.escopo), especialidades: text(body.especialidades), ferramentas: text(body.ferramentas),
      procedimentos: text(body.procedimentos), requisitos_seguranca: text(body.requisitos_seguranca),
      criterios_aceitacao: text(body.criterios_aceitacao), tarefas: validTarefas, materiais: validMateriais, pronto: ready,
    });
    await audit(req.user.id, "atualizar_planejamento_om", "ordem", order.id, ready ? "Pronta para liberação" : "Rascunho");
  });
  res.json({ ok: true, planejamento_pronto: ready, tarefas: validTarefas, materiais: validMateriais });
});

// Programação: datas e vínculo com o plano de manutenção.
app.patch("/api/ordens/:id/programacao", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (!["Aberta", "Programada", "Distribuída", "Devolvida para ajuste"].includes(order.status)) {
    return res.status(409).json({ error: `A OM está ${order.status.toLowerCase()} e não pode ser reprogramada nesta etapa.` });
  }
  const body = req.body || {};
  const inicio = String(body.data_programada || "").trim();
  const fim = String(body.data_fim_programada || "").trim() || null;
  if (!parseIsoDate(inicio)) return res.status(400).json({ error: "Informe a data programada." });
  if (fim && !parseIsoDate(fim)) return res.status(400).json({ error: "Informe um término previsto válido." });
  if (fim && fim < inicio) return res.status(400).json({ error: "O término previsto não pode ser anterior à data programada." });
  const planoId = body.plano_id === "" || body.plano_id == null ? null : Number(body.plano_id);
  if (planoId !== null && !await planosRepo.exists(planoId)) {
    return res.status(400).json({ error: "Selecione um plano de manutenção cadastrado." });
  }
  const changedDates = order.data_programada !== inicio || (order.data_fim_programada || null) !== fim;
  const justificativa = String(body.justificativa || "").trim().slice(0, 1000);
  if (order.data_programada && changedDates && justificativa.length < 10) {
    return res.status(400).json({ error: "Informe uma justificativa de pelo menos 10 caracteres para reprogramar a OM." });
  }
  // Só a OM aberta muda de status; a reprogramação mantém a distribuição e a execução.
  const status = ["Aberta", "Devolvida para ajuste"].includes(order.status) ? "Programada" : order.status;
  await transaction(async () => {
    await ordensRepo.updateSchedule(order.id, { inicio, fim, planoId, status });
    if (order.data_programada && changedDates) {
      await ordensRepo.saveReschedule(order.id,
        { inicio: order.data_programada, fim: order.data_fim_programada || null },
        { inicio, fim }, justificativa, req.user.id);
    }
    if (order.status !== status) {
      await ordensRepo.recordStatusChange(order.id, order.status, status, "programar_ordem", justificativa || null, req.user.id);
    }
    await audit(req.user.id, "programar_ordem", "ordem", order.id,
      `OM ${order.numero} · ${dataBr(inicio)}${fim ? ` a ${dataBr(fim)}` : ""} · ${planoId ? `plano ${planoId}` : "sem plano"}${justificativa ? ` · ${justificativa}` : ""}`);
  });
  res.json({ ok: true, status, data_programada: inicio, data_fim_programada: fim, plano_id: planoId });
});

app.patch("/api/ordens/:id/status", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const { status } = req.body || {};
  if (!["Distribuída", "Cancelada"].includes(status)) return res.status(400).json({ error: "Transição de status inválida; use as ações específicas do fluxo." });
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (["Encerrada", "Cancelada", "Liberada para execução", "Em execução", "Bloqueada", "Aguardando validação"].includes(order.status)) {
    return res.status(409).json({ error: `A OM ${order.status.toLowerCase()} não pode ser distribuída/cancelada por esta ação.` });
  }
  if (status === "Distribuída") {
    if (!order.data_programada || !["Programada", "Distribuída", "Devolvida para ajuste"].includes(order.status)) {
      return res.status(409).json({ error: "Programe a OM antes de distribuí-la." });
    }
    const responsavelId = Number(req.body.responsavel_id);
    const executante = await usuariosRepo.findActiveExecutante(responsavelId);
    if (!executante) return res.status(400).json({ error: "Selecione um usuário ativo com acesso EXECUTANTE." });
    await transaction(async () => {
      if (!await ordensRepo.distribute(req.params.id, { status, responsavelId, expectedStatus: order.status })) {
        throw Object.assign(new Error("A OM foi alterada por outra operação."), { status: 409 });
      }
      await ordensRepo.recordStatusChange(order.id, order.status, status, "distribuir_ordem", null, req.user.id);
      await audit(req.user.id, "distribuir_ordem", "ordem", order.id, `Executante ${responsavelId}`);
    });
    return res.json({ ok: true, responsavel_id: responsavelId });
  }
  const justificativa = String(req.body.justificativa || "").trim().slice(0, 1000);
  if (justificativa.length < 10) return res.status(400).json({ error: "Informe o motivo do cancelamento (mínimo 10 caracteres)." });
  await transaction(async () => {
    const changed = await ordensRepo.transitionStatus(order.id, order.status, "Cancelada");
    if (!changed.changes) throw Object.assign(new Error("A OM foi alterada por outra operação."), { status: 409 });
    await ordensRepo.recordStatusChange(order.id, order.status, "Cancelada", "cancelar_ordem", justificativa, req.user.id);
    await audit(req.user.id, "cancelar_ordem", "ordem", order.id, justificativa);
  });
  res.json({ ok: true });
});

app.post("/api/ordens/:id/liberar", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (order.status !== "Distribuída") return res.status(409).json({ error: "Distribua a OM antes de liberá-la para execução." });
  if (!order.planejamento_pronto || !order.data_programada || !order.equipe_id || !order.responsavel_id) {
    return res.status(409).json({ error: "A OM exige planejamento pronto, data programada, equipe e executante antes da liberação." });
  }
  if (order.exige_pt && !await validPermit(order.id)) {
    return res.status(409).json({ error: "A Permissão de Trabalho deve estar aprovada e vigente antes da liberação." });
  }
  await transaction(async () => {
    const changed = await ordensRepo.transitionStatus(order.id, "Distribuída", "Liberada para execução");
    if (!changed.changes) throw Object.assign(new Error("A OM foi alterada por outra operação."), { status: 409 });
    await ordensRepo.recordStatusChange(order.id, "Distribuída", "Liberada para execução", "liberar_ordem", null, req.user.id);
    await audit(req.user.id, "liberar_ordem", "ordem", order.id, `OM ${order.numero}`);
  });
  res.json({ ok: true, status: "Liberada para execução" });
});

app.post("/api/ordens/:id/concluir-tecnicamente", auth, requireRole("EXECUTANTE"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order || order.responsavel_id !== req.user.id) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
  if (order.status !== "Em execução") return res.status(409).json({ error: "Somente uma OM em execução pode ser encaminhada para validação." });
  if (await execucoesRepo.isRunning(order.id)) return res.status(409).json({ error: "Finalize o cronômetro antes de concluir tecnicamente." });
  const report = await relatoriosExecucaoRepo.findByOrder(order.id);
  if (!report || !report.atividade_realizada?.trim()) return res.status(409).json({ error: "Salve o relatório de execução antes da conclusão técnica." });
  if (!await apontamentosRepo.hasAppropriation(order.id)) return res.status(409).json({ error: "Aproprie as horas trabalhadas antes da conclusão técnica." });
  if (await pendingRequiredForms(order.id) > 0) return res.status(409).json({ error: "Responda os checklists obrigatórios antes da conclusão técnica." });
  if (!report.condicao_final_ativo || report.equipamento_testado == null
    || (report.equipamento_testado && report.apto_retorno_operacao == null)) {
    return res.status(409).json({ error: "Informe a condição final do ativo e o resultado dos testes no relatório." });
  }
  await transaction(async () => {
    const changed = await ordensRepo.transitionStatus(order.id, "Em execução", "Aguardando validação");
    if (!changed.changes) throw Object.assign(new Error("A OM foi alterada por outra operação."), { status: 409 });
    await ordensRepo.recordStatusChange(order.id, "Em execução", "Aguardando validação", "concluir_tecnicamente", null, req.user.id);
    await audit(req.user.id, "concluir_tecnicamente_om", "ordem", order.id, `OM ${order.numero}`);
  });
  res.json({ ok: true, status: "Aguardando validação" });
});

app.post("/api/ordens/:id/validar", auth, requireRole("CCM"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (order.status !== "Aguardando validação") return res.status(409).json({ error: "A OM não está aguardando validação administrativa." });
  const report = await relatoriosExecucaoRepo.findByOrder(order.id);
  if (!report?.condicao_final_ativo || report.equipamento_testado == null
    || (report.equipamento_testado && report.apto_retorno_operacao == null)
    || !await apontamentosRepo.hasAppropriation(order.id) || await pendingRequiredForms(order.id) > 0) {
    return res.status(409).json({ error: "A OM ainda possui dados ou checklists obrigatórios pendentes." });
  }
  await transaction(async () => {
    const changed = await ordensRepo.transitionStatus(order.id, "Aguardando validação", "Encerrada", {
      encerramento: await sistemaRepo.todayBr(),
    });
    if (!changed.changes) throw Object.assign(new Error("A OM foi alterada por outra operação."), { status: 409 });
    await apontamentosRepo.create({
      ordemId: order.id, usuarioId: req.user.id, tipo: "Validação", horas: 0,
      descricao: "Validação administrativa aprovada.",
    });
    await ordensRepo.recordStatusChange(order.id, "Aguardando validação", "Encerrada", "validar_ordem", null, req.user.id);
    await audit(req.user.id, "validar_encerrar_ordem", "ordem", order.id, `OM ${order.numero}`);
  });
  await enqueueSapOrder(order.id);
  res.json({ ok: true, status: "Encerrada", sap_status: "PENDENTE" });
});

app.post("/api/ordens/:id/devolver", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (order.status !== "Aguardando validação") return res.status(409).json({ error: "Apenas OMs aguardando validação podem ser devolvidas." });
  const justificativa = String(req.body?.justificativa || "").trim().slice(0, 2000);
  if (justificativa.length < 10) return res.status(400).json({ error: "Informe o motivo da devolução (mínimo 10 caracteres)." });
  await transaction(async () => {
    const changed = await ordensRepo.transitionStatus(order.id, "Aguardando validação", "Devolvida para ajuste");
    if (!changed.changes) throw Object.assign(new Error("A OM foi alterada por outra operação."), { status: 409 });
    await ordensRepo.recordStatusChange(order.id, "Aguardando validação", "Devolvida para ajuste", "devolver_ordem", justificativa, req.user.id);
    await audit(req.user.id, "devolver_ordem", "ordem", order.id, justificativa);
  });
  res.json({ ok: true, status: "Devolvida para ajuste" });
});

app.post("/api/ordens/:id/impedimentos", auth, requireRole("EXECUTANTE"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order || order.responsavel_id !== req.user.id) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
  if (!["Liberada para execução", "Em execução"].includes(order.status)) {
    return res.status(409).json({ error: "Só é possível registrar impedimento em uma OM liberada ou em execução." });
  }
  const tipo = String(req.body?.tipo || "").trim();
  const descricao = String(req.body?.descricao || "").trim().slice(0, 2000);
  if (!["Material", "Recurso", "Segurança", "Escopo", "Operacional", "Outro"].includes(tipo)) {
    return res.status(400).json({ error: "Selecione um tipo válido de impedimento." });
  }
  if (descricao.length < 5) return res.status(400).json({ error: "Descreva o impedimento (mínimo 5 caracteres)." });
  const result = await transaction(async () => {
    const id = await ordensRepo.createImpediment({ ordemId: order.id, tipo, descricao, usuarioId: req.user.id });
    const changed = await ordensRepo.transitionStatus(order.id, order.status, "Bloqueada", { statusPrevio: order.status });
    if (!changed.changes) throw Object.assign(new Error("A OM foi alterada por outra operação."), { status: 409 });
    await ordensRepo.recordStatusChange(order.id, order.status, "Bloqueada", "registrar_impedimento", descricao, req.user.id);
    await audit(req.user.id, "registrar_impedimento_om", "ordem", order.id, `${tipo} · ${descricao}`);
    return { id };
  });
  res.status(201).json(result);
});

app.post("/api/ordens/:id/impedimentos/:impedimentoId/resolver", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (order.status !== "Bloqueada") return res.status(409).json({ error: "A OM não está bloqueada." });
  const resolucao = String(req.body?.resolucao || "").trim().slice(0, 2000);
  if (resolucao.length < 5) return res.status(400).json({ error: "Descreva como o impedimento foi resolvido (mínimo 5 caracteres)." });
  const target = order.status_previo_bloqueio === "Em execução" ? "Em execução" : "Liberada para execução";
  await transaction(async () => {
    const resolved = await ordensRepo.resolveImpediment(order.id, req.params.impedimentoId, req.user.id, resolucao);
    if (!resolved.changes) throw Object.assign(new Error("Impedimento não encontrado nesta OM ou já resolvido."), { status: 404 });
    const transitioned = await ordensRepo.transitionStatus(order.id, "Bloqueada", target);
    if (!transitioned.changes) throw Object.assign(new Error("A OM foi alterada por outra operação."), { status: 409 });
    await ordensRepo.recordStatusChange(order.id, "Bloqueada", target, "resolver_impedimento", resolucao, req.user.id);
    await audit(req.user.id, "resolver_impedimento_om", "ordem", order.id, resolucao);
  });
  res.json({ ok: true, status: target });
});

// ---------------------------------------------------------------
// Apontamentos (detecção IA + encerramento automático)
// ---------------------------------------------------------------
// Deve ser chamada dentro de uma transação.
// `data` (UTC) permite registrar o momento real de um apontamento feito offline.
async function registrarApontamento(om, user, tipo, horas, descricao = null, data = null) {
  const duplicate = await apontamentosRepo.findByOrderAndType(om.id, tipo);
  if (duplicate) throw Object.assign(new Error("Este registro já existe para a OM."), { code: "DUPLICATE_APONTAMENTO" });
  const id = await apontamentosRepo.create({ ordemId: om.id, usuarioId: user.id, tipo, horas, descricao, data });
  await audit(user.id, "apontar", "apontamento", id, `OM ${om.numero} · ${tipo}`);

  let sinal = null;
  if (tipo === "Apropriação") {
    const flag = detectar(horas, om.hh_previsto);
    if (flag) {
      const sinalId = await sinalizacoesRepo.createForAppointment({
        apontamentoId: id, ordemNumero: om.numero, valorAtual: horas, valorSugerido: flag.sugerido,
        tipo: flag.tipo, score: flag.score, explicacao: JSON.stringify(flag.fatores),
      });
      sinal = { id: sinalId, tipo: flag.tipo, score: flag.score };
    }
  }
  return { id, sinal, ordem_numero: om.numero, usuario_nome: user.nome };
}

app.post("/api/apontamentos", auth, requireRole("EXECUTANTE"), async (req, res) => {
  const { ordem_id, tipo, hh } = req.body || {};
  const om = await ordensRepo.findById(ordem_id);
  if (!om) return res.status(404).json({ error: "Ordem não encontrada." });
  if (om.responsavel_id !== req.user.id) return res.status(403).json({ error: "Esta OM não está atribuída a você." });
  if (om.status !== "Em execução") return res.status(409).json({ error: "A OM precisa estar em execução para registrar horas." });
  if (!CONDICOES.includes(tipo) || tipo === "Relatório" || tipo === "Validação") {
    return res.status(400).json({ error: "Tipo de registro inválido. Validação administrativa é exclusiva do CCM." });
  }
  const horas = Number(hh);
  if (!Number.isFinite(horas) || horas < 0 || (tipo === "Apropriação" && horas === 0)) {
    return res.status(400).json({ error: "Informe uma quantidade válida de horas." });
  }
  const momento = clientTimestamp(req.body.registrado_em);
  if (momento.error) return res.status(400).json({ error: momento.error });

  try {
    const result = await transaction(async () => {
      // Com o cronômetro em andamento, o HH vem da finalização da execução, não de digitação.
      if (tipo === "Apropriação" && await execucoesRepo.isRunning(om.id)) {
        throw Object.assign(new Error("A OM está em andamento: finalize a execução para apropriar o HH."), { code: "DUPLICATE_APONTAMENTO" });
      }
      return await registrarApontamento(om, req.user, tipo, horas, null, momento.value);
    });
    res.status(201).json(result);
  } catch (error) {
    if (error.code === "DUPLICATE_APONTAMENTO") return res.status(409).json({ error: error.message });
    throw error;
  }
});

app.put("/api/ordens/:id/relatorio", auth, requireRole("EXECUTANTE"), async (req, res) => {
  const order = await ordensRepo.findById(req.params.id);
  if (!order || order.responsavel_id !== req.user.id) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
  if (order.status !== "Em execução") return res.status(409).json({ error: "A OM precisa estar em execução para salvar o relatório técnico." });
  const body = req.body || {};
  const atividade = String(body.atividade_realizada || "").trim();
  if (!atividade) return res.status(400).json({ error: "Descreva a atividade realizada." });
  const downtime = body.indisponibilidade_horas === "" || body.indisponibilidade_horas == null ? null : Number(body.indisponibilidade_horas);
  const repairTime = body.tempo_reparo_horas === "" || body.tempo_reparo_horas == null ? null : Number(body.tempo_reparo_horas);
  if ([downtime, repairTime].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
    return res.status(400).json({ error: "Informe durações válidas em horas (zero ou mais)." });
  }
  const listOf = (value, label) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 100 || value.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
      throw Object.assign(new Error(`${label} deve ser uma lista válida (máximo 100 itens).`), { status: 400 });
    }
    return value;
  };
  let tasks;
  let materials;
  let measurements;
  try {
    tasks = listOf(body.tarefas_executadas, "As tarefas executadas").map((entry) => ({
      descricao: String(entry.descricao || "").trim().slice(0, 500),
      resultado: String(entry.resultado || "").trim().slice(0, 1000),
    }));
    materials = listOf(body.materiais_estruturados, "Os materiais utilizados").map((entry) => ({
      descricao: String(entry.descricao || "").trim().slice(0, 300),
      quantidade: Number(entry.quantidade),
      unidade: String(entry.unidade || "").trim().slice(0, 30),
    }));
    measurements = listOf(body.medicoes_testes, "As medições e testes").map((entry) => ({
      descricao: String(entry.descricao || "").trim().slice(0, 300),
      valor: String(entry.valor ?? "").trim().slice(0, 100),
      unidade: String(entry.unidade || "").trim().slice(0, 30),
      criterio: String(entry.criterio || "").trim().slice(0, 300),
      resultado: String(entry.resultado || "").trim().slice(0, 40),
    }));
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  if (tasks.some((entry) => !entry.descricao || !entry.resultado)) return res.status(400).json({ error: "Cada tarefa executada precisa de descrição e resultado." });
  if (materials.some((entry) => !entry.descricao || !Number.isFinite(entry.quantidade) || entry.quantidade <= 0 || !entry.unidade)) {
    return res.status(400).json({ error: "Cada material utilizado precisa de descrição, quantidade positiva e unidade." });
  }
  if (measurements.some((entry) => !entry.descricao || !entry.valor || !entry.resultado)) {
    return res.status(400).json({ error: "Cada medição/teste precisa de descrição, valor obtido e resultado." });
  }
  const equipamentoTestado = typeof body.equipamento_testado === "boolean" ? body.equipamento_testado : null;
  const aptoRetorno = typeof body.apto_retorno_operacao === "boolean" ? body.apto_retorno_operacao : null;
  if (equipamentoTestado === true && aptoRetorno === null) {
    return res.status(400).json({ error: "Informe se o ativo está apto a retornar à operação." });
  }
  const condicaoFinal = String(body.condicao_final_ativo || "").trim().slice(0, 1000) || null;

  const report = await transaction(async () => {
    const savedId = await relatoriosExecucaoRepo.upsert({
      ordemId: order.id, usuarioId: req.user.id, atividade, resultado: body.resultado || null, materiais: body.materiais_utilizados || null,
      observacoes: body.observacoes || null, indisponibilidade: downtime, reparo: repairTime,
      tarefas: tasks, materiaisEstruturados: materials, medicoes: measurements,
      causa: String(body.causa_falha || "").trim().slice(0, 2000) || null,
      solucao: String(body.solucao_aplicada || "").trim().slice(0, 2000) || null,
      anomalias: String(body.anomalias_adicionais || "").trim().slice(0, 2000) || null,
      condicaoFinal, testado: equipamentoTestado, aptoRetorno,
    });
    await apontamentosRepo.createReportIfMissing(order.id, req.user.id, atividade);
    await audit(req.user.id, "salvar_relatorio_om", "ordem", order.id, `Relatório ${savedId}`);
    return { id: savedId };
  });

  res.json(report);
});

// ---------------------------------------------------------------
// Usuários (cadastro — restrito ao papel CCM)
// ---------------------------------------------------------------
app.get("/api/usuarios", auth, requireRole("CCM"), async (req, res) => {
  res.json(await usuariosRepo.listWithTeam());
});

const findTeam = async (id) => {
  const teamId = Number(id);
  return Number.isInteger(teamId) ? await equipesRepo.findById(teamId) : undefined;
};

app.post("/api/usuarios", auth, requireRole("CCM"), async (req, res) => {
  const { nome, username, senha, papel, email, equipe_id } = req.body || {};
  if (!nome || !username || !senha) return res.status(400).json({ error: "Nome, usuário e senha são obrigatórios." });
  if (!["CCM", "PCM", "EXECUTANTE"].includes(papel)) return res.status(400).json({ error: "Papel inválido." });
  const equipe = await findTeam(equipe_id);
  if (!equipe) return res.status(400).json({ error: "Selecione uma equipe cadastrada para o usuário." });
  const existe = await usuariosRepo.findIdByUsername(username);
  if (existe) return res.status(409).json({ error: "Este usuário já existe." });
  const senhaHash = await bcrypt.hash(String(senha), 10);
  try {
    const id = await transaction(async () => {
      const created = await usuariosRepo.create({ nome, email: email || null, username, senhaHash, papel, equipeId: equipe.id });
      await colaboradoresRepo.syncFromUsers();
      await audit(req.user.id, "criar_usuario", "usuario", created, `${username} · ${equipe.nome}`);
      return created;
    });
    res.status(201).json({ id });
  } catch (error) {
    if (isUniqueViolation(error)) return res.status(409).json({ error: "Este usuário já existe." });
    throw error;
  }
});

app.patch("/api/usuarios/:id/equipe", auth, requireRole("CCM"), async (req, res) => {
  const equipe = await findTeam((req.body || {}).equipe_id);
  if (!equipe) return res.status(400).json({ error: "Selecione uma equipe cadastrada para o usuário." });
  if (!await usuariosRepo.updateTeam(req.params.id, equipe.id)) return res.status(404).json({ error: "Usuário não encontrado." });
  await colaboradoresRepo.updateTeamForUser(req.params.id, equipe.id);
  await audit(req.user.id, "vincular_equipe_usuario", "usuario", Number(req.params.id), equipe.nome);
  res.json({ ok: true, equipe_id: equipe.id, equipe: equipe.nome });
});

// ---------------------------------------------------------------
// Servir o frontend buildado (produção)
// ---------------------------------------------------------------
// Na Vercel o frontend é servido pela própria plataforma; a API só atende /api.
const clientDist = join(__dirname, "..", "..", "client", "dist");
if (!config.serverless && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(clientDist, "index.html")));
}

// Erros de rotas assíncronas (Express 5 os encaminha para cá). Detalhes internos ficam só no log.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error.status ?? error.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ error: error.expose === false ? "Requisição inválida." : error.message });
  if (isInvalidInput(error)) return res.status(400).json({ error: "Valor inválido na requisição." });
  console.error(`${req.method} ${req.originalUrl}:`, error);
  res.status(500).json({ error: "Erro interno do servidor." });
});

export default app;
