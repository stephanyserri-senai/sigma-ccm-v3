// Cálculo dos indicadores de manutenção baseados em OMs, compartilhado pela
// Visão geral (dashboard) e pelo módulo Indicadores.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PERIOD_DAYS = { "30d": 30, "90d": 90, "6m": 180, "12m": 365 };
export const TARGETS = { availability: 95, mtbf: 720, mttr: 4, iamot: 85, adherence: 85, backlog: 10 };

export const dateSql = (date) => date.toISOString().slice(0, 19).replace("T", " ");

export function metric(value, previous, unit, description, direction = "higher") {
  const currentValue = Number.isFinite(value) ? value : null;
  const previousValue = Number.isFinite(previous) ? previous : null;
  const delta = currentValue == null || previousValue == null ? null : currentValue - previousValue;
  const percent = delta == null || previousValue === 0 ? null : (delta / Math.abs(previousValue)) * 100;
  return { value: currentValue, previous: previousValue, delta, percent, unit, description, direction };
}

const CORRECTIVE = "(lower(o.tipo) LIKE '%corretiv%' OR lower(o.tipo) LIKE '%correctiv%')";
const SCHEDULED = "(o.data_programada IS NOT NULL AND o.data_programada <> '')";

// Indicadores das OMs criadas em [from, to), opcionalmente restritos a área, equipe ou equipamento.
// `hours` é a exposição por equipamento na janela (24 h por dia).
export function orderIndicators(db, { from, to, hours, area = null, equipeId = null, equipamentoId = null }) {
  const clauses = [];
  const params = [];
  if (area) { clauses.push("e.localizacao = ?"); params.push(area); }
  if (equipeId) { clauses.push("o.equipe_id = ?"); params.push(equipeId); }
  if (equipamentoId) { clauses.push("o.equipamento_id = ?"); params.push(equipamentoId); }

  const row = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      COALESCE(SUM(${SCHEDULED}), 0) AS scheduled,
      COALESCE(SUM(${SCHEDULED} AND o.status IN ('Distribuída','Em execução','Encerrada')), 0) AS adherent,
      COALESCE(SUM(o.status IN ('Aberta','Programada','Distribuída','Em execução')), 0) AS backlog,
      COALESCE(SUM(o.status = 'Encerrada'), 0) AS closed,
      COALESCE(SUM(${CORRECTIVE}), 0) AS failures,
      COUNT(DISTINCT o.equipamento_id) AS equipamentos_atendidos,
      COUNT(r.indisponibilidade_horas) AS downtime_entries,
      COALESCE(SUM(r.indisponibilidade_horas), 0) AS downtime_hours,
      COUNT(CASE WHEN ${CORRECTIVE} THEN r.indisponibilidade_horas END) AS failures_with_downtime,
      COUNT(CASE WHEN ${CORRECTIVE} THEN r.tempo_reparo_horas END) AS repair_entries,
      COALESCE(SUM(CASE WHEN ${CORRECTIVE} THEN r.tempo_reparo_horas ELSE 0 END), 0) AS repair_hours
    FROM ordens o
    LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    LEFT JOIN relatorios_execucao r ON r.ordem_id = o.id
    WHERE o.criado_em >= ? AND o.criado_em < ?${clauses.map((clause) => ` AND ${clause}`).join("")}
  `).get(from, to, ...params);

  // Frota exposta: o equipamento, os equipamentos atendidos pela equipe ou todos os da área.
  const equipamentos = equipamentoId ? 1 : equipeId ? row.equipamentos_atendidos
    : db.prepare("SELECT COUNT(*) AS total FROM equipamentos e WHERE (? IS NULL OR e.localizacao = ?)").get(area, area).total;
  const fleetHours = equipamentos * hours;

  return {
    availability: fleetHours > 0 && row.downtime_entries > 0
      ? Math.max(0, ((fleetHours - row.downtime_hours) / fleetHours) * 100)
      : null,
    mtbf: row.failures > 0 && row.failures_with_downtime === row.failures
      ? Math.max(0, (fleetHours - row.downtime_hours) / row.failures)
      : null,
    mttr: row.repair_entries > 0 ? row.repair_hours / row.repair_entries : null,
    adherence: row.scheduled > 0 ? (row.adherent / row.scheduled) * 100 : null,
    backlog: row.backlog,
    scheduled: row.scheduled,
    adherent: row.adherent,
    failures: row.failures,
    orders: row.orders,
    closed: row.closed,
    equipamentos,
    downtime_hours: row.downtime_hours,
    repair_hours: row.repair_hours,
  };
}
