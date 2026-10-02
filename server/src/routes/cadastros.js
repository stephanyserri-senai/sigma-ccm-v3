import { Router } from "express";

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
  const normalizedClass = normalize(classe).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const explicit = Object.entries(CLASS_PREFIXES).find(([key]) => normalizedClass.startsWith(key));
  const source = explicit ? explicit[0] : normalizedClass || normalize(descricao);
  const letters = source.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/gi, "").toUpperCase();
  return (explicit?.[1] || letters.slice(0, 3) || "EQP").padEnd(3, "X");
}

function nextTag(db, prefix, excludeId = null) {
  const rows = db.prepare("SELECT tag FROM equipamentos WHERE tag LIKE ? AND (? IS NULL OR id <> ?)")
    .all(`${prefix}-%`, excludeId, excludeId);
  let sequence = 0;
  for (const { tag } of rows) {
    const match = new RegExp(`^${prefix}-(\\d+)$`, "i").exec(tag);
    if (match) sequence = Math.max(sequence, Number(match[1]));
  }
  let candidate;
  do {
    sequence += 1;
    candidate = `${prefix}-${String(sequence).padStart(4, "0")}`;
  } while (db.prepare("SELECT 1 FROM equipamentos WHERE tag = ? AND (? IS NULL OR id <> ?)").get(candidate, excludeId, excludeId));
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
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ error: "A TAG já está cadastrada." });
  }
  if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return res.status(409).json({ error: "Registro associado a outros dados e não pode ser excluído." });
  }
  return res.status(400).json({ error: "Dados inválidos para este cadastro." });
}

export default function createCadastrosRouter({ db, auth, requireRole, audit }) {
  const router = Router();
  router.use(auth, requireRole("CCM"));

  router.get("/equipamentos", (_req, res) => {
    res.json(db.prepare(`
      SELECT e.*, p.tag AS equipamento_pai
      FROM equipamentos e LEFT JOIN equipamentos p ON p.id = e.pai_id
      ORDER BY e.tag
    `).all());
  });

  router.post("/equipamentos/tag-preview", (req, res) => {
    const valid = validateEquipment(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const prefix = prefixForEquipment(valid.classe, valid.descricao);
    res.json({ tag: nextTag(db, prefix), prefix });
  });

  router.post("/equipamentos", (req, res) => {
    const body = req.body || {};
    const valid = validateEquipment(body);
    if (valid.error) return res.status(400).json({ error: valid.error });
    const tagManual = body.tag_mode === "manual";
    const manualTag = normalize(body.tag).toUpperCase();
    if (tagManual && !manualTag) return res.status(400).json({ error: "Informe a TAG manual." });

    try {
      const created = db.transaction(() => {
        const tag = tagManual ? manualTag : nextTag(db, prefixForEquipment(valid.classe, valid.descricao));
        if (db.prepare("SELECT 1 FROM equipamentos WHERE tag = ? COLLATE NOCASE").get(tag)) {
          throw Object.assign(new Error("TAG duplicada"), { code: "SQLITE_CONSTRAINT_UNIQUE" });
        }
        const result = db.prepare(`
          INSERT INTO equipamentos (tag, descricao, localizacao, classe, criticidade, pai_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(tag, valid.descricao, normalize(body.localizacao) || null, valid.classe,
          normalize(body.criticidade) || "Média", nullableId(body.pai_id));
        audit(req.user.id, "criar_equipamento", "equipamento", result.lastInsertRowid, tag);
        return { id: result.lastInsertRowid, tag };
      }).immediate();
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
      const updated = db.transaction(() => {
        const existing = db.prepare("SELECT id FROM equipamentos WHERE id = ?").get(id);
        if (!existing) return null;
        const tag = tagManual ? manualTag : nextTag(db, prefixForEquipment(valid.classe, valid.descricao), id);
        if (db.prepare("SELECT 1 FROM equipamentos WHERE tag = ? COLLATE NOCASE AND id <> ?").get(tag, id)) {
          throw Object.assign(new Error("TAG duplicada"), { code: "SQLITE_CONSTRAINT_UNIQUE" });
        }
        db.prepare(`
          UPDATE equipamentos
          SET tag = ?, descricao = ?, localizacao = ?, classe = ?, criticidade = ?, pai_id = ?
          WHERE id = ?
        `).run(tag, valid.descricao, normalize(body.localizacao) || null, valid.classe,
          normalize(body.criticidade) || "Média", nullableId(body.pai_id), id);
        audit(req.user.id, "editar_equipamento", "equipamento", id, tag);
        return { id, tag };
      }).immediate();
      if (!updated) return res.status(404).json({ error: "Equipamento não encontrado." });
      res.json(updated);
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.delete("/equipamentos/:id", (req, res) => {
    const id = Number(req.params.id);
    try {
      const deleted = db.transaction(() => {
        const row = db.prepare("SELECT tag FROM equipamentos WHERE id = ?").get(id);
        if (!row) return false;
        db.prepare("DELETE FROM equipamentos WHERE id = ?").run(id);
        audit(req.user.id, "excluir_equipamento", "equipamento", id, row.tag);
        return true;
      }).immediate();
      if (!deleted) return res.status(404).json({ error: "Equipamento não encontrado." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/equipes", (_req, res) => {
    res.json(db.prepare("SELECT * FROM equipes ORDER BY nome").all());
  });

  router.post("/equipes", (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const tipo = normalize(body.tipo) || "Própria";
    if (!nome) return res.status(400).json({ error: "Informe o nome da equipe." });
    if (!["Própria", "Terceirizada"].includes(tipo)) return res.status(400).json({ error: "Tipo de equipe inválido." });
    const created = db.transaction(() => {
      const result = db.prepare("INSERT INTO equipes (nome, tipo, especialidade) VALUES (?, ?, ?)")
        .run(nome, tipo, normalize(body.especialidade) || null);
      audit(req.user.id, "criar_equipe", "equipe", result.lastInsertRowid, nome);
      return { id: result.lastInsertRowid };
    }).immediate();
    res.status(201).json(created);
  });

  router.put("/equipes/:id", (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const tipo = normalize(body.tipo) || "Própria";
    if (!nome) return res.status(400).json({ error: "Informe o nome da equipe." });
    if (!["Própria", "Terceirizada"].includes(tipo)) return res.status(400).json({ error: "Tipo de equipe inválido." });
    const updated = db.transaction(() => {
      const info = db.prepare("UPDATE equipes SET nome = ?, tipo = ?, especialidade = ? WHERE id = ?")
        .run(nome, tipo, normalize(body.especialidade) || null, req.params.id);
      if (!info.changes) return false;
      audit(req.user.id, "editar_equipe", "equipe", Number(req.params.id), nome);
      return true;
    }).immediate();
    if (!updated) return res.status(404).json({ error: "Equipe não encontrada." });
    res.json({ ok: true });
  });

  router.delete("/equipes/:id", (req, res) => {
    try {
      const deleted = db.transaction(() => {
        const info = db.prepare("DELETE FROM equipes WHERE id = ?").run(req.params.id);
        if (!info.changes) return false;
        audit(req.user.id, "excluir_equipe", "equipe", Number(req.params.id), null);
        return true;
      }).immediate();
      if (!deleted) return res.status(404).json({ error: "Equipe não encontrada." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/colaboradores", (_req, res) => {
    res.json(db.prepare(`
      SELECT c.*, e.nome AS equipe, u.username
      FROM colaboradores c
      LEFT JOIN equipes e ON e.id = c.equipe_id
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.nome
    `).all());
  });

  router.post("/colaboradores", (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const matricula = normalize(body.matricula);
    if (!nome || !matricula) return res.status(400).json({ error: "Nome e matrícula são obrigatórios." });
    try {
      const created = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO colaboradores (nome, matricula, especialidade, equipe_id, usuario_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(nome, matricula, normalize(body.especialidade) || null, nullableId(body.equipe_id), nullableId(body.usuario_id));
        audit(req.user.id, "criar_colaborador", "colaborador", result.lastInsertRowid, matricula);
        return { id: result.lastInsertRowid };
      }).immediate();
      res.status(201).json(created);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "A matrícula já está cadastrada." });
      conflictOrBadRequest(error, res);
    }
  });

  router.put("/colaboradores/:id", (req, res) => {
    const body = req.body || {};
    const nome = normalize(body.nome);
    const matricula = normalize(body.matricula);
    if (!nome || !matricula) return res.status(400).json({ error: "Nome e matrícula são obrigatórios." });
    try {
      const updated = db.transaction(() => {
        const info = db.prepare(`
          UPDATE colaboradores SET nome = ?, matricula = ?, especialidade = ?, equipe_id = ?, usuario_id = ?
          WHERE id = ?
        `).run(nome, matricula, normalize(body.especialidade) || null, nullableId(body.equipe_id), nullableId(body.usuario_id), req.params.id);
        if (!info.changes) return false;
        audit(req.user.id, "editar_colaborador", "colaborador", Number(req.params.id), matricula);
        return true;
      }).immediate();
      if (!updated) return res.status(404).json({ error: "Colaborador não encontrado." });
      res.json({ ok: true });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "A matrícula já está cadastrada." });
      conflictOrBadRequest(error, res);
    }
  });

  router.delete("/colaboradores/:id", (req, res) => {
    try {
      const deleted = db.transaction(() => {
        const info = db.prepare("DELETE FROM colaboradores WHERE id = ?").run(req.params.id);
        if (!info.changes) return false;
        audit(req.user.id, "excluir_colaborador", "colaborador", Number(req.params.id), null);
        return true;
      }).immediate();
      if (!deleted) return res.status(404).json({ error: "Colaborador não encontrado." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  router.get("/planos-preventivos", (_req, res) => {
    res.json(db.prepare(`
            SELECT p.*, e.tag AS equipamento, eq.nome AS equipe,
              (SELECT group_concat(o.numero, ', ') FROM ordens o WHERE o.plano_id = p.id) AS oms_geradas
      FROM planos_preventivos p LEFT JOIN equipamentos e ON e.id = p.equipamento_id
      LEFT JOIN equipes eq ON eq.id = p.equipe_id
      ORDER BY p.id DESC
    `).all());
  });

  router.post("/planos-preventivos/:id/gerar-om", (req, res) => {
    const planId = Number(req.params.id);
    const generated = db.transaction(() => {
      const plan = db.prepare("SELECT * FROM planos_preventivos WHERE id = ?").get(planId);
      if (!plan) return null;
      const maxNumber = db.prepare("SELECT MAX(CAST(numero AS INTEGER)) AS maior FROM ordens").get().maior || 40012352;
      const numero = String(Number(maxNumber) + 1);
      const result = db.prepare(`
        INSERT INTO ordens (numero, tipo, status, equipamento_id, plano_id, equipe_id, hh_previsto, data_programada)
        VALUES (?, 'Preventiva', 'Programada', ?, ?, ?, 4, ?)
      `).run(numero, plan.equipamento_id, plan.id, plan.equipe_id, plan.proxima_data || null);
      audit(req.user.id, "gerar_om_plano", "ordem", result.lastInsertRowid, `Plano ${plan.id} · ${numero}`);
      return { id: result.lastInsertRowid, numero, plano_id: plan.id };
    }).immediate();
    if (!generated) return res.status(404).json({ error: "Plano preventivo não encontrado." });
    res.status(201).json(generated);
  });

  router.post("/planos-preventivos", (req, res) => {
    const body = req.body || {};
    const equipamentoId = nullableId(body.equipamento_id);
    const descricao = normalize(body.descricao);
    if (!equipamentoId || !descricao) return res.status(400).json({ error: "Equipamento e descrição são obrigatórios." });
    try {
      const created = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO planos_preventivos (equipamento_id, descricao, periodicidade, proxima_data, equipe_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(equipamentoId, descricao, normalize(body.periodicidade) || null,
          normalize(body.proxima_data) || null, nullableId(body.equipe_id));
        audit(req.user.id, "criar_plano_preventivo", "plano_preventivo", result.lastInsertRowid, descricao);
        return { id: result.lastInsertRowid };
      }).immediate();
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
    const updated = db.transaction(() => {
      const info = db.prepare(`
        UPDATE planos_preventivos SET equipamento_id = ?, descricao = ?, periodicidade = ?, proxima_data = ?, equipe_id = ?
        WHERE id = ?
      `).run(equipamentoId, descricao, normalize(body.periodicidade) || null,
        normalize(body.proxima_data) || null, nullableId(body.equipe_id), req.params.id);
      if (!info.changes) return false;
      audit(req.user.id, "editar_plano_preventivo", "plano_preventivo", Number(req.params.id), descricao);
      return true;
    }).immediate();
    if (!updated) return res.status(404).json({ error: "Plano preventivo não encontrado." });
    res.json({ ok: true });
  });

  router.delete("/planos-preventivos/:id", (req, res) => {
    try {
      const deleted = db.transaction(() => {
        const info = db.prepare("DELETE FROM planos_preventivos WHERE id = ?").run(req.params.id);
        if (!info.changes) return false;
        audit(req.user.id, "excluir_plano_preventivo", "plano_preventivo", Number(req.params.id), null);
        return true;
      }).immediate();
      if (!deleted) return res.status(404).json({ error: "Plano preventivo não encontrado." });
      res.status(204).end();
    } catch (error) {
      conflictOrBadRequest(error, res);
    }
  });

  return router;
}