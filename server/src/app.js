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
import createFieldRouter from "./routes/campo.js";
import { orderForms, pendingRequiredForms } from "./formularios.js";
import { clientTimestamp, idempotency } from "./offline.js";
import createExecutionRouter, { loadExecution } from "./routes/execucao.js";

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
app.use("/api/formularios", createFormsRouter({ auth, requireRole, audit, closeOrderIfComplete }));
app.use("/api/inspecoes", createInspectionRouter({ auth, requireRole, audit }));
app.use("/api/permissoes", createPermitsRouter({ auth, requireRole, audit }));
app.use("/api/notificacoes", createNotificationsRouter({ auth, audit }));
app.use("/api/sinalizacoes", createSignalsRouter({ auth, requireRole, audit }));
app.use("/api/auditoria", createAuditRouter({ auth, requireRole }));
app.use("/api/relatorios", createReportsRouter({ auth, requireRole, audit }));
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
app.get("/api/notas", auth, async (req, res) => {
  res.json(await notasRepo.listWithEquipment());
});

app.post("/api/notas", auth, async (req, res) => {
  const { equipamento_id, descricao, tipo } = req.body || {};
  if (!descricao) return res.status(400).json({ error: "Informe a descrição da nota." });
  const max = await notasRepo.maxNumero() || 14233;
  const numero = String(max + 1);
  const id = await notasRepo.create({ numero, equipamentoId: equipamento_id || null, descricao, tipo: tipo || "Corretiva", solicitanteId: req.user.id });
  await audit(req.user.id, "abrir_nota", "nota", id, numero);
  res.status(201).json({ id, numero });
});

app.post("/api/notas/:id/converter", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const nota = await notasRepo.findById(req.params.id);
  if (!nota) return res.status(404).json({ error: "Nota não encontrada." });
  if (nota.status !== "Aberta") return res.status(400).json({ error: "A nota já foi convertida." });
  const max = await ordensRepo.maxNumero() || 40012352;
  const numero = String(max + 1);
  const equipe = await equipesRepo.findFirst();
  const id = await ordensRepo.createFromNote({ numero, tipo: nota.tipo, equipamentoId: nota.equipamento_id, notaId: nota.id, equipeId: equipe ? equipe.id : null });
  await notasRepo.markConverted(nota.id);
  await audit(req.user.id, "converter_nota", "ordem", id, numero);
  res.status(201).json({ id, numero });
});

// ---------------------------------------------------------------
// Ordens
// ---------------------------------------------------------------
const CONDICOES = ["Apropriação", "Relatório", "Validação"];

async function closeOrderIfComplete(orderId, userId) {
  const tipos = new Set(await apontamentosRepo.listTypesByOrder(orderId));
  if (!CONDICOES.every((condition) => tipos.has(condition))) return false;
  // Checklists obrigatórios (formulários dinâmicos) também precisam estar respondidos.
  if (await pendingRequiredForms(orderId) > 0) return false;
  if (!await ordensRepo.closeIfOpen(orderId)) return false;
  await audit(userId, "encerrar_auto", "ordem", orderId, String(orderId));
  return true;
}

app.get("/api/ordens", auth, async (req, res) => {
  res.json(await ordensRepo.list({ somenteDoResponsavel: req.user.papel === "EXECUTANTE", usuarioId: req.user.id }));
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
  const obrigatorios = o.formularios.filter((form) => form.obrigatorio);
  if (obrigatorios.length) o.condicoes.push({ tipo: "Checklists", ok: obrigatorios.every((form) => form.ultima_resposta) });
  res.json(o);
});

// Programação: datas e vínculo com o plano de manutenção.
app.patch("/api/ordens/:id/programacao", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const order = await ordensRepo.findSummary(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (order.status === "Encerrada" || order.status === "Cancelada") {
    return res.status(409).json({ error: `A OM está ${order.status.toLowerCase()} e não pode ser reprogramada.` });
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
  // Só a OM aberta muda de status; a reprogramação mantém a distribuição e a execução.
  const status = order.status === "Aberta" ? "Programada" : order.status;
  await transaction(async () => {
    await ordensRepo.updateSchedule(order.id, { inicio, fim, planoId, status });
    await audit(req.user.id, "programar_ordem", "ordem", order.id,
      `OM ${order.numero} · ${dataBr(inicio)}${fim ? ` a ${dataBr(fim)}` : ""} · ${planoId ? `plano ${planoId}` : "sem plano"}`);
  });
  res.json({ ok: true, status, data_programada: inicio, data_fim_programada: fim, plano_id: planoId });
});

app.patch("/api/ordens/:id/status", auth, requireRole("CCM", "PCM"), async (req, res) => {
  const { status } = req.body || {};
  const valid = ["Aberta", "Programada", "Distribuída", "Em execução", "Encerrada", "Cancelada"];
  if (!valid.includes(status)) return res.status(400).json({ error: "Status inválido." });
  if (status === "Distribuída") {
    const responsavelId = Number(req.body.responsavel_id);
    const executante = await usuariosRepo.findActiveExecutante(responsavelId);
    if (!executante) return res.status(400).json({ error: "Selecione um usuário ativo com acesso EXECUTANTE." });
    if (!await ordensRepo.distribute(req.params.id, { status, responsavelId })) return res.status(404).json({ error: "Ordem não encontrada." });
    await audit(req.user.id, "distribuir_ordem", "ordem", Number(req.params.id), `Executante ${responsavelId}`);
    return res.json({ ok: true, responsavel_id: responsavelId });
  }
  const encerramento = status === "Encerrada" ? "10/07" : null;
  if (!await ordensRepo.updateStatus(req.params.id, { status, encerramento })) return res.status(404).json({ error: "Ordem não encontrada." });
  await audit(req.user.id, "status_ordem", "ordem", Number(req.params.id), status);
  res.json({ ok: true });
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
  if (om.status !== "Em execução" && om.status !== "Encerrada") {
    await ordensRepo.markInExecution(om.id);
  }
  const encerrada = await closeOrderIfComplete(om.id, user.id);
  return { id, sinal, encerrada, ordem_numero: om.numero, usuario_nome: user.nome };
}

app.post("/api/apontamentos", auth, requireRole("EXECUTANTE"), async (req, res) => {
  const { ordem_id, tipo, hh } = req.body || {};
  const om = await ordensRepo.findById(ordem_id);
  if (!om) return res.status(404).json({ error: "Ordem não encontrada." });
  if (om.responsavel_id !== req.user.id) return res.status(403).json({ error: "Esta OM não está atribuída a você." });
  if (om.status === "Encerrada") return res.status(409).json({ error: "A OM já está encerrada." });
  if (!CONDICOES.includes(tipo) || tipo === "Relatório") return res.status(400).json({ error: "Tipo de registro inválido. O relatório deve ser enviado pelo formulário da OM." });
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
  if (order.status === "Encerrada") return res.status(409).json({ error: "A OM já está encerrada." });
  const body = req.body || {};
  const atividade = String(body.atividade_realizada || "").trim();
  if (!atividade) return res.status(400).json({ error: "Descreva a atividade realizada." });
  const downtime = body.indisponibilidade_horas === "" || body.indisponibilidade_horas == null ? null : Number(body.indisponibilidade_horas);
  const repairTime = body.tempo_reparo_horas === "" || body.tempo_reparo_horas == null ? null : Number(body.tempo_reparo_horas);
  if ([downtime, repairTime].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
    return res.status(400).json({ error: "Informe durações válidas em horas (zero ou mais)." });
  }

  const report = await transaction(async () => {
    const savedId = await relatoriosExecucaoRepo.upsert({
      ordemId: order.id, usuarioId: req.user.id, atividade, resultado: body.resultado || null, materiais: body.materiais_utilizados || null,
      observacoes: body.observacoes || null, indisponibilidade: downtime, reparo: repairTime,
    });
    await apontamentosRepo.createReportIfMissing(order.id, req.user.id, atividade);
    if (order.status !== "Em execução" && order.status !== "Encerrada") {
      await ordensRepo.markInExecution(order.id);
    }
    await audit(req.user.id, "salvar_relatorio_om", "ordem", order.id, `Relatório ${savedId}`);
    const encerrada = await closeOrderIfComplete(order.id, req.user.id);
    return { id: savedId, encerrada };
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
