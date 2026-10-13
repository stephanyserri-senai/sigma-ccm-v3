const SHUTDOWN_PERIODS = new Set(["Trimestral", "Semestral", "Anual"]);

const PRIORITIES = {
  IMEDIATO: { nivel: 1, label: "Imediato", prazo_dias: 0 },
  URGENTE: { nivel: 2, label: "Urgente – 2 dias", prazo_dias: 2 },
  ALTO: { nivel: 3, label: "Alto – 1 semana", prazo_dias: 7 },
  MEDIO: { nivel: 4, label: "Médio – 14 dias", prazo_dias: 14 },
  BAIXO: { nivel: 5, label: "Baixo – 1 mês", prazo_dias: 30 },
  TRIMESTRAL: { nivel: 6, label: "Trimestral – parada programada", prazo_dias: null },
  SEMESTRAL: { nivel: 6, label: "Semestral – parada programada", prazo_dias: null },
  ANUAL: { nivel: 6, label: "Anual – parada programada", prazo_dias: null },
};

const REQUIRED_FLAGS = [
  "afeta_seguranca_ambiente",
  "afeta_custos",
  "afeta_producao_qualidade",
  "possui_reserva",
  "risco_iminente",
  "equipamento_monitorado",
  "recursos_disponiveis",
  "necessita_parada_programada",
];

export function calculatePriority(input = {}) {
  for (const flag of REQUIRED_FLAGS) {
    if (typeof input[flag] !== "boolean") {
      return { error: `Informe "true" ou "false" para ${flag}.` };
    }
  }

  const periodicidade = input.periodicidade_parada ?? null;
  if (periodicidade !== null && !SHUTDOWN_PERIODS.has(periodicidade)) {
    return { error: "A periodicidade da parada deve ser Trimestral, Semestral ou Anual." };
  }

  let criticidade;
  if (input.afeta_seguranca_ambiente || input.afeta_custos) {
    criticidade = "A";
  } else if (input.afeta_producao_qualidade || !input.possui_reserva) {
    criticidade = "B";
  } else {
    criticidade = "C";
  }

  let prioridade;
  if (input.risco_iminente) {
    prioridade = "IMEDIATO";
  } else if (!input.equipamento_monitorado) {
    prioridade = "URGENTE";
  } else if (!input.recursos_disponiveis && input.necessita_parada_programada) {
    if (!periodicidade) {
      return { error: "Informe a periodicidade da parada programada." };
    }
    prioridade = periodicidade.toUpperCase();
  } else {
    prioridade = { A: "ALTO", B: "MEDIO", C: "BAIXO" }[criticidade];
  }

  return {
    afeta_seguranca_ambiente: input.afeta_seguranca_ambiente,
    afeta_custos: input.afeta_custos,
    afeta_producao_qualidade: input.afeta_producao_qualidade,
    possui_reserva: input.possui_reserva,
    risco_iminente: input.risco_iminente,
    equipamento_monitorado: input.equipamento_monitorado,
    recursos_disponiveis: input.recursos_disponiveis,
    necessita_parada_programada: input.necessita_parada_programada,
    periodicidade_parada: periodicidade,
    criticidade,
    prioridade,
    prioridade_nivel: PRIORITIES[prioridade].nivel,
    prioridade_label: PRIORITIES[prioridade].label,
    prazo_dias: PRIORITIES[prioridade].prazo_dias,
    priorizacao_pendente: false,
  };
}

export function priorityLabel(priority) {
  return PRIORITIES[priority]?.label ?? null;
}
