// Planejamento semanal: capacidade, carga e aderência prevista por equipe e dia.
import { addDays, parseIsoDate } from "./iamot.js";
import { equipesRepo, ocorrenciasRepo, programacaoRepo } from "./data/index.js";
import { getParameters, getTargets } from "./parametros.js";

const WORKDAYS = 5;
const isWorkday = (iso) => { const day = parseIsoDate(iso).getUTCDay(); return day >= 1 && day <= 5; };

// Capacidade diária da equipe (dias úteis): HH disponível lançado ÷ 5 ou, sem lançamento,
// pessoas ativas × HH semanal de referência ÷ 5; menos as ocorrências do dia. Fim de semana = 0.
export function weekPlan(semana) {
  const params = getParameters();
  const cargaMaxima = params.carga_maxima;
  const proxima = addDays(semana, 7);
  const dias = Array.from({ length: 7 }, (_, index) => addDays(semana, index));

  const teams = equipesRepo.listWithWeekAvailability(semana);
  const occurrences = ocorrenciasRepo.listForPlanning(semana, proxima);
  const alocacoes = programacaoRepo.listInRange(semana, proxima);

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
      meta_aderencia: getTargets().adherence,
      dias_sobrecarga: overloaded.size,
    },
  };
}

// A sincronização das datas da OM com as alocações fica no repositório de programação.
export const syncOrderSchedule = programacaoRepo.syncOrderSchedule;
