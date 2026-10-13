import { Router } from "express";
import { equipamentosRepo, formulariosRepo, ordensRepo, respostasFormularioRepo, transaction } from "../data/index.js";
import { orderForms, parseJson, validateTemplate } from "../formularios.js";
import { activeModel, evaluateRequest, formUpload, insertResponse, readModel, submissionData, uploadErrors } from "../formularios-envio.js";
import { clientTimestamp } from "../offline.js";
import { createFormResponsePdf } from "../pdf.js";

export default function createFormsRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const ccm = requireRole("CCM");
  const gestao = requireRole("CCM", "PCM");

  const findOrder = async (id) => await ordensRepo.findForForms(id);
  // Executante só acessa OMs atribuídas a ele.
  const canUseOrder = (req, order) => order && (req.user.papel !== "EXECUTANTE" || order.responsavel_id === req.user.id);

  // ----------------------------------------------------------- Modelos (No-Code)
  router.get("/modelos", async (req, res) => {
    const todos = req.user.papel === "CCM" && req.query.todos === "1";
    res.json((await formulariosRepo.listWithStats(todos)).map(readModel));
  });

  router.get("/modelos/:id", async (req, res) => {
    const model = readModel(await formulariosRepo.findById(req.params.id));
    if (!model || (!model.ativo && req.user.papel !== "CCM")) return res.status(404).json({ error: "Formulário não encontrado." });
    res.json(model);
  });

  router.get("/modelos/:id/pdf", async (req, res) => {
    const model = readModel(await formulariosRepo.findById(req.params.id));
    if (!model || (!model.ativo && req.user.papel !== "CCM")) return res.status(404).json({ error: "Formulário não encontrado." });
    const pdf = await createFormResponsePdf({
      emBranco: true,
      resposta: {
        id: model.id, modelo_nome: model.nome, modelo_tipo: model.tipo, modelo_versao: model.versao,
        campos: model.campos, respostas: {}, nao_conformidades: [],
      },
      anexos: [],
    });
    const slug = model.nome.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "formulario";
    await audit(req.user.id, "gerar_modelo_formulario_pdf", "formulario_modelo", model.id, `${model.nome} · versão ${model.versao}`);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="modelo-${slug}-v${model.versao}.pdf"`,
      "Cache-Control": "no-store",
    }).send(pdf);
  });

  router.post("/modelos", ccm, async (req, res) => {
    const valid = validateTemplate(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const created = await transaction(async () => {
      const id = await formulariosRepo.create({
        nome: valid.nome, tipo: valid.tipo, descricao: valid.descricao, campos: JSON.stringify(valid.campos), regras: JSON.stringify(valid.regras), usuarioId: req.user.id,
      });
      await audit(req.user.id, "criar_modelo_formulario", "formulario_modelo", id, `${valid.tipo} · ${valid.nome} · ${valid.campos.length} campos`);
      return { id, versao: 1 };
    });
    res.status(201).json(created);
  });

  // Cada alteração gera nova versão; as respostas guardam o modelo da época em que foram preenchidas.
  router.put("/modelos/:id", ccm, async (req, res) => {
    const current = await formulariosRepo.findVersion(req.params.id);
    if (!current) return res.status(404).json({ error: "Formulário não encontrado." });
    const valid = validateTemplate(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const ativo = req.body.ativo === undefined ? current.ativo : (req.body.ativo ? 1 : 0);
    await transaction(async () => {
      await formulariosRepo.update(current.id, {
        nome: valid.nome, tipo: valid.tipo, descricao: valid.descricao, campos: JSON.stringify(valid.campos), regras: JSON.stringify(valid.regras), ativo, usuarioId: req.user.id,
      });
      await audit(req.user.id, "editar_modelo_formulario", "formulario_modelo", current.id, `${valid.nome} · versão ${current.versao + 1}${ativo ? "" : " · inativo"}`);
    });
    res.json({ id: current.id, versao: current.versao + 1 });
  });

  // Com respostas, o modelo é desativado (preserva o histórico); sem respostas, é excluído.
  router.delete("/modelos/:id", ccm, async (req, res) => {
    const current = await formulariosRepo.findName(req.params.id);
    if (!current) return res.status(404).json({ error: "Formulário não encontrado." });
    const result = await transaction(async () => {
      const used = await formulariosRepo.countResponses(current.id);
      if (used) {
        await formulariosRepo.deactivate(current.id, req.user.id);
        await audit(req.user.id, "desativar_modelo_formulario", "formulario_modelo", current.id, `${current.nome} · ${used} resposta(s)`);
        return { desativado: true };
      }
      await formulariosRepo.remove(current.id);
      await audit(req.user.id, "excluir_modelo_formulario", "formulario_modelo", current.id, current.nome);
      return { excluido: true };
    });
    res.json(result);
  });

  // ----------------------------------------------------------- Checklist inteligente da OM
  router.get("/ordem/:id", async (req, res) => {
    const order = await findOrder(req.params.id);
    if (!canUseOrder(req, order)) return res.status(404).json({ error: "OM não encontrada." });
    res.json(await orderForms(order.id));
  });

  router.post("/ordem/:id/vinculos", gestao, async (req, res) => {
    const order = await findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "OM não encontrada." });
    const model = await formulariosRepo.findActiveName(Number((req.body || {}).modelo_id));
    if (!model) return res.status(400).json({ error: "Selecione um formulário ativo." });
    const obrigatorio = req.body.obrigatorio ? 1 : 0;
    await transaction(async () => {
      await formulariosRepo.upsertOrderLink({ ordemId: order.id, modeloId: model.id, obrigatorio, usuarioId: req.user.id });
      await audit(req.user.id, "vincular_formulario_om", "ordem", order.id, `OM ${order.numero} · ${model.nome}${obrigatorio ? " · obrigatório" : ""}`);
    });
    res.status(201).json(await orderForms(order.id));
  });

  router.delete("/ordem/:id/vinculos/:modeloId", gestao, async (req, res) => {
    const order = await findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "OM não encontrada." });
    const removed = await transaction(async () => {
      const changes = await formulariosRepo.removeOrderLink(order.id, req.params.modeloId);
      if (changes) await audit(req.user.id, "desvincular_formulario_om", "ordem", order.id, `OM ${order.numero} · modelo ${req.params.modeloId}`);
      return changes;
    });
    if (!removed) return res.status(404).json({ error: "Vínculo não encontrado." });
    res.json(await orderForms(order.id));
  });

  // ----------------------------------------------------------- Respostas
  // multipart: "dados" (JSON com modelo_id, ordem_id, equipamento_id, respostas) + "arquivo:<campo>" (foto/assinatura).
  router.post("/respostas", formUpload.any(), async (req, res) => {
    const dados = submissionData(req);
    if (!dados) return res.status(400).json({ error: "Envio inválido." });
    const model = await activeModel(dados.modelo_id);
    if (!model) return res.status(400).json({ error: "Selecione um formulário ativo." });

    let order = null;
    if (dados.ordem_id) {
      order = await findOrder(Number(dados.ordem_id));
      if (!canUseOrder(req, order)) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
      if (order.status === "Encerrada" || order.status === "Cancelada") return res.status(409).json({ error: `A OM ${order.numero} está ${order.status.toLowerCase()}.` });
    }
    const equipamentoId = order?.equipamento_id ?? (dados.equipamento_id ? Number(dados.equipamento_id) : null);
    if (equipamentoId && !await equipamentosRepo.exists(equipamentoId)) return res.status(400).json({ error: "Equipamento não encontrado." });
    if (!order && !equipamentoId) return res.status(400).json({ error: "Vincule a resposta a uma OM ou a um equipamento." });

    const result = evaluateRequest(model, dados.respostas, req.files);
    if (result.error) return res.status(400).json({ error: result.error });
    const preenchido = clientTimestamp(dados.preenchido_em);
    if (preenchido.error) return res.status(400).json({ error: preenchido.error });

    const saved = await transaction(async () => {
      const id = await insertResponse({ model, ordemId: order?.id ?? null, equipamentoId, result, userId: req.user.id, criadoEm: preenchido.value });
      await audit(req.user.id, "responder_formulario", "formulario_resposta", id,
        `${model.nome} v${model.versao}${order ? ` · OM ${order.numero}` : ""} · ${result.naoConformidades.length} não conformidade(s)`);
      return { id, nao_conformidades: result.naoConformidades };
    });
    res.status(201).json(saved);
  });

  router.get("/respostas", async (req, res) => {
    const own = req.user.papel === "EXECUTANTE";
    const filtro = (key) => (req.query[key] ? Number(req.query[key]) : null);
    // Executante vê o que preencheu e as respostas das OMs atribuídas a ele.
    res.json((await respostasFormularioRepo.list({
      modeloId: filtro("modelo_id"), ordemId: filtro("ordem_id"), equipamentoId: filtro("equipamento_id"), responsavelId: own ? req.user.id : null,
    })).map((row) => ({ ...row, nao_conformidades: parseJson(row.nao_conformidades, []).length })));
  });

  const findResponse = async (req) => {
    const row = await respostasFormularioRepo.findDetail(req.params.id);
    if (!row) return null;
    if (req.user.papel === "EXECUTANTE" && row.usuario_id !== req.user.id && row.responsavel_id !== req.user.id) return null;
    return row;
  };

  router.get("/respostas/:id/pdf", async (req, res) => {
    const row = await findResponse(req);
    if (!row) return res.status(404).json({ error: "Resposta não encontrada." });
    const resposta = {
      ...row,
      campos: parseJson(row.campos, []),
      respostas: parseJson(row.respostas, {}),
      nao_conformidades: parseJson(row.nao_conformidades, []),
    };
    const pdf = await createFormResponsePdf({
      resposta,
      anexos: await respostasFormularioRepo.listAttachmentsForPdf(row.id),
    });
    const slug = row.modelo_nome.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "formulario";
    await audit(req.user.id, "gerar_formulario_pdf", "formulario_resposta", row.id, `${row.modelo_nome} · resposta ${row.id}`);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="formulario-${slug}-${row.id}.pdf"`,
      "Cache-Control": "no-store",
    }).send(pdf);
  });

  router.get("/respostas/:id", async (req, res) => {
    const row = await findResponse(req);
    if (!row) return res.status(404).json({ error: "Resposta não encontrada." });
    const { responsavel_id: _owner, ...rest } = row;
    res.json({
      ...rest,
      campos: parseJson(row.campos, []),
      respostas: parseJson(row.respostas, {}),
      nao_conformidades: parseJson(row.nao_conformidades, []),
      anexos: await respostasFormularioRepo.listAttachments(row.id),
    });
  });

  router.get("/respostas/:id/anexos/:anexoId", async (req, res) => {
    const row = await findResponse(req);
    if (!row) return res.status(404).json({ error: "Resposta não encontrada." });
    const file = await respostasFormularioRepo.findAttachment(req.params.anexoId, row.id);
    if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
    res.type(file.tipo_mime).set("Content-Disposition", "inline").send(file.conteudo);
  });

  router.use(uploadErrors);

  return router;
}
