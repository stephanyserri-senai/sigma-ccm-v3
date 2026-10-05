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

function nextTag(prefix, excludeId = null) {
  let sequence = 0;
  for (const tag of equipamentosRepo.listTagsWithPrefix(prefix, excludeId)) {
    const match = new RegExp(`^${prefix}-(\\d+)$`, "i").exec(tag);
    if (match) sequence = Math.max(sequence, Number(match[1]));
  }
  let candidate;
  do {
    sequence += 1;
    candidate = `${prefix}-${String(sequence).padStart(4, "0")}`;
  } while (equipamentosRepo.tagExists(candidate, excludeId));
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

  router.get("/equipamentos", (_req, res) => {
    res.json(equipamentosRepo.listWithParent());
  });

  router.post("/equipamentos/tag-preview", (req, res) => {
    const valid = validateEquipment(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const prefix = prefixForEquipment(valid.classe, valid.descricao);
    res.json({ tag: nextTag(prefix), prefix });
  });

  const equipmentData = (body, valid, tag) => ({
    tag, descricao: valid.descricao, localizacao: normalize(body.localizacao) || null, classe: valid.classe,
    criticidade: normalize(body.criticidade) || "Média", paiId: nullableId(body.pai_id),
  });

  router.post("/equipamentos", (req, res) => {
    const body = req.body || {};
    const valid = validateEquipment(body);
    if (valid.error) return res.status(400).json({ error: valid.error });
    const tagManual = body.tag_mode === "manual";
    const manualTag = normalize(body.tag).toUpperCase();
    if (tagManual && !manualTag) return res.status(400).json({ error: "Informe a TAG manual." });

    try {
      const created = transaction(() => {
        const tag = tagManual ? manualTag : nextTag(prefixForEquipment(valid.classe, valid.descricao));
        if (equipamentosRepo.tagTakenIgnoringCase(tag)) throw uniqueViolation("TAG duplicada");
        const id = equipamentosRepo.create(equipmentData(body, valid, tag));
        audit(req.user.id, "criar_equipamento", "equipamento", id, tag);
        return { id, tag };
      });
      res.status(201).json(created);
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.put("/equipamentos/:id", (req, res) => {
    const body = req.body || {};
    const valid = validateEquipment(body);
    if (valid.error) return res.status(400).json({ error: valid.error });
    const id = Number(req.params.id);
    const tagManual = body.tag_mode === "manual";
    const manualTag = normalize(body.tag).toUpperCase();
    if (tagManual && !manualTag) return res.status(400).json({ error: "Informe a TAG manual." });

    try {
      const updated = transaction(() => {
        if (!equipamentosRepo.findById(id)) return null;
        const tag = tagManual ? manualTag : nextTag(prefixForEquipment(valid.classe, valid.descricao), id);
        if (equipamentosRepo.tagTakenIgnoringCase(tag, id)) throw uniqueViolation("TAG duplicada");
        equipamentosRepo.update(id, equipmentData(body, valid, tag));
        audit(req.user.id, "editar_equipamento", "equipamento", id, tag);
        return { id, tag };
      });
      if (!updated) return res.status(404).json({ error: "Equipamento não encontrado." });
      res.json(updated);
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.delete("/equipamentos/:id", (req, res) => {
    const id = Number(req.params.id);
    try {
      const deleted = transaction(() => {
        const row = equipamentosRepo.findTag(id);
        if (!row) return false;
        equipamentosRepo.remove(id);
        audit(req.user.id, "excluir_equipamento", "equipamento", id, row.tag);
        return true;
      });
      if (!deleted) return res.status(404).json({ error: "Equipamento não encontrado." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/equipes", (_req, res) => {
    res.json(equipesRepo.listAll());
  });

  router.post("/equipes", (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const tipo = normalize(body.tipo) || "Própria";
    if (!nome) return res.status(400).json({ error: "Informe o nome da equipe." });
    if (!["Própria", "Terceirizada"].includes(tipo)) return res.status(400).json({ error: "Tipo de equipe inválido." });
    const created = transaction(() => {
      const id = equipesRepo.create({ nome, tipo, especialidade: normalize(body.especialidade) || null });
      audit(req.user.id, "criar_equipe", "equipe", id, nome);
      return { id };
    });
    res.status(201).json(created);
  });

  router.put("/equipes/:id", (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const tipo = normalize(body.tipo) || "Própria";
    if (!nome) return res.status(400).json({ error: "Informe o nome da equipe." });
    if (!["Própria", "Terceirizada"].includes(tipo)) return res.status(400).json({ error: "Tipo de equipe inválido." });
    const updated = transaction(() => {
      if (!equipesRepo.update(req.params.id, { nome, tipo, especialidade: normalize(body.especialidade) || null })) return false;
      audit(req.user.id, "editar_equipe", "equipe", Number(req.params.id), nome);
      return true;
    });
    if (!updated) return res.status(404).json({ error: "Equipe não encontrada." });
    res.json({ ok: true });
  });

  router.delete("/equipes/:id", (req, res) => {
    try {
      const deleted = transaction(() => {
        if (!equipesRepo.remove(req.params.id)) return false;
        audit(req.user.id, "excluir_equipe", "equipe", Number(req.params.id), null);
        return true;
      });
      if (!deleted) return res.status(404).json({ error: "Equipe não encontrada." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/colaboradores", (_req, res) => {
    res.json(colaboradoresRepo.listWithTeamAndUser());
  });

  const collaboratorData = (body, nome, matricula) => ({
    nome, matricula, especialidade: normalize(body.especialidade) || null,
    equipeId: nullableId(body.equipe_id), usuarioId: nullableId(body.usuario_id),
  });

  router.post("/colaboradores", (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const matricula = normalize(body.matricula);
    if (!nome || !matricula) return res.status(400).json({ error: "Nome e matrícula são obrigatórios." });
    try {
      const created = transaction(() => {
        const id = colaboradoresRepo.create(collaboratorData(body, nome, matricula));
        audit(req.user.id, "criar_colaborador", "colaborador", id, matricula);
        return { id };
      });
      res.status(201).json(created);
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: "A matrícula já está cadastrada." });
      conflictOrBadRequest(error, res);
    }
  });

  router.put("/colaboradores/:id", (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const matricula = normalize(body.matricula);
    if (!nome || !matricula) return res.status(400).json({ error: "Nome e matrícula são obrigatórios." });
    try {
      const updated = transaction(() => {
        if (!colaboradoresRepo.update(req.params.id, collaboratorData(body, nome, matricula))) return false;
        audit(req.user.id, "editar_colaborador", "colaborador", Number(req.params.id), matricula);
        return true;
      });
      if (!updated) return res.status(404).json({ error: "Colaborador não encontrado." });
      res.json({ ok: true });
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: "A matrícula já está cadastrada." });
      conflictOrBadRequest(error, res);
    }
  });

  router.delete("/colaboradores/:id", (req, res) => {
    try {
      const deleted = transaction(() => {
        if (!colaboradoresRepo.remove(req.params.id)) return false;
        audit(req.user.id, "excluir_colaborador", "colaborador", Number(req.params.id), null);
        return true;
      });
      if (!deleted) return res.status(404).json({ error: "Colaborador não encontrado." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/planos-preventivos", (_req, res) => {
    res.json(planosRepo.listWithOrders());
  });

  router.post("/planos-preventivos/:id/gerar-om", (req, res) => {
    const planId = Number(req.params.id);
    const generated = transaction(() => {
      const plan = planosRepo.findById(planId);
      if (!plan) return null;
      const maxNumber = ordensRepo.maxNumero() || 40012352;
      const numero = String(Number(maxNumber) + 1);
      const id = ordensRepo.createFromPlan({
        numero, equipamentoId: plan.equipamento_id, planoId: plan.id, equipeId: plan.equipe_id, dataProgramada: plan.proxima_data || null,
      });
      audit(req.user.id, "gerar_om_plano", "ordem", id, `Plano ${plan.id} · ${numero}`);
      return { id, numero, plano_id: plan.id };
    });
    if (!generated) return res.status(404).json({ error: "Plano preventivo não encontrado." });
    res.status(201).json(generated);
  });

  const planData = (body, equipamentoId, descricao) => ({
    equipamentoId, descricao, periodicidade: normalize(body.periodicidade) || null,
    proximaData: normalize(body.proxima_data) || null, equipeId: nullableId(body.equipe_id),
  });

  router.post("/planos-preventivos", (req, res) => {
    const body = req.body || {};
    const equipamentoId = nullableId(body.equipamento_id);
    const descricao = normalize(body.descricao);
    if (!equipamentoId || !descricao) return res.status(400).json({ error: "Equipamento e descrição são obrigatórios." });
    try {
      const created = transaction(() => {
        const id = planosRepo.create(planData(body, equipamentoId, descricao));
        audit(req.user.id, "criar_plano_preventivo", "plano_preventivo", id, descricao);
        return { id };
      });
      res.status(201).json(created);
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.put("/planos-preventivos/:id", (req, res) => {
    const body = req.body || {};
    const equipamentoId = nullableId(body.equipamento_id);
    const descricao = normalize(body.descricao);
    if (!equipamentoId || !descricao) return res.status(400).json({ error: "Equipamento e descrição são obrigatórios." });
    const updated = transaction(() => {
      if (!planosRepo.update(req.params.id, planData(body, equipamentoId, descricao))) return false;
      audit(req.user.id, "editar_plano_preventivo", "plano_preventivo", Number(req.params.id), descricao);
      return true;
    });
    if (!updated) return res.status(404).json({ error: "Plano preventivo não encontrado." });
    res.json({ ok: true });
  });

  router.delete("/planos-preventivos/:id", (req, res) => {
    try {
      const deleted = transaction(() => {
        if (!planosRepo.remove(req.params.id)) return false;
        audit(req.user.id, "excluir_plano_preventivo", "plano_preventivo", Number(req.params.id), null);
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
