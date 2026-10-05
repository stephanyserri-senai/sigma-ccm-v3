import { Router } from "express";
import { auditoriaRepo } from "../data/index.js";
import { parseIsoDate } from "../iamot.js";

const DEFAULT_SIZE = 25;
const MAX_SIZE = 100;

// Consulta da trilha de auditoria (somente CCM), com filtros e paginação no servidor.
export default function createAuditRouter({ auth, requireRole }) {
  const router = Router();
  router.use(auth, requireRole("CCM"));

  router.get("/filtros", (_req, res) => {
    res.json({
      usuarios: auditoriaRepo.listUsersWithEntries(),
      acoes: auditoriaRepo.countByAction(),
    });
  });

  router.get("/", (req, res) => {
    const usuario = Number(req.query.usuario_id) || null;
    const acao = String(req.query.acao || "").trim() || null;
    // Período em datas locais (AAAA-MM-DD); a trilha grava em UTC.
    const de = parseIsoDate(req.query.de) ? req.query.de : null;
    const ate = parseIsoDate(req.query.ate) ? req.query.ate : null;
    if (de && ate && de > ate) return res.status(400).json({ error: "A data inicial é posterior à final." });
    const tamanho = Math.min(MAX_SIZE, Math.max(1, Number.parseInt(req.query.tamanho, 10) || DEFAULT_SIZE));
    const params = { usuario, acao, de, ate };
    const total = auditoriaRepo.count(params);
    const paginas = Math.max(1, Math.ceil(total / tamanho));
    const pagina = Math.min(paginas, Math.max(1, Number.parseInt(req.query.pagina, 10) || 1));
    const itens = auditoriaRepo.page(params, { limite: tamanho, deslocamento: (pagina - 1) * tamanho });
    res.json({ itens, total, pagina, paginas, tamanho });
  });

  return router;
}
