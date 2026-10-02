import { Router } from "express";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = { "30d": 30, "90d": 90, "6m": 180, "12m": 365 };
const ACTIVE_STATUSES = new Set(["Aberta", "Programada", "Distribuída", "Em execução"]);
const ADHERENT_STATUSES = new Set(["Distribuída", "Em execução", "Encerrada"]);

const dateSql = (date) => date.toISOString().slice(0, 19).replace("T", " ");
const corrective = (type) => /corretiv|correctiv/i.test(String(type || ""));

function metric(value, previous, unit, description, direction = "higher") {
  const currentValue = Number.isFinite(value) ? value : null;
  const previousValue = Number.isFinite(previous) ? previous : null;
  const delta = currentValue == null || previousValue == null ? null : currentValue - previousValue;
  const percent = delta == null || previousValue === 0 ? null : (delta / Math.abs(previousValue)) * 100;
  return { value: currentValue, previous: previousValue, delta, percent, unit, description, direction };
}

export default function createDashboardRouter({ db, auth }) {
  const router = Router();

  router.get("/", auth, (req, res) => {
    const period = PERIOD_DAYS[req.query.period] ? req.query.period : "6m";
    const days = PERIOD_DAYS[period];
    const areaValues = db.prepare("SELECT DISTINCT localizacao FROM equipamentos WHERE localizacao IS NOT NULL AND trim(localizacao) <> '' ORDER BY localizacao")
      .all().map((row) => row.localizacao);
    const requestedArea = String(req.query.area || "all");
    const area = requestedArea === "all" || areaValues.includes(requestedArea) ? requestedArea : "all";
    const areaSql = area === "all" ? "" : " AND e.localizacao = ?";
    const areaParams = area === "all" ? [] : [area];
    const end = new Date();
    const start = new Date(end.getTime() - days * DAY_MS);
    const previousStart = new Date(start.getTime() - days * DAY_MS);
    const periodStart = dateSql(start);
    const periodEnd = dateSql(end);
    const previousFrom = dateSql(previousStart);
    const periodHours = Math.max(1, (end.getTime() - start.getTime()) / 3600000);

    const equipmentCount = db.prepare(`
      SELECT COUNT(*) AS total FROM equipamentos e
      WHERE (? = 'all' OR e.localizacao = ?)
    `).get(area, area).total;

    function summarize(from, to, hours) {
      const orders = db.prepare(`
        SELECT o.id, o.tipo, o.status, o.data_programada
        FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
        WHERE o.criado_em >= ? AND o.criado_em < ?${areaSql}
      `).all(from, to, ...(area === "all" ? [] : areaParams));
      const scheduled = orders.filter((order) => order.data_programada);
      const adherent = scheduled.filter((order) => ADHERENT_STATUSES.has(order.status));
      const backlog = orders.filter((order) => ACTIVE_STATUSES.has(order.status));
      const failures = orders.filter((order) => corrective(order.tipo));
      const orderIds = orders.map((order) => order.id);

      let labor = { actual: 0, planned: 0 };
      if (orderIds.length) {
        labor = db.prepare(`
          SELECT COALESCE(SUM(a.actual_hh), 0) AS actual, COALESCE(SUM(o.hh_previsto), 0) AS planned
          FROM ordens o
          JOIN (
            SELECT ordem_id, SUM(hh_apropriado) AS actual_hh
            FROM apontamentos WHERE tipo = 'Apropriação' GROUP BY ordem_id
          ) a ON a.ordem_id = o.id
          LEFT JOIN equipamentos e ON e.id = o.equipamento_id
          WHERE o.criado_em >= ? AND o.criado_em < ?${areaSql}
        `).get(from, to, ...(area === "all" ? [] : areaParams));
      }

      const reliability = db.prepare(`
        SELECT
          COUNT(r.indisponibilidade_horas) AS downtime_entries,
          COALESCE(SUM(r.indisponibilidade_horas), 0) AS downtime_hours,
          COUNT(CASE WHEN lower(o.tipo) LIKE '%corretiv%' OR lower(o.tipo) LIKE '%correctiv%' THEN r.indisponibilidade_horas END) AS failures_with_downtime,
          COUNT(CASE WHEN lower(o.tipo) LIKE '%corretiv%' OR lower(o.tipo) LIKE '%correctiv%' THEN r.tempo_reparo_horas END) AS repair_entries,
          COALESCE(SUM(CASE WHEN lower(o.tipo) LIKE '%corretiv%' OR lower(o.tipo) LIKE '%correctiv%' THEN r.tempo_reparo_horas ELSE 0 END), 0) AS repair_hours
        FROM ordens o
        LEFT JOIN equipamentos e ON e.id = o.equipamento_id
        LEFT JOIN relatorios_execucao r ON r.ordem_id = o.id
        WHERE o.criado_em >= ? AND o.criado_em < ?${areaSql}
      `).get(from, to, ...(area === "all" ? [] : areaParams));

      const fleetHours = equipmentCount * hours;
      const availability = fleetHours > 0 && reliability.downtime_entries > 0
        ? Math.max(0, ((fleetHours - reliability.downtime_hours) / fleetHours) * 100)
        : null;
      const mtbf = failures.length > 0 && reliability.failures_with_downtime === failures.length
        ? Math.max(0, (fleetHours - reliability.downtime_hours) / failures.length)
        : null;
      const mttr = reliability.repair_entries > 0 ? reliability.repair_hours / reliability.repair_entries : null;
      const iamot = labor.planned > 0 ? (labor.actual / labor.planned) * 100 : null;
      const adherence = scheduled.length > 0 ? (adherent.length / scheduled.length) * 100 : null;

      return {
        availability,
        mtbf,
        mttr,
        iamot,
        adherence,
        backlog: backlog.length,
        scheduled: scheduled.length,
        adherent: adherent.length,
        failures: failures.length,
      };
    }

    const current = summarize(periodStart, periodEnd, periodHours);
    const previous = summarize(previousFrom, periodStart, periodHours);
    const totalBacklog = db.prepare(`
      SELECT COUNT(*) AS total FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
      WHERE o.status IN ('Aberta','Programada','Distribuída','Em execução')${areaSql}
    `).get(...(area === "all" ? [] : areaParams)).total;

    const statusRows = db.prepare(`
      SELECT o.status, COUNT(*) AS total FROM ordens o
      LEFT JOIN equipamentos e ON e.id = o.equipamento_id
      WHERE o.criado_em >= ? AND o.criado_em < ?${areaSql}
      GROUP BY o.status ORDER BY total DESC
    `).all(periodStart, periodEnd, ...(area === "all" ? [] : areaParams));

    const criticalityRows = db.prepare(`
      SELECT COALESCE(e.criticidade, 'Sem criticidade') AS criticidade,
             COALESCE(e.localizacao, 'Sem área') AS area, COUNT(*) AS total
      FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
      WHERE o.criado_em >= ? AND o.criado_em < ?${areaSql}
      GROUP BY criticidade, area ORDER BY total DESC LIMIT 10
    `).all(periodStart, periodEnd, ...(area === "all" ? [] : areaParams))
      .map((row) => ({ ...row, label: `${row.criticidade} · ${row.area}` }));

    const alertRows = db.prepare(`
      SELECT s.id, s.tipo, s.status, s.score, s.criado_em, s.ordem_numero,
             e.tag AS equipamento, e.localizacao AS area
      FROM sinalizacoes_ia s
      LEFT JOIN ordens o ON o.numero = s.ordem_numero
      LEFT JOIN equipamentos e ON e.id = o.equipamento_id
      WHERE s.criado_em >= ? AND s.criado_em < ?${area === "all" ? "" : " AND e.localizacao = ?"}
      ORDER BY s.criado_em DESC LIMIT 8
    `).all(...(area === "all" ? [periodStart, periodEnd] : [periodStart, periodEnd, area]));

    const topRows = db.prepare(`
      SELECT e.id, e.tag, e.descricao, e.criticidade, e.localizacao AS area,
             COUNT(o.id) AS falhas,
             COUNT(r.indisponibilidade_horas) AS falhas_com_duracao,
             COALESCE(SUM(r.indisponibilidade_horas), 0) AS indisponibilidade_horas
      FROM equipamentos e
      JOIN ordens o ON o.equipamento_id = e.id
      LEFT JOIN relatorios_execucao r ON r.ordem_id = o.id
      WHERE o.criado_em >= ? AND o.criado_em < ?
        AND (lower(o.tipo) LIKE '%corretiv%' OR lower(o.tipo) LIKE '%correctiv%')
        AND (? = 'all' OR e.localizacao = ?)
      GROUP BY e.id ORDER BY falhas DESC, e.tag LIMIT 20
    `).all(periodStart, periodEnd, area, area).map((row) => ({
      ...row,
      mtbf: row.falhas > 0 && row.falhas_com_duracao === row.falhas
        ? Math.max(0, (periodHours - row.indisponibilidade_horas) / row.falhas)
        : null,
    })).sort((left, right) => {
      if (right.falhas !== left.falhas) return right.falhas - left.falhas;
      if (left.mtbf == null) return 1;
      if (right.mtbf == null) return -1;
      return left.mtbf - right.mtbf;
    }).slice(0, 5);

    const openOrders = db.prepare(`
      SELECT o.id, o.numero, o.tipo, o.status, o.data_programada,
             e.tag AS equipamento, e.criticidade, e.localizacao AS area, eq.nome AS equipe,
             u.nome AS executante
      FROM ordens o
      LEFT JOIN equipamentos e ON e.id = o.equipamento_id
      LEFT JOIN equipes eq ON eq.id = o.equipe_id
      LEFT JOIN usuarios u ON u.id = o.responsavel_id
      WHERE o.status IN ('Aberta','Programada','Distribuída','Em execução')${areaSql}
      ORDER BY CASE o.status WHEN 'Em execução' THEN 0 WHEN 'Aberta' THEN 1 ELSE 2 END,
               e.criticidade DESC, o.criado_em DESC LIMIT 12
    `).all(...(area === "all" ? [] : areaParams));

    const monthlyTrend = [];
    const now = new Date();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1));
      const monthHours = (monthEnd.getTime() - monthStart.getTime()) / 3600000;
      const stats = summarize(dateSql(monthStart), dateSql(monthEnd), monthHours);
      monthlyTrend.push({
        month: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(monthStart).replace(".", ""),
        availability: stats.availability == null ? null : Number(stats.availability.toFixed(1)),
        adherence: stats.adherence == null ? null : Number(stats.adherence.toFixed(1)),
      });
    }

    res.json({
      filters: { period, area, areas: areaValues },
      period: { from: periodStart, to: periodEnd, days },
      targets: { availability: 95, adherence: 85 },
      kpis: {
        availability: metric(current.availability, previous.availability, "%", "Estimativa; exposição calculada a 24 h por equipamento."),
        mtbf: metric(current.mtbf, previous.mtbf, "h", "Horas de frota por falha; requer parada informada em todas as OMs corretivas."),
        mttr: metric(current.mttr, previous.mttr, "h", "Média das horas de reparo informadas nas OMs corretivas.", "lower"),
        iamot: metric(current.iamot, previous.iamot, "%", "HH apropriado dividido pelo HH previsto."),
        adherence: metric(current.adherence, previous.adherence, "%", "OMs programadas distribuídas, em execução ou encerradas."),
        backlog: metric(current.backlog, previous.backlog, "OMs", "OMs criadas na janela e ainda abertas.", "lower"),
      },
      trend: monthlyTrend,
      ordersByStatus: statusRows,
      ordersByCriticality: criticalityRows,
      topEquipment: topRows,
      alerts: alertRows,
      backlog: { periodOpen: current.backlog, previousPeriodOpen: previous.backlog, totalOpen: totalBacklog, orders: openOrders },
      coverage: { scheduledOrders: current.scheduled, adherentOrders: current.adherent, failures: current.failures },
    });
  });

  return router;
}