import { Router } from "express";
import { equipamentosRepo, formulariosRepo, ordensRepo, respostasFormularioRepo, transaction } from "../data/index.js";
import { orderForms, parseJson, validateTemplate } from "../formularios.js";
import { activeModel, evaluateRequest, formUpload, insertResponse, readModel, submissionData, uploadErrors } from "../formularios-envio.js";
import { clientTimestamp } from "../offline.js";

export default function createFormsRouter({ auth, requireRole, audit, closeOrderIfComplete }) {
  const router = Router();
  router.use(auth);
  const ccm = requireRole("CCM");
  const gestao = requireRole("CCM", "PCM");

  const findOrder = (id) => ordensRepo.findForForms(id);
  // Executante só acessa OMs atribuídas a ele.
  const canUseOrder = (req, order) => order && (req.user.papel !== "EXECUTANTE" || order.responsavel_id === req.user.id);

  // ----------------------------------------------------------- Modelos (No-Code)
  router.get("/modelos", (req, res) => {
    const todos = req.user.papel === "CCM" && req.query.todos === "1";
    res.json(formulariosRepo.listWithStats(todos).map(readModel));
  });

  router.get("/modelos/:id", (req, res) => {
    const model = readModel(formulariosRepo.findById(req.params.id));
    if (!model || (!model.ativo && req.user.papel !== "CCM")) return res.status(404).json({ error: "Formulário não encontrado." });
    res.json(model);
  });

  router.post("/modelos", ccm, (req, res) => {
    const valid = validateTemplate(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const created = transaction(() => {
      const id = formulariosRepo.create({
        nome: valid.nome, tipo: valid.tipo, descricao: valid.descricao, campos: JSON.stringify(valid.campos), regras: JSON.stringify(valid.regras), usuarioId: req.user.id,
      });
      audit(req.user.id, "criar_modelo_formulario", "formulario_modelo", id, `${valid.tipo} · ${valid.nome} · ${valid.campos.length} campos`);
      return { id, versao: 1 };
    });
    res.status(201).json(created);
  });

  // Cada alteração gera nova versão; as respostas guardam o modelo da época em que foram preenchidas.
  router.put("/modelos/:id", ccm, (req, res) => {
    const current = formulariosRepo.findVersion(req.params.id);
    if (!current) return res.status(404).json({ error: "Formulário não encontrado." });
    const valid = validateTemplate(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const ativo = req.body.ativo === undefined ? current.ativo : (req.body.ativo ? 1 : 0);
    transaction(() => {
      formulariosRepo.update(current.id, {
        nome: valid.nome, tipo: valid.tipo, descricao: valid.descricao, campos: JSON.stringify(valid.campos), regras: JSON.stringify(valid.regras), ativo, usuarioId: req.user.id,
      });
      audit(req.user.id, "editar_modelo_formulario", "formulario_modelo", current.id, `${valid.nome} · versão ${current.versao + 1}${ativo ? "" : " · inativo"}`);
    });
    res.json({ id: current.id, versao: current.versao + 1 });
  });

  // Com respostas, o modelo é desativado (preserva o histórico); sem respostas, é excluído.
  router.delete("/modelos/:id", ccm, (req, res) => {
    const current = formulariosRepo.findName(req.params.id);
    if (!current) return res.status(404).json({ error: "Formulário não encontrado." });
    const result = transaction(() => {
      const used = formulariosRepo.countResponses(current.id);
      if (used) {
        formulariosRepo.deactivate(current.id, req.user.id);
        audit(req.user.id, "desativar_modelo_formulario", "formulario_modelo", current.id, `${current.nome} · ${used} resposta(s)`);
        return { desativado: true };
      }
      formulariosRepo.remove(current.id);
      audit(req.user.id, "excluir_modelo_formulario", "formulario_modelo", current.id, current.nome);
      return { excluido: true };
    });
    res.json(result);
  });

  // ----------------------------------------------------------- Checklist inteligente da OM
  router.get("/ordem/:id", (req, res) => {
    const order = findOrder(req.params.id);
    if (!canUseOrder(req, order)) return res.status(404).json({ error: "OM não encontrada." });
    res.json(orderForms(order.id));
  });

  router.post("/ordem/:id/vinculos", gestao, (req, res) => {
    const order = findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "OM não encontrada." });
    const model = formulariosRepo.findActiveName(Number((req.body || {}).modelo_id));
    if (!model) return res.status(400).json({ error: "Selecione um formulário ativo." });
    const obrigatorio = req.body.obrigatorio ? 1 : 0;
    transaction(() => {
      formulariosRepo.upsertOrderLink({ ordemId: order.id, modeloId: model.id, obrigatorio, usuarioId: req.user.id });
      audit(req.user.id, "vincular_formulario_om", "ordem", order.id, `OM ${order.numero} · ${model.nome}${obrigatorio ? " · obrigatório" : ""}`);
    });
    res.status(201).json(orderForms(order.id));
  });

  router.delete("/ordem/:id/vinculos/:modeloId", gestao, (req, res) => {
    const order = findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "OM não encontrada." });
    const removed = transaction(() => {
      const changes = formulariosRepo.removeOrderLink(order.id, req.params.modeloId);
      if (changes) audit(req.user.id, "desvincular_formulario_om", "ordem", order.id, `OM ${order.numero} · modelo ${req.params.modeloId}`);
      return changes;
    });
    if (!removed) return res.status(404).json({ error: "Vínculo não encontrado." });
    res.json(orderForms(order.id));
  });

  // ----------------------------------------------------------- Respostas
  // multipart: "dados" (JSON com modelo_id, ordem_id, equipamento_id, respostas) + "arquivo:<campo>" (foto/assinatura).
  router.post("/respostas", formUpload.any(), (req, res) => {
    const dados = submissionData(req);
    if (!dados) return res.status(400).json({ error: "Envio inválido." });
    const model = activeModel(dados.modelo_id);
    if (!model) return res.status(400).json({ error: "Selecione um formulário ativo." });

    let order = null;
    if (dados.ordem_id) {
      order = findOrder(Number(dados.ordem_id));
      if (!canUseOrder(req, order)) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
      if (order.status === "Encerrada" || order.status === "Cancelada") return res.status(409).json({ error: `A OM ${order.numero} está ${order.status.toLowerCase()}.` });
    }
    const equipamentoId = order?.equipamento_id ?? (dados.equipamento_id ? Number(dados.equipamento_id) : null);
    if (equipamentoId && !equipamentosRepo.exists(equipamentoId)) return res.status(400).json({ error: "Equipamento não encontrado." });
    if (!order && !equipamentoId) return res.status(400).json({ error: "Vincule a resposta a uma OM ou a um equipamento." });

    const result = evaluateRequest(model, dados.respostas, req.files);
    if (result.error) return res.status(400).json({ error: result.error });
    const preenchido = clientTimestamp(dados.preenchido_em);
    if (preenchido.error) return res.status(400).json({ error: preenchido.error });

    const saved = transaction(() => {
      const id = insertResponse({ model, ordemId: order?.id ?? null, equipamentoId, result, userId: req.user.id, criadoEm: preenchido.value });
      audit(req.user.id, "responder_formulario", "formulario_resposta", id,
        `${model.nome} v${model.versao}${order ? ` · OM ${order.numero}` : ""} · ${result.naoConformidades.length} não conformidade(s)`);
      const encerrada = order ? closeOrderIfComplete(order.id, req.user.id) : false;
      return { id, nao_conformidades: result.naoConformidades, encerrada };
    });
    res.status(201).json(saved);
  });

  router.get("/respostas", (req, res) => {
    const own = req.user.papel === "EXECUTANTE";
    const filtro = (key) => (req.query[key] ? Number(req.query[key]) : null);
    // Executante vê o que preencheu e as respostas das OMs atribuídas a ele.
    res.json(respostasFormularioRepo.list({
      modeloId: filtro("modelo_id"), ordemId: filtro("ordem_id"), equipamentoId: filtro("equipamento_id"), responsavelId: own ? req.user.id : null,
    }).map((row) => ({ ...row, nao_conformidades: parseJson(row.nao_conformidades, []).length })));
  });

  const findResponse = (req) => {
    const row = respostasFormularioRepo.findDetail(req.params.id);
    if (!row) return null;
    if (req.user.papel === "EXECUTANTE" && row.usuario_id !== req.user.id && row.responsavel_id !== req.user.id) return null;
    return row;
  };

  router.get("/respostas/:id", (req, res) => {
    const row = findResponse(req);
    if (!row) return res.status(404).json({ error: "Resposta não encontrada." });
    const { responsavel_id: _owner, ...rest } = row;
    res.json({
      ...rest,
      campos: parseJson(row.campos, []),
      respostas: parseJson(row.respostas, {}),
      nao_conformidades: parseJson(row.nao_conformidades, []),
      anexos: respostasFormularioRepo.listAttachments(row.id),
    });
  });

  router.get("/respostas/:id/anexos/:anexoId", (req, res) => {
    const row = findResponse(req);
    if (!row) return res.status(404).json({ error: "Resposta não encontrada." });
    const file = respostasFormularioRepo.findAttachment(req.params.anexoId, row.id);
    if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
    res.type(file.tipo_mime).set("Content-Disposition", "inline").send(file.conteudo);
  });

  router.use(uploadErrors);

  return router;
}
