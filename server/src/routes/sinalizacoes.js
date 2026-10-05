import { Router } from "express";
import { apontamentosRepo, execucoesRepo, sinalizacoesRepo, transaction } from "../data/index.js";
import { parseJson } from "../formularios.js";

// Qualidade de dados: a IA sinaliza e sugere; a decisão (aceitar/rejeitar) é sempre humana (PCM/CCM).
export default function createSignalsRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const gestao = requireRole("CCM", "PCM");
  const isManager = (req) => req.user.papel !== "EXECUTANTE";

  // Executante vê apenas as sinalizações dos apontamentos que ele mesmo registrou (filtro no repositório).
  const present = ({ explicacao, ...row }) => ({ ...row, fatores: parseJson(explicacao, []) });
  const scope = (req) => ({ gestao: isManager(req) ? 1 : 0, usuario: req.user.id });

  router.get("/", (req, res) => {
    const status = ["Nova", "Aceita", "Rejeitada"].includes(req.query.status) ? req.query.status : null;
    res.json(sinalizacoesRepo.listVisible(scope(req), status).map(present));
  });

  router.get("/contador", (req, res) => {
    res.json(sinalizacoesRepo.countNewVisible(scope(req)));
  });

  router.get("/:id", (req, res) => {
    const row = sinalizacoesRepo.findVisible(scope(req), Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Sinalização não encontrada." });
    res.json(present(row));
  });

  const pending = (req, res) => {
    const signal = sinalizacoesRepo.findById(req.params.id);
    if (!signal) { res.status(404).json({ error: "Sinalização não encontrada." }); return null; }
    if (signal.status !== "Nova") { res.status(409).json({ error: `Esta sinalização já foi ${signal.status.toLowerCase()}.` }); return null; }
    return signal;
  };
  const text = (value) => String(value ?? "").trim().slice(0, 1000) || null;

  // Aceitar: corrige o apontamento com o valor sugerido ou com o valor definido pela pessoa.
  router.post("/:id/aceitar", gestao, (req, res) => {
    const signal = pending(req, res);
    if (!signal) return;
    const body = req.body || {};
    const valor = body.valor === undefined || body.valor === null || body.valor === "" ? signal.valor_sugerido : Number(body.valor);
    if (!Number.isFinite(valor) || valor <= 0 || valor > 1000) return res.status(400).json({ error: "Informe um valor de HH válido (maior que zero)." });
    const justificativa = text(body.justificativa);
    transaction(() => {
      if (signal.entidade_tipo === "apontamento" && signal.entidade_id) {
        apontamentosRepo.updateHours(signal.entidade_id, valor);
        // Apropriação feita pelo cronômetro: mantém o HH da execução coerente com o apontamento.
        execucoesRepo.updateHoursByAppointment(signal.entidade_id, valor);
      }
      sinalizacoesRepo.accept(signal.id, { valor, usuarioId: req.user.id, justificativa });
      audit(req.user.id, "aceitar_sinal", "sinalizacao", signal.id,
        `OM ${signal.ordem_numero} · ${signal.tipo} · ${signal.campo}: ${signal.valor_atual} → ${valor}${valor !== signal.valor_sugerido ? ` (sugerido ${signal.valor_sugerido})` : ""}${justificativa ? ` · ${justificativa}` : ""}`);
    });
    res.json({ ok: true, status: "Aceita", valor_aplicado: valor });
  });

  // Rejeitar: mantém o valor registrado; a justificativa é obrigatória para rastreabilidade.
  router.post("/:id/rejeitar", gestao, (req, res) => {
    const signal = pending(req, res);
    if (!signal) return;
    const justificativa = text((req.body || {}).justificativa);
    if (!justificativa) return res.status(400).json({ error: "Informe por que o valor registrado está correto." });
    transaction(() => {
      sinalizacoesRepo.reject(signal.id, { usuarioId: req.user.id, justificativa });
      audit(req.user.id, "rejeitar_sinal", "sinalizacao", signal.id,
        `OM ${signal.ordem_numero} · ${signal.tipo} · valor ${signal.valor_atual} mantido · ${justificativa}`);
    });
    res.json({ ok: true, status: "Rejeitada" });
  });

  return router;
}
