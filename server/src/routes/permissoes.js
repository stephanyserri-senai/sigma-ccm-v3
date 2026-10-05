import { Router } from "express";
import { ordensRepo, permissoesTrabalhoRepo, transaction } from "../data/index.js";
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
export function validPermit(orderId) {
  return permissoesTrabalhoRepo.findValid(orderId, localDateTime()) || null;
}

export function orderPermits(orderId) {
  return permissoesTrabalhoRepo.listByOrder(orderId);
}

// Permissão de Trabalho (APR/PT): solicitar → aprovar/reprovar → encerrar, sempre auditado.
export default function createPermitsRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const gestao = requireRole("CCM", "PCM");
  const isManager = (req) => req.user.papel !== "EXECUTANTE";
  const findOrder = (id) => ordensRepo.findForPermit(Number(id));

  const present = (row) => {
    const { responsavel_id: _owner, ...rest } = row;
    const now = localDateTime();
    return { ...rest, exige_pt: Boolean(row.exige_pt), nao_conformidades: parseJson(row.nao_conformidades, []),
      vigente: row.status === "Aprovada" && row.validade_inicio <= now && row.validade_fim >= now };
  };
  const canSee = (req, row) => isManager(req) || row.solicitante_id === req.user.id || row.responsavel_id === req.user.id;

  router.get("/", (req, res) => {
    res.json(permissoesTrabalhoRepo.list({
      status: req.query.status ? String(req.query.status) : null,
      ordemId: req.query.ordem_id ? Number(req.query.ordem_id) : null,
      envolvidoId: isManager(req) ? null : req.user.id,
    }).map(present));
  });

  router.get("/:id", (req, res) => {
    const row = permissoesTrabalhoRepo.findDetail(req.params.id);
    if (!row || !canSee(req, row)) return res.status(404).json({ error: "Permissão não encontrada." });
    res.json(present(row));
  });

  router.post("/", formUpload.any(), (req, res) => {
    const dados = submissionData(req);
    if (!dados) return res.status(400).json({ error: "Envio inválido." });
    const order = findOrder(dados.ordem_id);
    if (!order || (!isManager(req) && order.responsavel_id !== req.user.id)) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
    if (order.status === "Encerrada" || order.status === "Cancelada") return res.status(409).json({ error: `A OM ${order.numero} está ${order.status.toLowerCase()}.` });
    const model = activeModel(dados.modelo_id);
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

    const created = transaction(() => {
      const respostaId = insertResponse({ model, ordemId: order.id, equipamentoId: order.equipamento_id, result, userId: req.user.id });
      const next = (permissoesTrabalhoRepo.maxId() || 0) + 1;
      const numero = `PT-${String(next).padStart(5, "0")}`;
      const id = permissoesTrabalhoRepo.create({
        numero, ordemId: order.id, modeloId: model.id, respostaId, inicio, fim, solicitanteId: req.user.id,
      });
      // Uma OM com PT solicitada passa a exigir PT aprovada para iniciar a execução.
      ordensRepo.setRequiresPermit(order.id, 1);
      audit(req.user.id, "solicitar_permissao_trabalho", "permissao_trabalho", id,
        `${numero} · OM ${order.numero} · ${inicio} a ${fim} · ${result.naoConformidades.length} alerta(s) de risco`);
      return { id, numero, nao_conformidades: result.naoConformidades };
    });
    res.status(201).json(created);
  });

  const transition = (from, to, action, { requireParecer = false, allow }) => (req, res) => {
    const row = permissoesTrabalhoRepo.findDetail(req.params.id);
    if (!row || !canSee(req, row)) return res.status(404).json({ error: "Permissão não encontrada." });
    const denied = allow(req, row);
    if (denied) return res.status(403).json({ error: denied });
    if (row.status !== from) return res.status(409).json({ error: `A ${row.numero} está ${row.status.toLowerCase()}.` });
    const parecer = String((req.body || {}).parecer || "").trim().slice(0, 1000) || null;
    if (requireParecer && !parecer) return res.status(400).json({ error: "Informe o motivo." });
    transaction(() => {
      if (to === "Encerrada") permissoesTrabalhoRepo.close(row.id, { status: to, usuarioId: req.user.id, observacao: parecer });
      else if (to === "Cancelada") permissoesTrabalhoRepo.cancel(row.id, { status: to, parecer });
      else permissoesTrabalhoRepo.decide(row.id, { status: to, aprovadorId: req.user.id, parecer });
      audit(req.user.id, action, "permissao_trabalho", row.id, `${row.numero} · OM ${row.ordem_numero}${parecer ? ` · ${parecer}` : ""}`);
    });
    res.json(present(permissoesTrabalhoRepo.findDetail(row.id)));
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
    transaction(() => {
      ordensRepo.setRequiresPermit(order.id, exige);
      audit(req.user.id, "exigencia_pt_ordem", "ordem", order.id, `OM ${order.numero} · ${exige ? "exige PT" : "não exige PT"}`);
    });
    res.json({ ok: true, exige_pt: Boolean(exige) });
  });

  router.use(uploadErrors);
  return router;
}
