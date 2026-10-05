import { Router } from "express";
import { addDays, parseIsoDate, todayLocal, weekStart } from "../iamot.js";
import { orderForms } from "../formularios.js";
import { generateNotifications, VISIBLE_SQL } from "../notificacoes.js";
import { validPermit } from "./permissoes.js";

const CLOSED = new Set(["Encerrada", "Cancelada"]);
const isIso = (value) => Boolean(parseIsoDate(value));

// Visão geral do executante: o que fazer agora, hoje e na semana, só com as OMs e
// pendências dele. Um único resumo para a tela abrir rápido (inclusive pelo cache offline).
export default function createFieldRouter({ db, auth, requireRole }) {
  const router = Router();
  router.use(auth, requireRole("EXECUTANTE"));

  router.get("/resumo", (req, res) => {
    const hoje = todayLocal();
    const inicioSemana = weekStart(hoje);
    const fimSemana = addDays(inicioSemana, 6);
    const usuario = db.prepare(`
      SELECT u.nome, e.nome AS equipe FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id WHERE u.id = ?
    `).get(req.user.id);

    const ordens = db.prepare(`
      SELECT o.id, o.numero, o.tipo, o.status, o.hh_previsto, o.data_programada, o.data_fim_programada, o.exige_pt,
             e.tag AS equipamento, e.descricao AS equipamento_descricao, e.localizacao AS area, e.criticidade,
             p.descricao AS plano,
             x.iniciado_em, x.finalizado_em, x.num_executantes
      FROM ordens o
      LEFT JOIN equipamentos e ON e.id = o.equipamento_id
      LEFT JOIN planos_preventivos p ON p.id = o.plano_id
      LEFT JOIN execucoes_om x ON x.ordem_id = o.id
      WHERE o.responsavel_id = ?
      ORDER BY o.data_programada, o.numero
    `).all(req.user.id).map((order) => {
      const programada = isIso(order.data_programada);
      const fim = programada ? (isIso(order.data_fim_programada) && order.data_fim_programada >= order.data_programada ? order.data_fim_programada : order.data_programada) : null;
      const aberta = !CLOSED.has(order.status);
      const formularios = aberta ? orderForms(db, order.id) : [];
      return {
        ...order,
        exige_pt: Boolean(order.exige_pt),
        inicio: programada ? order.data_programada : null,
        fim,
        aberta,
        atrasada: aberta && programada && fim < hoje,
        hoje: programada && order.data_programada <= hoje && fim >= hoje,
        em_execucao: Boolean(order.iniciado_em && !order.finalizado_em),
        pt_vigente: aberta && order.exige_pt ? Boolean(validPermit(db, order.id)) : null,
        checklists_pendentes: formularios.filter((form) => form.obrigatorio && !form.ultima_resposta).length,
        checklists_opcionais: formularios.filter((form) => !form.obrigatorio && !form.ultima_resposta).length,
      };
    });

    const dias = Array.from({ length: 7 }, (_, index) => addDays(inicioSemana, index)).map((data) => ({
      data,
      ordens: ordens.filter((order) => order.inicio && order.inicio <= data && order.fim >= data).map((order) => order.id),
    }));

    generateNotifications(db);
    const count = (sql, ...params) => db.prepare(sql).get(...params).total;
    const contadores = {
      notificacoes_nao_lidas: db.prepare(`
        SELECT COUNT(*) AS total FROM notificacoes n
        WHERE n.status <> 'Resolvida' AND ${VISIBLE_SQL}
          AND NOT EXISTS (SELECT 1 FROM notificacoes_leituras l WHERE l.notificacao_id = n.id AND l.usuario_id = @usuario)
      `).get({ papel: req.user.papel, usuario: req.user.id }).total,
      passagens_nao_lidas: count(`
        SELECT COUNT(*) AS total FROM passagens_turno p
        WHERE p.autor_id <> ? AND p.data >= date(?, '-7 days')
          AND NOT EXISTS (SELECT 1 FROM passagens_turno_leituras l WHERE l.passagem_id = p.id AND l.usuario_id = ?)
      `, req.user.id, hoje, req.user.id),
      sinalizacoes_novas: count(`
        SELECT COUNT(*) AS total FROM sinalizacoes_ia s JOIN apontamentos a ON s.entidade_tipo = 'apontamento' AND a.id = s.entidade_id
        WHERE s.status = 'Nova' AND a.usuario_id = ?
      `, req.user.id),
      rondas_em_andamento: count("SELECT COUNT(*) AS total FROM rondas_inspecao WHERE usuario_id = ? AND status = 'Em andamento'", req.user.id),
      pts_aguardando: count("SELECT COUNT(*) AS total FROM permissoes_trabalho WHERE solicitante_id = ? AND status = 'Solicitada'", req.user.id),
      ocorrencias_semana: count(`
        SELECT COUNT(*) AS total FROM ocorrencias_hh WHERE registrado_por = ? AND data_inicio <= ? AND COALESCE(data_fim, data_inicio) >= ?
      `, req.user.id, fimSemana, inicioSemana),
    };

    res.json({
      hoje,
      usuario: { nome: usuario?.nome || req.user.nome, equipe: usuario?.equipe || null },
      semana: { inicio: inicioSemana, fim: fimSemana, dias },
      ordens,
      contadores,
    });
  });

  return router;
}
