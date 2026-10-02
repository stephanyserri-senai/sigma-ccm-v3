import { Router } from "express";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) {
      callback(new Error("Envie imagens JPG, PNG, WEBP ou GIF."));
      return;
    }
    callback(null, true);
  },
});

export default function createEvidenceRouter({ db, auth, requireRole, audit }) {
  const router = Router();

  function findOrder(id) {
    return db.prepare("SELECT id, responsavel_id, status FROM ordens WHERE id = ?").get(id);
  }

  function canView(req, order) {
    return order && (req.user.papel !== "EXECUTANTE" || order.responsavel_id === req.user.id);
  }

  function requireAssignedOrder(req, res, next) {
    const order = findOrder(req.params.id);
    if (!order || order.responsavel_id !== req.user.id) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
    req.order = order;
    next();
  }

  router.get("/:id/evidencias", auth, (req, res) => {
    const order = findOrder(req.params.id);
    if (!canView(req, order)) return res.status(404).json({ error: "OM não encontrada." });
    res.json(db.prepare(`
      SELECT id, ordem_id, usuario_id, nome_arquivo, tipo_mime, enviado_em
      FROM evidencias_om WHERE ordem_id = ? ORDER BY id
    `).all(order.id));
  });

  router.get("/:id/evidencias/:evidenciaId/arquivo", auth, (req, res) => {
    const order = findOrder(req.params.id);
    if (!canView(req, order)) return res.status(404).json({ error: "OM não encontrada." });
    const image = db.prepare(`
      SELECT nome_arquivo, tipo_mime, conteudo
      FROM evidencias_om WHERE id = ? AND ordem_id = ?
    `).get(req.params.evidenciaId, order.id);
    if (!image) return res.status(404).json({ error: "Imagem não encontrada." });
    res.type(image.tipo_mime).set("Content-Disposition", "inline").send(image.conteudo);
  });

  router.post("/:id/evidencias", auth, requireRole("EXECUTANTE"), requireAssignedOrder, upload.array("imagens", 5), (req, res) => {
    const order = req.order;
    if (!req.files?.length) return res.status(400).json({ error: "Selecione pelo menos uma imagem." });

    const ids = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO evidencias_om (ordem_id, usuario_id, nome_arquivo, tipo_mime, conteudo)
        VALUES (?, ?, ?, ?, ?)
      `);
      const created = req.files.map((file) => Number(insert.run(
        order.id, req.user.id, file.originalname.slice(0, 240), file.mimetype, file.buffer,
      ).lastInsertRowid));
      audit(req.user.id, "registrar_evidencias_om", "ordem", order.id, `${created.length} imagem(ns)`);
      return created;
    }).immediate();

    res.status(201).json({ ids });
  });

  router.use((error, _req, res, next) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE" ? "Cada imagem pode ter no máximo 5 MB." : "Envie até 5 imagens por vez.";
      return res.status(400).json({ error: message });
    }
    if (error) return res.status(400).json({ error: error.message || "Upload inválido." });
    next();
  });

  return router;
}
