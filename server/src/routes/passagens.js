import { Router } from "express";
import { parseIsoDate } from "../iamot.js";

export const TURNOS = ["Manhã", "Tarde", "Noite"];
const SECTIONS = ["ocorrencias", "feito", "pendencias", "avisos"];
const MAX_TEXT = 4000;

// Passagem de turno: registro estruturado e imutável, com confirmação de leitura por usuário.
export default function createShiftHandoverRouter({ db, auth, audit }) {
  const router = Router();
  router.use(auth);

  router.get("/", (req, res) => {
    const pendentes = req.query.filtro === "pendentes";
    const rows = db.prepare(`
      SELECT p.id, p.data, p.turno, p.equipe_id, e.nome AS equipe, p.autor_id, u.nome AS autor,
             p.ocorrencias, p.feito, p.pendencias, p.avisos, p.criado_em,
             EXISTS (SELECT 1 FROM passagens_turno_leituras l WHERE l.passagem_id = p.id AND l.usuario_id = ?) AS lido_por_mim
      FROM passagens_turno p
      LEFT JOIN equipes e ON e.id = p.equipe_id
      LEFT JOIN usuarios u ON u.id = p.autor_id
      WHERE (? = 0 OR (p.autor_id <> ? AND NOT EXISTS (
        SELECT 1 FROM passagens_turno_leituras l WHERE l.passagem_id = p.id AND l.usuario_id = ?)))
      ORDER BY p.data DESC, CASE p.turno WHEN 'Noite' THEN 0 WHEN 'Tarde' THEN 1 ELSE 2 END, p.id DESC
      LIMIT 60
    `).all(req.user.id, pendentes ? 1 : 0, req.user.id, req.user.id);
    const readers = db.prepare(`
      SELECT l.usuario_id, u.nome, l.lido_em FROM passagens_turno_leituras l
      JOIN usuarios u ON u.id = l.usuario_id WHERE l.passagem_id = ? ORDER BY l.lido_em
    `);
    res.json(rows.map((row) => ({
      ...row,
      lido_por_mim: Boolean(row.lido_por_mim),
      sou_autor: row.autor_id === req.user.id,
      leituras: readers.all(row.id),
    })));
  });

  router.post("/", (req, res) => {
    const body = req.body || {};
    const data = String(body.data || "").trim();
    if (!parseIsoDate(data)) return res.status(400).json({ error: "Informe a data do turno." });
    if (!TURNOS.includes(body.turno)) return res.status(400).json({ error: "Selecione o turno." });
    const texts = Object.fromEntries(SECTIONS.map((key) => [key, String(body[key] || "").trim().slice(0, MAX_TEXT) || null]));
    if (!texts.feito) return res.status(400).json({ error: "Descreva o que foi feito no turno." });
    const equipeId = body.equipe_id === "" || body.equipe_id == null ? null : Number(body.equipe_id);
    if (equipeId !== null && !db.prepare("SELECT 1 FROM equipes WHERE id = ?").get(equipeId)) {
      return res.status(400).json({ error: "Selecione uma equipe cadastrada." });
    }
    const created = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO passagens_turno (data, turno, equipe_id, autor_id, ocorrencias, feito, pendencias, avisos)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(data, body.turno, equipeId, req.user.id, texts.ocorrencias, texts.feito, texts.pendencias, texts.avisos);
      audit(req.user.id, "registrar_passagem_turno", "passagem_turno", info.lastInsertRowid, `${data} · ${body.turno}`);
      return { id: info.lastInsertRowid };
    }).immediate();
    res.status(201).json(created);
  });

  router.post("/:id/leitura", (req, res) => {
    const row = db.prepare("SELECT id, autor_id, data, turno FROM passagens_turno WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Passagem de turno não encontrada." });
    if (row.autor_id === req.user.id) return res.status(409).json({ error: "Você é o autor desta passagem de turno." });
    const confirmed = db.transaction(() => {
      const info = db.prepare("INSERT OR IGNORE INTO passagens_turno_leituras (passagem_id, usuario_id) VALUES (?, ?)").run(row.id, req.user.id);
      if (info.changes) audit(req.user.id, "confirmar_leitura_passagem", "passagem_turno", row.id, `${row.data} · ${row.turno}`);
      return info.changes > 0;
    }).immediate();
    res.status(confirmed ? 201 : 200).json({ ok: true, nova: confirmed });
  });

  return router;
}
