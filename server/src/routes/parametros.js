import { Router } from "express";
import { parametrosRepo, transaction } from "../data/index.js";
import { PARAMETERS, findParameter, getParameters } from "../parametros.js";

export default function createParametersRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);

  const list = () => {
    const values = getParameters();
    const meta = new Map(parametrosRepo.listUpdates().map((row) => [row.chave, row]));
    return PARAMETERS.map((item) => ({
      ...item,
      valor: values[item.chave],
      atualizado_em: meta.get(item.chave)?.atualizado_em || null,
      atualizado_por: meta.get(item.chave)?.atualizado_por || null,
    }));
  };

  router.get("/", requireRole("CCM", "PCM"), (_req, res) => res.json(list()));

  // Recebe { valores: { chave: número } }; só as chaves alteradas são gravadas e auditadas.
  router.put("/", requireRole("CCM"), (req, res) => {
    const valores = (req.body || {}).valores;
    if (!valores || typeof valores !== "object" || Array.isArray(valores) || !Object.keys(valores).length) {
      return res.status(400).json({ error: "Informe os valores a alterar." });
    }
    const changes = [];
    for (const [chave, raw] of Object.entries(valores)) {
      const item = findParameter(chave);
      if (!item) return res.status(400).json({ error: `Parâmetro desconhecido: ${chave}.` });
      const valor = raw === "" || raw == null ? NaN : Number(raw);
      if (!Number.isFinite(valor) || valor < item.min || valor > item.max) {
        return res.status(400).json({ error: `${item.label}: informe um valor entre ${item.min} e ${item.max} ${item.unidade}.` });
      }
      changes.push({ item, valor });
    }

    const current = getParameters();
    const changed = transaction(() => {
      let total = 0;
      for (const { item, valor } of changes) {
        if (current[item.chave] === valor) continue;
        parametrosRepo.upsert(item.chave, valor, req.user.id);
        audit(req.user.id, "alterar_parametro_kpi", "parametro_kpi", null, `${item.chave}: ${current[item.chave]} → ${valor}`);
        total += 1;
      }
      return total;
    });

    res.json({ alterados: changed, parametros: list() });
  });

  return router;
}
