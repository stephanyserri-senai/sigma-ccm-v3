// Consultas analíticas sobre as OMs (Visão geral, Indicadores e relatórios). Somente leitura.
// `area` nula = todas as áreas.
import { sql } from "../connection.js";

const CORRECTIVE = "(lower(o.tipo) LIKE '%corretiv%' OR lower(o.tipo) LIKE '%correctiv%')";
const SCHEDULED = "(o.data_programada IS NOT NULL AND o.data_programada <> '')";
const areaFilter = (area) => (area == null ? { clause: "", params: [] } : { clause: " AND e.localizacao = ?", params: [area] });

// Totais das OMs criadas em [from, to), opcionalmente por área, equipe ou equipamento.
export function orderTotals({ from, to, area = null, equipeId = null, equipamentoId = null }) {
  const clauses = [];
  const params = [];
  if (area) { clauses.push("e.localizacao = ?"); params.push(area); }
  if (equipeId) { clauses.push("o.equipe_id = ?"); params.push(equipeId); }
  if (equipamentoId) { clauses.push("o.equipamento_id = ?"); params.push(equipamentoId); }
  return sql(`
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
}

// OMs em aberto (backlog total, sem recorte de período).
export function countOpenOrders(area) {
  const filter = areaFilter(area);
  return sql(`
    SELECT COUNT(*) AS total FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    WHERE o.status IN ('Aberta','Programada','Distribuída','Em execução')${filter.clause}
  `).get(...filter.params).total;
}

export function countByStatus(from, to, area) {
  const filter = areaFilter(area);
  return sql(`
    SELECT o.status, COUNT(*) AS total FROM ordens o
    LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    WHERE o.criado_em >= ? AND o.criado_em < ?${filter.clause}
    GROUP BY o.status ORDER BY total DESC
  `).all(from, to, ...filter.params);
}

export function countByCriticalityAndArea(from, to, area) {
  const filter = areaFilter(area);
  return sql(`
    SELECT COALESCE(e.criticidade, 'Sem criticidade') AS criticidade,
           COALESCE(e.localizacao, 'Sem área') AS area, COUNT(*) AS total
    FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    WHERE o.criado_em >= ? AND o.criado_em < ?${filter.clause}
    GROUP BY criticidade, area ORDER BY total DESC LIMIT 10
  `).all(from, to, ...filter.params);
}

// Equipamentos com mais OMs corretivas (falhas) no período, com as horas de parada.
export const listFailuresByEquipment = (from, to, area) => sql(`
  SELECT e.id, e.tag, e.descricao, e.criticidade, e.localizacao AS area,
         COUNT(o.id) AS falhas,
         COUNT(r.indisponibilidade_horas) AS falhas_com_duracao,
         COALESCE(SUM(r.indisponibilidade_horas), 0) AS indisponibilidade_horas
  FROM equipamentos e
  JOIN ordens o ON o.equipamento_id = e.id
  LEFT JOIN relatorios_execucao r ON r.ordem_id = o.id
  WHERE o.criado_em >= ? AND o.criado_em < ?
    AND ${CORRECTIVE}
    AND (? = 'all' OR e.localizacao = ?)
  GROUP BY e.id ORDER BY falhas DESC, e.tag LIMIT 20
`).all(from, to, area ?? "all", area ?? "all");

// OMs em aberto mais urgentes (em execução, abertas, demais), por criticidade.
export function listOpenOrders(area) {
  const filter = areaFilter(area);
  return sql(`
    SELECT o.id, o.numero, o.tipo, o.status, o.data_programada,
           e.tag AS equipamento, e.criticidade, e.localizacao AS area, eq.nome AS equipe,
           u.nome AS executante
    FROM ordens o
    LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    LEFT JOIN equipes eq ON eq.id = o.equipe_id
    LEFT JOIN usuarios u ON u.id = o.responsavel_id
    WHERE o.status IN ('Aberta','Programada','Distribuída','Em execução')${filter.clause}
    ORDER BY CASE o.status WHEN 'Em execução' THEN 0 WHEN 'Aberta' THEN 1 ELSE 2 END,
             e.criticidade DESC, o.criado_em DESC LIMIT 12
  `).all(...filter.params);
}
