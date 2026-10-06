import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { config } from "./config.js";
import {
  initDatabase, transaction,
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
const PORT = config.port;
const JWT_SECRET = config.jwtSecret;

// Estrutura do banco (migrações idempotentes) e carga inicial.
initDatabase();

const app = express();
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
function audit(usuarioId, acao, entidade, entidadeId, detalhe) {
  auditoriaRepo.record({ usuarioId, acao, entidade: entidade || null, entidadeId: entidadeId || null, detalhe: detalhe || null });
}

app.post("/api/auth/login", (req, res) => {
  const { username, senha } = req.body || {};
  const user = usuariosRepo.findActiveByUsername(username || "");
  if (!user || !bcrypt.compareSync(senha || "", user.senha_hash))
    return res.status(401).json({ error: "Usuário ou senha inválidos." });
  audit(user.id, "login", "usuario", user.id, null);
  const equipe = user.equipe_id ? equipesRepo.findById(user.equipe_id) : null;
  res.json({
    token: sign(user),
    user: { id: user.id, nome: user.nome, papel: user.papel, username: user.username, equipe_id: user.equipe_id, equipe: equipe?.nome || null },
  });
});

// Versão em produção (SemVer, igual ao package.json e à tag do git). Pública, sem dados sensíveis.
const VERSAO = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")).version;
app.get("/api/versao", (_req, res) => res.json({ sistema: "SIGMA·CCM", versao: VERSAO }));

app.get("/api/auth/me", auth, (req, res) => {
  res.json(usuariosRepo.findProfile(req.user.id));
});

// ---------------------------------------------------------------
// Cadastros auxiliares (para selects)
// ---------------------------------------------------------------
app.get("/api/cadastros", auth, (req, res) => {
  res.json({
    equipamentos: equipamentosRepo.listForSelect(),
    equipes: equipesRepo.listForSelect(),
    planos: planosRepo.listForSelect(),
    // Colaboradores são os usuários ativos (o id é o do vínculo em colaboradores).
    colaboradores: colaboradoresRepo.listActiveUsers(),
  });
});

// ---------------------------------------------------------------
// Notas
// ---------------------------------------------------------------
app.get("/api/notas", auth, (req, res) => {
  res.json(notasRepo.listWithEquipment());
});

app.post("/api/notas", auth, (req, res) => {
  const { equipamento_id, descricao, tipo } = req.body || {};
  if (!descricao) return res.status(400).json({ error: "Informe a descrição da nota." });
  const max = notasRepo.maxNumero() || 14233;
  const numero = String(max + 1);
  const id = notasRepo.create({ numero, equipamentoId: equipamento_id || null, descricao, tipo: tipo || "Corretiva", solicitanteId: req.user.id });
  audit(req.user.id, "abrir_nota", "nota", id, numero);
  res.status(201).json({ id, numero });
});

app.post("/api/notas/:id/converter", auth, requireRole("CCM", "PCM"), (req, res) => {
  const nota = notasRepo.findById(req.params.id);
  if (!nota) return res.status(404).json({ error: "Nota não encontrada." });
  if (nota.status !== "Aberta") return res.status(400).json({ error: "A nota já foi convertida." });
  const max = ordensRepo.maxNumero() || 40012352;
  const numero = String(max + 1);
  const equipe = equipesRepo.findFirst();
  const id = ordensRepo.createFromNote({ numero, tipo: nota.tipo, equipamentoId: nota.equipamento_id, notaId: nota.id, equipeId: equipe ? equipe.id : null });
  notasRepo.markConverted(nota.id);
  audit(req.user.id, "converter_nota", "ordem", id, numero);
  res.status(201).json({ id, numero });
});

// ---------------------------------------------------------------
// Ordens
// ---------------------------------------------------------------
const CONDICOES = ["Apropriação", "Relatório", "Validação"];

function closeOrderIfComplete(orderId, userId) {
  const tipos = new Set(apontamentosRepo.listTypesByOrder(orderId));
  if (!CONDICOES.every((condition) => tipos.has(condition))) return false;
  // Checklists obrigatórios (formulários dinâmicos) também precisam estar respondidos.
  if (pendingRequiredForms(orderId) > 0) return false;
  if (!ordensRepo.closeIfOpen(orderId)) return false;
  audit(userId, "encerrar_auto", "ordem", orderId, String(orderId));
  return true;
}

app.get("/api/ordens", auth, (req, res) => {
  res.json(ordensRepo.list({ somenteDoResponsavel: req.user.papel === "EXECUTANTE", usuarioId: req.user.id }));
});

app.get("/api/ordens/executantes", auth, requireRole("CCM", "PCM"), (_req, res) => {
  res.json(usuariosRepo.listActiveExecutantes());
});

app.get("/api/ordens/:id", auth, (req, res) => {
  const o = ordensRepo.findDetail(req.params.id);
  if (!o) return res.status(404).json({ error: "Ordem não encontrada." });
  if (req.user.papel === "EXECUTANTE" && o.responsavel_id !== req.user.id) {
    return res.status(404).json({ error: "OM não encontrada." });
  }
  const aps = apontamentosRepo.listByOrder(o.id);
  o.apontamentos = aps;
  o.relatorio = relatoriosExecucaoRepo.findByOrder(o.id) || null;
  o.evidencias = evidenciasRepo.listSummaryByOrder(o.id);
  Object.assign(o, loadExecution(o.id));
  o.servidor_agora = sistemaRepo.now();
  const tipos = new Set(aps.map((a) => a.tipo));
  o.condicoes = CONDICOES.map((c) => ({ tipo: c, ok: tipos.has(c) }));
  o.formularios = orderForms(o.id);
  o.exige_pt = Boolean(o.exige_pt);
  o.permissoes = orderPermits(o.id);
  o.pt_vigente = validPermit(o.id);
  const obrigatorios = o.formularios.filter((form) => form.obrigatorio);
  if (obrigatorios.length) o.condicoes.push({ tipo: "Checklists", ok: obrigatorios.every((form) => form.ultima_resposta) });
  res.json(o);
});

// Programação: datas e vínculo com o plano de manutenção.
app.patch("/api/ordens/:id/programacao", auth, requireRole("CCM", "PCM"), (req, res) => {
  const order = ordensRepo.findSummary(req.params.id);
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
  if (planoId !== null && !planosRepo.exists(planoId)) {
    return res.status(400).json({ error: "Selecione um plano de manutenção cadastrado." });
  }
  // Só a OM aberta muda de status; a reprogramação mantém a distribuição e a execução.
  const status = order.status === "Aberta" ? "Programada" : order.status;
  transaction(() => {
    ordensRepo.updateSchedule(order.id, { inicio, fim, planoId, status });
    audit(req.user.id, "programar_ordem", "ordem", order.id,
      `OM ${order.numero} · ${dataBr(inicio)}${fim ? ` a ${dataBr(fim)}` : ""} · ${planoId ? `plano ${planoId}` : "sem plano"}`);
  });
  res.json({ ok: true, status, data_programada: inicio, data_fim_programada: fim, plano_id: planoId });
});

app.patch("/api/ordens/:id/status", auth, requireRole("CCM", "PCM"), (req, res) => {
  const { status } = req.body || {};
  const valid = ["Aberta", "Programada", "Distribuída", "Em execução", "Encerrada", "Cancelada"];
  if (!valid.includes(status)) return res.status(400).json({ error: "Status inválido." });
  if (status === "Distribuída") {
    const responsavelId = Number(req.body.responsavel_id);
    const executante = usuariosRepo.findActiveExecutante(responsavelId);
    if (!executante) return res.status(400).json({ error: "Selecione um usuário ativo com acesso EXECUTANTE." });
    if (!ordensRepo.distribute(req.params.id, { status, responsavelId })) return res.status(404).json({ error: "Ordem não encontrada." });
    audit(req.user.id, "distribuir_ordem", "ordem", Number(req.params.id), `Executante ${responsavelId}`);
    return res.json({ ok: true, responsavel_id: responsavelId });
  }
  const encerramento = status === "Encerrada" ? "10/07" : null;
  if (!ordensRepo.updateStatus(req.params.id, { status, encerramento })) return res.status(404).json({ error: "Ordem não encontrada." });
  audit(req.user.id, "status_ordem", "ordem", Number(req.params.id), status);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Apontamentos (detecção IA + encerramento automático)
// ---------------------------------------------------------------
// Deve ser chamada dentro de uma transação.
// `data` (UTC) permite registrar o momento real de um apontamento feito offline.
function registrarApontamento(om, user, tipo, horas, descricao = null, data = null) {
  const duplicate = apontamentosRepo.findByOrderAndType(om.id, tipo);
  if (duplicate) throw Object.assign(new Error("Este registro já existe para a OM."), { code: "DUPLICATE_APONTAMENTO" });
  const id = apontamentosRepo.create({ ordemId: om.id, usuarioId: user.id, tipo, horas, descricao, data });
  audit(user.id, "apontar", "apontamento", id, `OM ${om.numero} · ${tipo}`);

  let sinal = null;
  if (tipo === "Apropriação") {
    const flag = detectar(horas, om.hh_previsto);
    if (flag) {
      const sinalId = sinalizacoesRepo.createForAppointment({
        apontamentoId: id, ordemNumero: om.numero, valorAtual: horas, valorSugerido: flag.sugerido,
        tipo: flag.tipo, score: flag.score, explicacao: JSON.stringify(flag.fatores),
      });
      sinal = { id: sinalId, tipo: flag.tipo, score: flag.score };
    }
  }
  if (om.status !== "Em execução" && om.status !== "Encerrada") {
    ordensRepo.markInExecution(om.id);
  }
  const encerrada = closeOrderIfComplete(om.id, user.id);
  return { id, sinal, encerrada, ordem_numero: om.numero, usuario_nome: user.nome };
}

app.post("/api/apontamentos", auth, requireRole("EXECUTANTE"), (req, res) => {
  const { ordem_id, tipo, hh } = req.body || {};
  const om = ordensRepo.findById(ordem_id);
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
    const result = transaction(() => {
      // Com o cronômetro em andamento, o HH vem da finalização da execução, não de digitação.
      if (tipo === "Apropriação" && execucoesRepo.isRunning(om.id)) {
        throw Object.assign(new Error("A OM está em andamento: finalize a execução para apropriar o HH."), { code: "DUPLICATE_APONTAMENTO" });
      }
      return registrarApontamento(om, req.user, tipo, horas, null, momento.value);
    });
    res.status(201).json(result);
  } catch (error) {
    if (error.code === "DUPLICATE_APONTAMENTO") return res.status(409).json({ error: error.message });
    throw error;
  }
});

app.put("/api/ordens/:id/relatorio", auth, requireRole("EXECUTANTE"), (req, res) => {
  const order = ordensRepo.findById(req.params.id);
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

  const report = transaction(() => {
    const savedId = relatoriosExecucaoRepo.upsert({
      ordemId: order.id, usuarioId: req.user.id, atividade, resultado: body.resultado || null, materiais: body.materiais_utilizados || null,
      observacoes: body.observacoes || null, indisponibilidade: downtime, reparo: repairTime,
    });
    apontamentosRepo.createReportIfMissing(order.id, req.user.id, atividade);
    if (order.status !== "Em execução" && order.status !== "Encerrada") {
      ordensRepo.markInExecution(order.id);
    }
    audit(req.user.id, "salvar_relatorio_om", "ordem", order.id, `Relatório ${savedId}`);
    const encerrada = closeOrderIfComplete(order.id, req.user.id);
    return { id: savedId, encerrada };
  });

  res.json(report);
});

// ---------------------------------------------------------------
// Usuários (cadastro — restrito ao papel CCM)
// ---------------------------------------------------------------
app.get("/api/usuarios", auth, requireRole("CCM"), (req, res) => {
  res.json(usuariosRepo.listWithTeam());
});

const findTeam = (id) => equipesRepo.findById(Number(id));

app.post("/api/usuarios", auth, requireRole("CCM"), (req, res) => {
  const { nome, username, senha, papel, email, equipe_id } = req.body || {};
  if (!nome || !username || !senha) return res.status(400).json({ error: "Nome, usuário e senha são obrigatórios." });
  if (!["CCM", "PCM", "EXECUTANTE"].includes(papel)) return res.status(400).json({ error: "Papel inválido." });
  const equipe = findTeam(equipe_id);
  if (!equipe) return res.status(400).json({ error: "Selecione uma equipe cadastrada para o usuário." });
  const existe = usuariosRepo.findIdByUsername(username);
  if (existe) return res.status(409).json({ error: "Este usuário já existe." });
  try {
    const id = usuariosRepo.create({ nome, email: email || null, username, senhaHash: bcrypt.hashSync(senha, 10), papel, equipeId: equipe.id });
    colaboradoresRepo.syncFromUsers();
    audit(req.user.id, "criar_usuario", "usuario", id, `${username} · ${equipe.nome}`);
    res.status(201).json({ id });
  } catch (e) {
    res.status(400).json({ error: "Não foi possível criar o usuário." });
  }
});

app.patch("/api/usuarios/:id/equipe", auth, requireRole("CCM"), (req, res) => {
  const equipe = findTeam((req.body || {}).equipe_id);
  if (!equipe) return res.status(400).json({ error: "Selecione uma equipe cadastrada para o usuário." });
  if (!usuariosRepo.updateTeam(req.params.id, equipe.id)) return res.status(404).json({ error: "Usuário não encontrado." });
  colaboradoresRepo.updateTeamForUser(req.params.id, equipe.id);
  audit(req.user.id, "vincular_equipe_usuario", "usuario", Number(req.params.id), equipe.nome);
  res.json({ ok: true, equipe_id: equipe.id, equipe: equipe.nome });
});

// ---------------------------------------------------------------
// Servir o frontend buildado (produção)
// ---------------------------------------------------------------
const clientDist = join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(clientDist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`SIGMA-CCM API em http://localhost:${PORT} (versão ${VERSAO}, ambiente ${config.env})`);
  console.log(`Banco: ${config.dbPath} · CORS: ${config.corsOrigins.join(", ")} · validade do token: ${config.jwtExpiresIn}`);
});
