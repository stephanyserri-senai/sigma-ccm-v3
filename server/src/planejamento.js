// Planejamento semanal: capacidade, carga e aderência prevista por equipe e dia.
import { addDays, parseIsoDate } from "./iamot.js";
import { getParameters, getTargets } from "./parametros.js";

const WORKDAYS = 5;
const isWorkday = (iso) => { const day = parseIsoDate(iso).getUTCDay(); return day >= 1 && day <= 5; };

// Capacidade diária da equipe (dias úteis): HH disponível lançado ÷ 5 ou, sem lançamento,
// pessoas ativas × HH semanal de referência ÷ 5; menos as ocorrências do dia. Fim de semana = 0.
export function weekPlan(db, semana) {
  const params = getParameters(db);
  const cargaMaxima = params.carga_maxima;
  const proxima = addDays(semana, 7);
  const dias = Array.from({ length: 7 }, (_, index) => addDays(semana, index));

  const teams = db.prepare(`
    SELECT e.id, e.nome,
           (SELECT COUNT(*) FROM usuarios u WHERE u.equipe_id = e.id AND u.ativo = 1) AS pessoas,
           h.hh_disponivel
    FROM equipes e LEFT JOIN hh_disponivel h ON h.equipe_id = e.id AND h.semana_inicio = ?
    ORDER BY e.nome
  `).all(semana);

  const occurrences = db.prepare(`
    SELECT COALESCE(u.equipe_id, c.equipe_id) AS equipe_id, oc.data_inicio,
           COALESCE(oc.data_fim, oc.data_inicio) AS data_fim, oc.horas_dia
    FROM ocorrencias_hh oc
    JOIN colaboradores c ON c.id = oc.colaborador_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE oc.data_inicio < ? AND COALESCE(oc.data_fim, oc.data_inicio) >= ?
  `).all(proxima, semana);

  const alocacoes = db.prepare(`
    SELECT a.id, a.ordem_id, a.equipe_id, a.data, a.hh_previsto, a.observacao,
           o.numero, o.status, o.tipo, o.hh_previsto AS hh_previsto_om, eq.tag AS equipamento,
           u.nome AS executante, cu.nome AS criado_por
    FROM programacao_atividades a
    JOIN ordens o ON o.id = a.ordem_id
    LEFT JOIN equipamentos eq ON eq.id = o.equipamento_id
    LEFT JOIN usuarios u ON u.id = o.responsavel_id
    LEFT JOIN usuarios cu ON cu.id = a.criado_por
    WHERE a.data >= ? AND a.data < ?
    ORDER BY a.data, o.numero
  `).all(semana, proxima);

  const overloaded = new Set();
  const equipes = teams.map((team) => {
    const estimada = team.hh_disponivel == null;
    const base = estimada ? (team.pessoas * params.hh_semana_pessoa) / WORKDAYS : team.hh_disponivel / WORKDAYS;
    const teamDays = dias.map((data) => {
      const ausencias = isWorkday(data)
        ? occurrences.filter((item) => item.equipe_id === team.id && item.data_inicio <= data && item.data_fim >= data)
          .reduce((sum, item) => sum + item.horas_dia, 0)
        : 0;
      const capacidade = isWorkday(data) ? Math.max(0, base - ausencias) : 0;
      const alocado = alocacoes.filter((item) => item.equipe_id === team.id && item.data === data).reduce((sum, item) => sum + item.hh_previsto, 0);
      const carga = capacidade > 0 ? (alocado / capacidade) * 100 : null;
      const sobrecarga = alocado > 0 && (carga == null || carga > cargaMaxima);
      if (sobrecarga) overloaded.add(`${team.id}|${data}`);
      return { data, capacidade, ausencias, alocado, carga, sobrecarga };
    });
    const capacidade = teamDays.reduce((sum, day) => sum + day.capacidade, 0);
    const alocado = teamDays.reduce((sum, day) => sum + day.alocado, 0);
    const carga = capacidade > 0 ? (alocado / capacidade) * 100 : null;
    return {
      id: team.id, nome: team.nome, pessoas: team.pessoas, capacidade_estimada: estimada,
      dias: teamDays,
      total: { capacidade, alocado, carga, sobrecarga: alocado > 0 && (carga == null || carga > cargaMaxima), dias_sobrecarga: teamDays.filter((day) => day.sobrecarga).length },
    };
  });

  // Aderência prevista: OMs da semana cujas alocações caem todas em equipe/dia sem sobrecarga.
  const porOm = new Map();
  for (const item of alocacoes) {
    if (item.status === "Cancelada") continue;
    const ok = !overloaded.has(`${item.equipe_id}|${item.data}`);
    porOm.set(item.ordem_id, (porOm.get(item.ordem_id) ?? true) && ok);
  }
  const aderentes = [...porOm.values()].filter(Boolean).length;
  const capacidade = equipes.reduce((sum, team) => sum + team.total.capacidade, 0);
  const alocado = equipes.reduce((sum, team) => sum + team.total.alocado, 0);

  return {
    semana: { inicio: semana, fim: addDays(semana, 6) },
    dias,
    equipes,
    alocacoes: alocacoes.map((item) => ({ ...item, sobrecarga: overloaded.has(`${item.equipe_id}|${item.data}`) })),
    resumo: {
      capacidade, alocado,
      carga: capacidade > 0 ? (alocado / capacidade) * 100 : null,
      carga_maxima: cargaMaxima,
      oms_alocadas: porOm.size,
      oms_aderentes: aderentes,
      aderencia_prevista: porOm.size ? (aderentes / porOm.size) * 100 : null,
      meta_aderencia: getTargets(db).adherence,
      dias_sobrecarga: overloaded.size,
    },
  };
}

// Mantém a programação da OM coerente com as alocações: datas (primeira e última),
// equipe da primeira alocação e status Aberta → Programada.
export function syncOrderSchedule(db, ordemId) {
  const agg = db.prepare("SELECT MIN(data) AS inicio, MAX(data) AS fim, COUNT(*) AS total FROM programacao_atividades WHERE ordem_id = ?").get(ordemId);
  if (!agg.total) return;
  const first = db.prepare("SELECT equipe_id FROM programacao_atividades WHERE ordem_id = ? ORDER BY data, id LIMIT 1").get(ordemId);
  db.prepare(`
    UPDATE ordens SET data_programada = ?, data_fim_programada = ?, equipe_id = ?,
           status = CASE WHEN status = 'Aberta' THEN 'Programada' ELSE status END
    WHERE id = ?
  `).run(agg.inicio, agg.fim !== agg.inicio ? agg.fim : null, first.equipe_id, ordemId);
}
