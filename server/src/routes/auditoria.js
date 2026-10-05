import { Router } from "express";
import { parseIsoDate } from "../iamot.js";

const DEFAULT_SIZE = 25;
const MAX_SIZE = 100;

// Consulta da trilha de auditoria (somente CCM), com filtros e paginação no servidor.
export default function createAuditRouter({ db, auth, requireRole }) {
  const router = Router();
  router.use(auth, requireRole("CCM"));

  router.get("/filtros", (_req, res) => {
    res.json({
      usuarios: db.prepare(`
        SELECT u.id, u.nome, u.username, u.papel FROM usuarios u
        WHERE EXISTS (SELECT 1 FROM trilha_auditoria t WHERE t.usuario_id = u.id) ORDER BY u.nome
      `).all(),
      acoes: db.prepare("SELECT acao, COUNT(*) AS total FROM trilha_auditoria GROUP BY acao ORDER BY acao").all(),
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
    const where = `
      WHERE (@usuario IS NULL OR t.usuario_id = @usuario)
        AND (@acao IS NULL OR t.acao = @acao)
        AND (@de IS NULL OR date(t.data_hora, 'localtime') >= @de)
        AND (@ate IS NULL OR date(t.data_hora, 'localtime') <= @ate)`;
    const total = db.prepare(`SELECT COUNT(*) AS total FROM trilha_auditoria t ${where}`).get(params).total;
    const paginas = Math.max(1, Math.ceil(total / tamanho));
    const pagina = Math.min(paginas, Math.max(1, Number.parseInt(req.query.pagina, 10) || 1));
    const itens = db.prepare(`
      SELECT t.id, t.data_hora, t.acao, t.entidade, t.entidade_id, t.detalhe,
             t.usuario_id, u.nome AS usuario_nome, u.username, u.papel
      FROM trilha_auditoria t LEFT JOIN usuarios u ON u.id = t.usuario_id
      ${where}
      ORDER BY t.id DESC LIMIT @limite OFFSET @deslocamento
    `).all({ ...params, limite: tamanho, deslocamento: (pagina - 1) * tamanho });
    res.json({ itens, total, pagina, paginas, tamanho });
  });

  return router;
}
