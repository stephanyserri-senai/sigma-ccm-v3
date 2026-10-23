import { Router } from "express";
import {
  colaboradoresRepo, equipamentosRepo, equipesRepo, ordensRepo, planosRepo,
  isForeignKeyViolation, isUniqueViolation, transaction, uniqueViolation,
} from "../data/index.js";

const CLASS_PREFIXES = {
  bomba: "BOM",
  motor: "MOT",
  painel: "PNL",
  correia: "CTR",
  compressor: "COM",
  sensor: "SEN",
};

const normalize = (value) => String(value ?? "").trim();
const nullableId = (value) => value === "" || value == null ? null : Number(value);

export function prefixForEquipment(classe, descricao) {
  const normalizedClass = normalize(classe).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const explicit = Object.entries(CLASS_PREFIXES).find(([key]) => normalizedClass.startsWith(key));
  const source = explicit ? explicit[0] : normalizedClass || normalize(descricao);
  const letters = source.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/gi, "").toUpperCase();
  return (explicit?.[1] || letters.slice(0, 3) || "EQP").padEnd(3, "X");
}

async function nextTag(prefix, excludeId = null) {
  let sequence = 0;
  for (const tag of await equipamentosRepo.listTagsWithPrefix(prefix, excludeId)) {
    const match = new RegExp(`^${prefix}-(\\d+)$`, "i").exec(tag);
    if (match) sequence = Math.max(sequence, Number(match[1]));
  }
  let candidate;
  do {
    sequence += 1;
    candidate = `${prefix}-${String(sequence).padStart(4, "0")}`;
  } while (await equipamentosRepo.tagExists(candidate, excludeId));
  return candidate;
}

function validateEquipment(body) {
  const descricao = normalize(body.descricao);
  const classe = normalize(body.classe);
  if (!descricao) return { error: "Informe a descrição do equipamento." };
  if (!classe) return { error: "Selecione a classe do equipamento." };
  return { descricao, classe };
}

function conflictOrBadRequest(error, res) {
  if (isUniqueViolation(error)) {
    return res.status(409).json({ error: "A TAG já está cadastrada." });
  }
  if (isForeignKeyViolation(error)) {
    return res.status(409).json({ error: "Registro associado a outros dados e não pode ser excluído." });
  }
  return res.status(400).json({ error: "Dados inválidos para este cadastro." });
}

export default function createCadastrosRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth, requireRole("CCM"));

  router.get("/equipamentos", async (_req, res) => {
    res.json(await equipamentosRepo.listWithParent());
  });

  router.post("/equipamentos/tag-preview", async (req, res) => {
    const valid = validateEquipment(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const prefix = prefixForEquipment(valid.classe, valid.descricao);
    res.json({ tag: await nextTag(prefix), prefix });
  });

  const equipmentData = (body, valid, tag) => ({
    tag, descricao: valid.descricao, localizacao: normalize(body.localizacao) || null, classe: valid.classe,
    criticidade: normalize(body.criticidade) || "Média", paiId: nullableId(body.pai_id), equipeId: nullableId(body.equipe_id),
  });

  router.post("/equipamentos", async (req, res) => {
    const body = req.body || {};
    const valid = validateEquipment(body);
    if (valid.error) return res.status(400).json({ error: valid.error });
    const tagManual = body.tag_mode === "manual";
    const manualTag = normalize(body.tag).toUpperCase();
    if (tagManual && !manualTag) return res.status(400).json({ error: "Informe a TAG manual." });

    try {
      const created = await transaction(async () => {
        const tag = tagManual ? manualTag : await nextTag(prefixForEquipment(valid.classe, valid.descricao));
        if (await equipamentosRepo.tagTakenIgnoringCase(tag)) throw uniqueViolation("TAG duplicada");
        const id = await equipamentosRepo.create(equipmentData(body, valid, tag));
        await audit(req.user.id, "criar_equipamento", "equipamento", id, tag);
        return { id, tag };
      });
      res.status(201).json(created);
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.put("/equipamentos/:id", async (req, res) => {
    const body = req.body || {};
    const valid = validateEquipment(body);
    if (valid.error) return res.status(400).json({ error: valid.error });
    const id = Number(req.params.id);
    const tagManual = body.tag_mode === "manual";
    const manualTag = normalize(body.tag).toUpperCase();
    if (tagManual && !manualTag) return res.status(400).json({ error: "Informe a TAG manual." });

    try {
      const updated = await transaction(async () => {
        if (!await equipamentosRepo.findById(id)) return null;
        const tag = tagManual ? manualTag : await nextTag(prefixForEquipment(valid.classe, valid.descricao), id);
        if (await equipamentosRepo.tagTakenIgnoringCase(tag, id)) throw uniqueViolation("TAG duplicada");
        await equipamentosRepo.update(id, equipmentData(body, valid, tag));
        await audit(req.user.id, "editar_equipamento", "equipamento", id, tag);
        return { id, tag };
      });
      if (!updated) return res.status(404).json({ error: "Equipamento não encontrado." });
      res.json(updated);
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.delete("/equipamentos/:id", async (req, res) => {
    const id = Number(req.params.id);
    try {
      const deleted = await transaction(async () => {
        const row = await equipamentosRepo.findTag(id);
        if (!row) return false;
        await equipamentosRepo.remove(id);
        await audit(req.user.id, "excluir_equipamento", "equipamento", id, row.tag);
        return true;
      });
      if (!deleted) return res.status(404).json({ error: "Equipamento não encontrado." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/equipes", async (_req, res) => {
    res.json(await equipesRepo.listAll());
  });

  router.post("/equipes", async (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const tipo = normalize(body.tipo) || "Própria";
    if (!nome) return res.status(400).json({ error: "Informe o nome da equipe." });
    if (!["Própria", "Terceirizada"].includes(tipo)) return res.status(400).json({ error: "Tipo de equipe inválido." });
    const created = await transaction(async () => {
      const id = await equipesRepo.create({ nome, tipo, especialidade: normalize(body.especialidade) || null });
      await audit(req.user.id, "criar_equipe", "equipe", id, nome);
      return { id };
    });
    res.status(201).json(created);
  });

  router.put("/equipes/:id", async (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const tipo = normalize(body.tipo) || "Própria";
    if (!nome) return res.status(400).json({ error: "Informe o nome da equipe." });
    if (!["Própria", "Terceirizada"].includes(tipo)) return res.status(400).json({ error: "Tipo de equipe inválido." });
    const updated = await transaction(async () => {
      if (!await equipesRepo.update(req.params.id, { nome, tipo, especialidade: normalize(body.especialidade) || null })) return false;
      await audit(req.user.id, "editar_equipe", "equipe", Number(req.params.id), nome);
      return true;
    });
    if (!updated) return res.status(404).json({ error: "Equipe não encontrada." });
    res.json({ ok: true });
  });

  router.delete("/equipes/:id", async (req, res) => {
    try {
      const deleted = await transaction(async () => {
        if (!await equipesRepo.remove(req.params.id)) return false;
        await audit(req.user.id, "excluir_equipe", "equipe", Number(req.params.id), null);
        return true;
      });
      if (!deleted) return res.status(404).json({ error: "Equipe não encontrada." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/colaboradores", async (_req, res) => {
    res.json(await colaboradoresRepo.listWithTeamAndUser());
  });

  const collaboratorData = (body, nome, matricula) => ({
    nome, matricula, especialidade: normalize(body.especialidade) || null,
    equipeId: nullableId(body.equipe_id), usuarioId: nullableId(body.usuario_id),
  });

  router.post("/colaboradores", async (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const matricula = normalize(body.matricula);
    if (!nome || !matricula) return res.status(400).json({ error: "Nome e matrícula são obrigatórios." });
    try {
      const created = await transaction(async () => {
        const id = await colaboradoresRepo.create(collaboratorData(body, nome, matricula));
        await audit(req.user.id, "criar_colaborador", "colaborador", id, matricula);
        return { id };
      });
      res.status(201).json(created);
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: "A matrícula já está cadastrada." });
      conflictOrBadRequest(error, res);
    }
  });

  router.put("/colaboradores/:id", async (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const matricula = normalize(body.matricula);
    if (!nome || !matricula) return res.status(400).json({ error: "Nome e matrícula são obrigatórios." });
    try {
      const updated = await transaction(async () => {
        if (!await colaboradoresRepo.update(req.params.id, collaboratorData(body, nome, matricula))) return false;
        await audit(req.user.id, "editar_colaborador", "colaborador", Number(req.params.id), matricula);
        return true;
      });
      if (!updated) return res.status(404).json({ error: "Colaborador não encontrado." });
      res.json({ ok: true });
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: "A matrícula já está cadastrada." });
      conflictOrBadRequest(error, res);
    }
  });

  router.delete("/colaboradores/:id", async (req, res) => {
    try {
      const deleted = await transaction(async () => {
        if (!await colaboradoresRepo.remove(req.params.id)) return false;
        await audit(req.user.id, "excluir_colaborador", "colaborador", Number(req.params.id), null);
        return true;
      });
      if (!deleted) return res.status(404).json({ error: "Colaborador não encontrado." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/planos-preventivos", async (_req, res) => {
    res.json(await planosRepo.listWithOrders());
  });

  router.post("/planos-preventivos/:id/gerar-om", async (req, res) => {
    const planId = Number(req.params.id);
    const generated = await transaction(async () => {
      const plan = await planosRepo.findById(planId);
      if (!plan) return null;
      const maxNumber = await ordensRepo.maxNumero() || 40012352;
      const numero = String(Number(maxNumber) + 1);
      const id = await ordensRepo.createFromPlan({
        numero, equipamentoId: plan.equipamento_id, planoId: plan.id, equipeId: plan.equipe_id, dataProgramada: plan.proxima_data || null,
      });
      await ordensRepo.recordStatusChange(id, null, "Programada", "gerar_om_plano", null, req.user.id);
      await audit(req.user.id, "gerar_om_plano", "ordem", id, `Plano ${plan.id} · ${numero}`);
      return { id, numero, plano_id: plan.id };
    });
    if (!generated) return res.status(404).json({ error: "Plano preventivo não encontrado." });
    res.status(201).json(generated);
  });

  const planData = (body, equipamentoId, descricao) => ({
    equipamentoId, descricao, periodicidade: normalize(body.periodicidade) || null,
    proximaData: normalize(body.proxima_data) || null, equipeId: nullableId(body.equipe_id),
  });

  router.post("/planos-preventivos", async (req, res) => {
    const body = req.body || {};
    const equipamentoId = nullableId(body.equipamento_id);
    const descricao = normalize(body.descricao);
    if (!equipamentoId || !descricao) return res.status(400).json({ error: "Equipamento e descrição são obrigatórios." });
    try {
      const created = await transaction(async () => {
        const id = await planosRepo.create(planData(body, equipamentoId, descricao));
        await audit(req.user.id, "criar_plano_preventivo", "plano_preventivo", id, descricao);
        return { id };
      });
      res.status(201).json(created);
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.put("/planos-preventivos/:id", async (req, res) => {
    const body = req.body || {};
    const equipamentoId = nullableId(body.equipamento_id);
    const descricao = normalize(body.descricao);
    if (!equipamentoId || !descricao) return res.status(400).json({ error: "Equipamento e descrição são obrigatórios." });
    const updated = await transaction(async () => {
      if (!await planosRepo.update(req.params.id, planData(body, equipamentoId, descricao))) return false;
      await audit(req.user.id, "editar_plano_preventivo", "plano_preventivo", Number(req.params.id), descricao);
      return true;
    });
    if (!updated) return res.status(404).json({ error: "Plano preventivo não encontrado." });
    res.json({ ok: true });
  });

  router.delete("/planos-preventivos/:id", async (req, res) => {
    try {
      const deleted = await transaction(async () => {
        if (!await planosRepo.remove(req.params.id)) return false;
        await audit(req.user.id, "excluir_plano_preventivo", "plano_preventivo", Number(req.params.id), null);
        return true;
      });
      if (!deleted) return res.status(404).json({ error: "Plano preventivo não encontrado." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  return router;
}
