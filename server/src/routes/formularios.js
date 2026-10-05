import { Router } from "express";
import multer from "multer";
import { ARQUIVO_CAMPOS, evaluateSubmission, orderForms, parseJson, validateTemplate } from "../formularios.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, callback) => {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) {
      callback(new Error("Fotos e assinaturas devem ser imagens JPG, PNG, WEBP ou GIF."));
      return;
    }
    callback(null, true);
  },
});
const FILE_PREFIX = "arquivo:";

export default function createFormsRouter({ db, auth, requireRole, audit, closeOrderIfComplete }) {
  const router = Router();
  router.use(auth);
  const ccm = requireRole("CCM");
  const gestao = requireRole("CCM", "PCM");

  const readModel = (row) => row && ({ ...row, ativo: Boolean(row.ativo), campos: parseJson(row.campos, []), regras: parseJson(row.regras, {}) });
  const findOrder = (id) => db.prepare("SELECT id, numero, status, responsavel_id, equipamento_id FROM ordens WHERE id = ?").get(id);
  // Executante só acessa OMs atribuídas a ele.
  const canUseOrder = (req, order) => order && (req.user.papel !== "EXECUTANTE" || order.responsavel_id === req.user.id);

  // ----------------------------------------------------------- Modelos (No-Code)
  router.get("/modelos", (req, res) => {
    const todos = req.user.papel === "CCM" && req.query.todos === "1";
    res.json(db.prepare(`
      SELECT m.id, m.nome, m.tipo, m.descricao, m.versao, m.ativo, m.regras, m.campos, m.atualizado_em, u.nome AS atualizado_por,
             (SELECT COUNT(*) FROM formularios_respostas r WHERE r.modelo_id = m.id) AS respostas
      FROM formularios_modelos m LEFT JOIN usuarios u ON u.id = COALESCE(m.atualizado_por, m.criado_por)
      WHERE (? = 1 OR m.ativo = 1) ORDER BY m.nome
    `).all(todos ? 1 : 0).map(readModel));
  });

  router.get("/modelos/:id", (req, res) => {
    const model = readModel(db.prepare("SELECT * FROM formularios_modelos WHERE id = ?").get(req.params.id));
    if (!model || (!model.ativo && req.user.papel !== "CCM")) return res.status(404).json({ error: "Formulário não encontrado." });
    res.json(model);
  });

  router.post("/modelos", ccm, (req, res) => {
    const valid = validateTemplate(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const created = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO formularios_modelos (nome, tipo, descricao, campos, regras, criado_por, atualizado_por, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(valid.nome, valid.tipo, valid.descricao, JSON.stringify(valid.campos), JSON.stringify(valid.regras), req.user.id, req.user.id);
      audit(req.user.id, "criar_modelo_formulario", "formulario_modelo", info.lastInsertRowid, `${valid.tipo} · ${valid.nome} · ${valid.campos.length} campos`);
      return { id: info.lastInsertRowid, versao: 1 };
    }).immediate();
    res.status(201).json(created);
  });

  // Cada alteração gera nova versão; as respostas guardam o modelo da época em que foram preenchidas.
  router.put("/modelos/:id", ccm, (req, res) => {
    const current = db.prepare("SELECT id, versao, ativo FROM formularios_modelos WHERE id = ?").get(req.params.id);
    if (!current) return res.status(404).json({ error: "Formulário não encontrado." });
    const valid = validateTemplate(req.body || {});
    if (valid.error) return res.status(400).json({ error: valid.error });
    const ativo = req.body.ativo === undefined ? current.ativo : (req.body.ativo ? 1 : 0);
    db.transaction(() => {
      db.prepare(`
        UPDATE formularios_modelos SET nome = ?, tipo = ?, descricao = ?, campos = ?, regras = ?, ativo = ?,
               versao = versao + 1, atualizado_por = ?, atualizado_em = datetime('now') WHERE id = ?
      `).run(valid.nome, valid.tipo, valid.descricao, JSON.stringify(valid.campos), JSON.stringify(valid.regras), ativo, req.user.id, current.id);
      audit(req.user.id, "editar_modelo_formulario", "formulario_modelo", current.id, `${valid.nome} · versão ${current.versao + 1}${ativo ? "" : " · inativo"}`);
    }).immediate();
    res.json({ id: current.id, versao: current.versao + 1 });
  });

  // Com respostas, o modelo é desativado (preserva o histórico); sem respostas, é excluído.
  router.delete("/modelos/:id", ccm, (req, res) => {
    const current = db.prepare("SELECT id, nome FROM formularios_modelos WHERE id = ?").get(req.params.id);
    if (!current) return res.status(404).json({ error: "Formulário não encontrado." });
    const result = db.transaction(() => {
      const used = db.prepare("SELECT COUNT(*) AS total FROM formularios_respostas WHERE modelo_id = ?").get(current.id).total;
      if (used) {
        db.prepare("UPDATE formularios_modelos SET ativo = 0, atualizado_por = ?, atualizado_em = datetime('now') WHERE id = ?").run(req.user.id, current.id);
        audit(req.user.id, "desativar_modelo_formulario", "formulario_modelo", current.id, `${current.nome} · ${used} resposta(s)`);
        return { desativado: true };
      }
      db.prepare("DELETE FROM ordem_formularios WHERE modelo_id = ?").run(current.id);
      db.prepare("DELETE FROM formularios_modelos WHERE id = ?").run(current.id);
      audit(req.user.id, "excluir_modelo_formulario", "formulario_modelo", current.id, current.nome);
      return { excluido: true };
    }).immediate();
    res.json(result);
  });

  // ----------------------------------------------------------- Checklist inteligente da OM
  router.get("/ordem/:id", (req, res) => {
    const order = findOrder(req.params.id);
    if (!canUseOrder(req, order)) return res.status(404).json({ error: "OM não encontrada." });
    res.json(orderForms(db, order.id));
  });

  router.post("/ordem/:id/vinculos", gestao, (req, res) => {
    const order = findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "OM não encontrada." });
    const model = db.prepare("SELECT id, nome FROM formularios_modelos WHERE id = ? AND ativo = 1").get(Number((req.body || {}).modelo_id));
    if (!model) return res.status(400).json({ error: "Selecione um formulário ativo." });
    const obrigatorio = req.body.obrigatorio ? 1 : 0;
    db.transaction(() => {
      db.prepare(`
        INSERT INTO ordem_formularios (ordem_id, modelo_id, obrigatorio, vinculado_por) VALUES (?, ?, ?, ?)
        ON CONFLICT(ordem_id, modelo_id) DO UPDATE SET obrigatorio = excluded.obrigatorio, vinculado_por = excluded.vinculado_por, vinculado_em = datetime('now')
      `).run(order.id, model.id, obrigatorio, req.user.id);
      audit(req.user.id, "vincular_formulario_om", "ordem", order.id, `OM ${order.numero} · ${model.nome}${obrigatorio ? " · obrigatório" : ""}`);
    }).immediate();
    res.status(201).json(orderForms(db, order.id));
  });

  router.delete("/ordem/:id/vinculos/:modeloId", gestao, (req, res) => {
    const order = findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "OM não encontrada." });
    const info = db.transaction(() => {
      const result = db.prepare("DELETE FROM ordem_formularios WHERE ordem_id = ? AND modelo_id = ?").run(order.id, req.params.modeloId);
      if (result.changes) audit(req.user.id, "desvincular_formulario_om", "ordem", order.id, `OM ${order.numero} · modelo ${req.params.modeloId}`);
      return result;
    }).immediate();
    if (!info.changes) return res.status(404).json({ error: "Vínculo não encontrado." });
    res.json(orderForms(db, order.id));
  });

  // ----------------------------------------------------------- Respostas
  // multipart: "dados" (JSON com modelo_id, ordem_id, equipamento_id, respostas) + "arquivo:<campo>" (foto/assinatura).
  router.post("/respostas", upload.any(), (req, res) => {
    // Aceita multipart (com fotos/assinaturas) ou JSON simples.
    const dados = typeof req.body?.dados === "string" ? parseJson(req.body.dados, null) : req.body?.modelo_id ? req.body : null;
    if (!dados) return res.status(400).json({ error: "Envio inválido." });
    const model = readModel(db.prepare("SELECT * FROM formularios_modelos WHERE id = ? AND ativo = 1").get(Number(dados.modelo_id)));
    if (!model) return res.status(400).json({ error: "Selecione um formulário ativo." });

    let order = null;
    if (dados.ordem_id) {
      order = findOrder(Number(dados.ordem_id));
      if (!canUseOrder(req, order)) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
      if (order.status === "Encerrada" || order.status === "Cancelada") return res.status(409).json({ error: `A OM ${order.numero} está ${order.status.toLowerCase()}.` });
    }
    const equipamentoId = order?.equipamento_id ?? (dados.equipamento_id ? Number(dados.equipamento_id) : null);
    if (equipamentoId && !db.prepare("SELECT 1 FROM equipamentos WHERE id = ?").get(equipamentoId)) return res.status(400).json({ error: "Equipamento não encontrado." });
    if (!order && !equipamentoId) return res.status(400).json({ error: "Vincule a resposta a uma OM ou a um equipamento." });

    const files = new Map();
    for (const file of req.files || []) {
      const campo = file.fieldname.startsWith(FILE_PREFIX) ? file.fieldname.slice(FILE_PREFIX.length) : null;
      const field = model.campos.find((item) => item.id === campo);
      if (!field || !ARQUIVO_CAMPOS.has(field.tipo) || files.has(campo)) return res.status(400).json({ error: "Arquivo enviado para um campo inválido." });
      files.set(campo, file);
    }
    const result = evaluateSubmission(model.campos, dados.respostas || {}, files);
    if (result.error) return res.status(400).json({ error: result.error });

    const saved = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO formularios_respostas (modelo_id, modelo_versao, modelo_nome, modelo_tipo, campos, ordem_id, equipamento_id, respostas, nao_conformidades, usuario_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(model.id, model.versao, model.nome, model.tipo, JSON.stringify(model.campos), order?.id ?? null, equipamentoId,
        JSON.stringify(result.respostas), JSON.stringify(result.naoConformidades), req.user.id);
      const insert = db.prepare("INSERT INTO formularios_anexos (resposta_id, campo_id, tipo, nome_arquivo, tipo_mime, conteudo) VALUES (?, ?, ?, ?, ?, ?)");
      for (const anexo of result.anexos) {
        insert.run(info.lastInsertRowid, anexo.campo, anexo.tipo, (anexo.file.originalname || `${anexo.tipo}.png`).slice(0, 240), anexo.file.mimetype, anexo.file.buffer);
      }
      audit(req.user.id, "responder_formulario", "formulario_resposta", info.lastInsertRowid,
        `${model.nome} v${model.versao}${order ? ` · OM ${order.numero}` : ""} · ${result.naoConformidades.length} não conformidade(s)`);
      const encerrada = order ? closeOrderIfComplete(order.id, req.user.id) : false;
      return { id: info.lastInsertRowid, nao_conformidades: result.naoConformidades, encerrada };
    }).immediate();
    res.status(201).json(saved);
  });

  router.get("/respostas", (req, res) => {
    const own = req.user.papel === "EXECUTANTE";
    const filters = [];
    const params = [];
    for (const [key, column] of [["modelo_id", "r.modelo_id"], ["ordem_id", "r.ordem_id"], ["equipamento_id", "r.equipamento_id"]]) {
      if (req.query[key]) { filters.push(`${column} = ?`); params.push(Number(req.query[key])); }
    }
    // Executante vê o que preencheu e as respostas das OMs atribuídas a ele.
    if (own) { filters.push("(r.usuario_id = ? OR o.responsavel_id = ?)"); params.push(req.user.id, req.user.id); }
    res.json(db.prepare(`
      SELECT r.id, r.modelo_id, r.modelo_nome, r.modelo_tipo, r.modelo_versao, r.ordem_id, o.numero AS ordem_numero,
             r.equipamento_id, e.tag AS equipamento, r.nao_conformidades, r.criado_em, u.nome AS usuario_nome
      FROM formularios_respostas r
      LEFT JOIN ordens o ON o.id = r.ordem_id
      LEFT JOIN equipamentos e ON e.id = r.equipamento_id
      LEFT JOIN usuarios u ON u.id = r.usuario_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY r.id DESC LIMIT 200
    `).all(...params).map((row) => ({ ...row, nao_conformidades: parseJson(row.nao_conformidades, []).length })));
  });

  const findResponse = (req) => {
    const row = db.prepare(`
      SELECT r.*, o.numero AS ordem_numero, o.responsavel_id, e.tag AS equipamento, u.nome AS usuario_nome
      FROM formularios_respostas r
      LEFT JOIN ordens o ON o.id = r.ordem_id
      LEFT JOIN equipamentos e ON e.id = r.equipamento_id
      LEFT JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = ?
    `).get(req.params.id);
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
      anexos: db.prepare("SELECT id, campo_id, tipo, nome_arquivo, tipo_mime FROM formularios_anexos WHERE resposta_id = ? ORDER BY id").all(row.id),
    });
  });

  router.get("/respostas/:id/anexos/:anexoId", (req, res) => {
    const row = findResponse(req);
    if (!row) return res.status(404).json({ error: "Resposta não encontrada." });
    const file = db.prepare("SELECT tipo_mime, conteudo FROM formularios_anexos WHERE id = ? AND resposta_id = ?").get(req.params.anexoId, row.id);
    if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
    res.type(file.tipo_mime).set("Content-Disposition", "inline").send(file.conteudo);
  });

  router.use((error, _req, res, next) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Cada imagem pode ter no máximo 5 MB." : "Arquivos demais no envio." });
    }
    if (error) return res.status(400).json({ error: error.message || "Envio inválido." });
    next();
  });

  return router;
}
