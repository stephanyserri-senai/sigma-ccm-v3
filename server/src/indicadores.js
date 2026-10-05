// Cálculo dos indicadores de manutenção baseados em OMs, compartilhado pela
// Visão geral (dashboard) e pelo módulo Indicadores. Metas e exposição vêm de parametros.js.
import { equipamentosRepo, indicadoresRepo } from "./data/index.js";
import { exposureHours } from "./parametros.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PERIOD_DAYS = { "30d": 30, "90d": 90, "6m": 180, "12m": 365 };

export const dateSql = (date) => date.toISOString().slice(0, 19).replace("T", " ");

export function metric(value, previous, unit, description, direction = "higher") {
  const currentValue = Number.isFinite(value) ? value : null;
  const previousValue = Number.isFinite(previous) ? previous : null;
  const delta = currentValue == null || previousValue == null ? null : currentValue - previousValue;
  const percent = delta == null || previousValue === 0 ? null : (delta / Math.abs(previousValue)) * 100;
  return { value: currentValue, previous: previousValue, delta, percent, unit, description, direction };
}

// Indicadores das OMs criadas em [from, to), opcionalmente restritos a área, equipe ou equipamento.
// `hours` são as horas corridas da janela; a exposição diária vem dos parâmetros dos KPIs.
export function orderIndicators({ from, to, hours, area = null, equipeId = null, equipamentoId = null }) {
  const row = indicadoresRepo.orderTotals({ from, to, area, equipeId, equipamentoId });

  // Frota exposta: o equipamento, os equipamentos atendidos pela equipe ou todos os da área.
  const equipamentos = equipamentoId ? 1 : equipeId ? row.equipamentos_atendidos
    : equipamentosRepo.countInArea(area);
  const fleetHours = equipamentos * exposureHours(hours);

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
