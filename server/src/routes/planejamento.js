import { Router } from "express";
import { parseIsoDate, todayLocal, weekStart } from "../iamot.js";
import { syncOrderSchedule, weekPlan } from "../planejamento.js";

const CLOSED = ["Encerrada", "Cancelada"];

export default function createPlanningRouter({ db, auth, requireRole, audit }) {
  const router = Router();
  router.use(auth, requireRole("CCM", "PCM"));

  router.get("/", (req, res) => {
    const semana = weekStart(req.query.semana) || weekStart(todayLocal());
    const plan = weekPlan(db, semana);
    // OMs ainda não totalmente alocadas (HH alocado em todas as semanas < HH previsto).
    plan.pendentes = db.prepare(`
      SELECT o.id, o.numero, o.tipo, o.status, o.equipe_id, eq.nome AS equipe, e.tag AS equipamento,
             o.hh_previsto, o.data_programada,
             COALESCE((SELECT SUM(a.hh_previsto) FROM programacao_atividades a WHERE a.ordem_id = o.id), 0) AS hh_alocado
      FROM ordens o
      LEFT JOIN equipamentos e ON e.id = o.equipamento_id
      LEFT JOIN equipes eq ON eq.id = o.equipe_id
      WHERE o.status NOT IN ('Encerrada','Cancelada')
        AND COALESCE((SELECT SUM(a.hh_previsto) FROM programacao_atividades a WHERE a.ordem_id = o.id), 0) < o.hh_previsto
      ORDER BY CASE o.status WHEN 'Aberta' THEN 0 WHEN 'Programada' THEN 1 ELSE 2 END, o.numero
    `).all();
    plan.ordens = db.prepare(`
      SELECT o.id, o.numero, o.status, o.hh_previsto, o.equipe_id, e.tag AS equipamento,
             COALESCE((SELECT SUM(a.hh_previsto) FROM programacao_atividades a WHERE a.ordem_id = o.id), 0) AS hh_alocado
      FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
      WHERE o.status NOT IN ('Encerrada','Cancelada') ORDER BY o.numero
    `).all();
    res.json(plan);
  });

  function validate(body) {
    const ordem = db.prepare("SELECT id, numero, status FROM ordens WHERE id = ?").get(Number(body.ordem_id));
    if (!ordem) return { status: 400, error: "Selecione uma OM." };
    if (CLOSED.includes(ordem.status)) return { status: 409, error: `A OM ${ordem.numero} está ${ordem.status.toLowerCase()}.` };
    const equipe = db.prepare("SELECT id, nome FROM equipes WHERE id = ?").get(Number(body.equipe_id));
    if (!equipe) return { status: 400, error: "Selecione uma equipe cadastrada." };
    const data = String(body.data || "").trim();
    if (!parseIsoDate(data)) return { status: 400, error: "Informe a data da atividade." };
    const hh = Number(body.hh_previsto);
    if (!Number.isFinite(hh) || hh <= 0 || hh > 1000) return { status: 400, error: "Informe o HH previsto (maior que zero)." };
    return { ordem, equipe, data, hh, observacao: String(body.observacao || "").trim().slice(0, 500) || null };
  }

  router.post("/alocacoes", (req, res) => {
    const valid = validate(req.body || {});
    if (valid.error) return res.status(valid.status).json({ error: valid.error });
    const created = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO programacao_atividades (ordem_id, equipe_id, data, hh_previsto, observacao, criado_por)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(valid.ordem.id, valid.equipe.id, valid.data, valid.hh, valid.observacao, req.user.id);
      syncOrderSchedule(db, valid.ordem.id);
      audit(req.user.id, "alocar_atividade", "ordem", valid.ordem.id, `OM ${valid.ordem.numero} · ${valid.equipe.nome} · ${valid.data} · ${valid.hh} HH`);
      return { id: info.lastInsertRowid };
    }).immediate();
    res.status(201).json(created);
  });

  router.put("/alocacoes/:id", (req, res) => {
    const current = db.prepare("SELECT id, ordem_id FROM programacao_atividades WHERE id = ?").get(req.params.id);
    if (!current) return res.status(404).json({ error: "Alocação não encontrada." });
    const valid = validate({ ...req.body, ordem_id: current.ordem_id });
    if (valid.error) return res.status(valid.status).json({ error: valid.error });
    db.transaction(() => {
      db.prepare(`
        UPDATE programacao_atividades SET equipe_id = ?, data = ?, hh_previsto = ?, observacao = ?, atualizado_em = datetime('now')
        WHERE id = ?
      `).run(valid.equipe.id, valid.data, valid.hh, valid.observacao, current.id);
      syncOrderSchedule(db, current.ordem_id);
      audit(req.user.id, "editar_alocacao", "ordem", current.ordem_id, `OM ${valid.ordem.numero} · ${valid.equipe.nome} · ${valid.data} · ${valid.hh} HH`);
    }).immediate();
    res.json({ ok: true });
  });

  router.delete("/alocacoes/:id", (req, res) => {
    const current = db.prepare(`
      SELECT a.id, a.ordem_id, a.data, o.numero FROM programacao_atividades a JOIN ordens o ON o.id = a.ordem_id WHERE a.id = ?
    `).get(req.params.id);
    if (!current) return res.status(404).json({ error: "Alocação não encontrada." });
    db.transaction(() => {
      db.prepare("DELETE FROM programacao_atividades WHERE id = ?").run(current.id);
      syncOrderSchedule(db, current.ordem_id);
      audit(req.user.id, "remover_alocacao", "ordem", current.ordem_id, `OM ${current.numero} · ${current.data}`);
    }).immediate();
    res.status(204).end();
  });

  // Consulta rápida do PCM: etapas do fluxo, alertas e a semana atual.
  router.get("/resumo", (req, res) => {
    const hoje = todayLocal();
    const count = (sql, ...params) => db.prepare(sql).get(...params).total;
    const plan = weekPlan(db, weekStart(hoje));
    res.json({
      hoje,
      fluxo: {
        notas_abertas: count("SELECT COUNT(*) AS total FROM notas WHERE status = 'Aberta'"),
        oms_abertas: count("SELECT COUNT(*) AS total FROM ordens WHERE status = 'Aberta'"),
        oms_sem_executante: count("SELECT COUNT(*) AS total FROM ordens WHERE status = 'Programada' AND responsavel_id IS NULL"),
        oms_distribuidas: count("SELECT COUNT(*) AS total FROM ordens WHERE status = 'Distribuída'"),
        oms_em_execucao: count("SELECT COUNT(*) AS total FROM ordens WHERE status = 'Em execução'"),
      },
      alertas: {
        oms_atrasadas: count(`
          SELECT COUNT(*) AS total FROM ordens
          WHERE status NOT IN ('Encerrada','Cancelada') AND data_programada GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND COALESCE(data_fim_programada, data_programada) < ?
        `, hoje),
        oms_sem_alocacao: count(`
          SELECT COUNT(*) AS total FROM ordens o WHERE o.status NOT IN ('Encerrada','Cancelada')
            AND NOT EXISTS (SELECT 1 FROM programacao_atividades a WHERE a.ordem_id = o.id)
        `),
        sinalizacoes_novas: count("SELECT COUNT(*) AS total FROM sinalizacoes_ia WHERE status = 'Nova'"),
        passagens_nao_lidas: count(`
          SELECT COUNT(*) AS total FROM passagens_turno p
          WHERE p.autor_id <> ? AND p.data >= date(?, '-7 days')
            AND NOT EXISTS (SELECT 1 FROM passagens_turno_leituras l WHERE l.passagem_id = p.id AND l.usuario_id = ?)
        `, req.user.id, hoje, req.user.id),
        pts_aguardando: count("SELECT COUNT(*) AS total FROM permissoes_trabalho WHERE status = 'Solicitada'"),
        rondas_em_andamento: count("SELECT COUNT(*) AS total FROM rondas_inspecao WHERE status = 'Em andamento'"),
        ocorrencias_semana: count(`
          SELECT COUNT(*) AS total FROM ocorrencias_hh WHERE data_inicio <= ? AND COALESCE(data_fim, data_inicio) >= ?
        `, plan.semana.fim, plan.semana.inicio),
      },
      semana: plan.resumo,
    });
  });

  return router;
}
