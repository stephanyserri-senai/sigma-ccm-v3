// Metas e parâmetros de referência dos KPIs, editáveis pelo perfil CCM.
// Os valores padrão são exemplos; o banco (parametros_kpi) guarda os valores em vigor.

export const PARAMETERS = [
  { chave: "meta_disponibilidade", grupo: "meta", label: "Disponibilidade", unidade: "%", padrao: 95, min: 0, max: 100, passo: 0.1,
    direcao: "higher", descricao: "Mínimo esperado de disponibilidade dos equipamentos." },
  { chave: "meta_mtbf", grupo: "meta", label: "MTBF", unidade: "h", padrao: 720, min: 0, max: 100000, passo: 1,
    direcao: "higher", descricao: "Tempo médio mínimo entre falhas." },
  { chave: "meta_mttr", grupo: "meta", label: "MTTR", unidade: "h", padrao: 4, min: 0, max: 10000, passo: 0.1,
    direcao: "lower", descricao: "Tempo médio máximo de reparo." },
  { chave: "meta_iamot", grupo: "meta", label: "IAMOT", unidade: "%", padrao: 85, min: 0, max: 200, passo: 0.1,
    direcao: "higher", descricao: "Mínimo de HH apropriado sobre o HH disponível líquido." },
  { chave: "meta_aderencia", grupo: "meta", label: "Aderência", unidade: "%", padrao: 85, min: 0, max: 100, passo: 0.1,
    direcao: "higher", descricao: "Mínimo de OMs programadas que foram distribuídas, executadas ou encerradas." },
  { chave: "meta_backlog", grupo: "meta", label: "Backlog", unidade: "OMs", padrao: 10, min: 0, max: 100000, passo: 1,
    direcao: "lower", descricao: "Máximo de OMs abertas criadas no período." },
  { chave: "exposicao_horas_dia", grupo: "calculo", label: "Exposição diária por equipamento", unidade: "h/dia", padrao: 24, min: 1, max: 24, passo: 0.5,
    descricao: "Horas por dia em que cada equipamento deveria estar disponível. Base da Disponibilidade e do MTBF." },
  { chave: "jornada_horas_dia", grupo: "calculo", label: "Jornada diária padrão", unidade: "h/dia", padrao: 8, min: 0.5, max: 24, passo: 0.5,
    descricao: "Horas descontadas por dia útil de ocorrência (folga, férias, falta, atestado) quando não informado." },
  { chave: "hh_semana_pessoa", grupo: "calculo", label: "HH semanal de referência por pessoa", unidade: "h/semana", padrao: 40, min: 0, max: 168, passo: 0.5,
    descricao: "Sugestão de HH disponível por usuário da equipe ao lançar a semana em Mão de obra." },
  { chave: "carga_maxima", grupo: "calculo", label: "Carga máxima da equipe", unidade: "%", padrao: 100, min: 1, max: 300, passo: 1,
    descricao: "Acima deste percentual da capacidade, o dia da equipe fica em sobrecarga no Planejamento e sai da aderência prevista." },
  { chave: "antecedencia_preventiva_dias", grupo: "calculo", label: "Aviso de preventiva a vencer", unidade: "dias", padrao: 7, min: 0, max: 90, passo: 1,
    descricao: "Com quantos dias de antecedência a preventiva sem OM gera a notificação \"Preventiva a vencer\"." },
];

const BY_KEY = new Map(PARAMETERS.map((item) => [item.chave, item]));
export const findParameter = (chave) => BY_KEY.get(chave);

// Valores em vigor: padrão sobrescrito pelo que está no banco.
export function getParameters(db) {
  const values = Object.fromEntries(PARAMETERS.map((item) => [item.chave, item.padrao]));
  for (const row of db.prepare("SELECT chave, valor FROM parametros_kpi").all()) {
    if (BY_KEY.has(row.chave) && Number.isFinite(row.valor)) values[row.chave] = row.valor;
  }
  return values;
}

export function getTargets(db) {
  const values = getParameters(db);
  return {
    availability: values.meta_disponibilidade,
    mtbf: values.meta_mtbf,
    mttr: values.meta_mttr,
    iamot: values.meta_iamot,
    adherence: values.meta_aderencia,
    backlog: values.meta_backlog,
  };
}

// Converte as horas corridas de uma janela em horas de exposição dos equipamentos.
export function exposureHours(db, hours) {
  return hours * (getParameters(db).exposicao_horas_dia / 24);
}
