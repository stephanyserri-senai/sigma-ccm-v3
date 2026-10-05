import { Router } from "express";
import { equipesRepo, passagensRepo, transaction } from "../data/index.js";
import { parseIsoDate } from "../iamot.js";

export const TURNOS = ["Manhã", "Tarde", "Noite"];
const SECTIONS = ["ocorrencias", "feito", "pendencias", "avisos"];
const MAX_TEXT = 4000;

// Passagem de turno: registro estruturado e imutável, com confirmação de leitura por usuário.
export default function createShiftHandoverRouter({ auth, audit }) {
  const router = Router();
  router.use(auth);

  router.get("/", (req, res) => {
    const pendentes = req.query.filtro === "pendentes";
    const rows = passagensRepo.list(req.user.id, pendentes);
    res.json(rows.map((row) => ({
      ...row,
      lido_por_mim: Boolean(row.lido_por_mim),
      sou_autor: row.autor_id === req.user.id,
      leituras: passagensRepo.listReaders(row.id),
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
    if (equipeId !== null && !equipesRepo.exists(equipeId)) {
      return res.status(400).json({ error: "Selecione uma equipe cadastrada." });
    }
    const created = transaction(() => {
      const id = passagensRepo.create({ data, turno: body.turno, equipeId, autorId: req.user.id, ...texts });
      audit(req.user.id, "registrar_passagem_turno", "passagem_turno", id, `${data} · ${body.turno}`);
      return { id };
    });
    res.status(201).json(created);
  });

  router.post("/:id/leitura", (req, res) => {
    const row = passagensRepo.findById(req.params.id);
    if (!row) return res.status(404).json({ error: "Passagem de turno não encontrada." });
    if (row.autor_id === req.user.id) return res.status(409).json({ error: "Você é o autor desta passagem de turno." });
    const confirmed = transaction(() => {
      const nova = passagensRepo.markRead(row.id, req.user.id);
      if (nova) audit(req.user.id, "confirmar_leitura_passagem", "passagem_turno", row.id, `${row.data} · ${row.turno}`);
      return nova;
    });
    res.status(confirmed ? 201 : 200).json({ ok: true, nova: confirmed });
  });

  return router;
}
