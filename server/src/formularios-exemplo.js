// Modelo de exemplo criado pela migração dos formulários dinâmicos.
export const EXAMPLE_FORM = {
  nome: "Checklist de segurança e liberação (exemplo)",
  tipo: "Checklist",
  descricao: "Exemplo de checklist inteligente: aparece em todas as OMs, com campo condicional e detecção de não conformidade.",
  regras: { automatico: true, obrigatorio: false, tipos_om: [], classes_equipamento: [] },
  campos: [
    { id: "loto", rotulo: "Equipamento bloqueado e etiquetado (LOTO)?", tipo: "simnao", obrigatorio: true, esperado: "Sim" },
    { id: "isolamento", rotulo: "Área isolada e sinalizada?", tipo: "simnao", obrigatorio: true, esperado: "Sim" },
    { id: "condicao_final", rotulo: "Condição do equipamento ao término", tipo: "selecao", obrigatorio: true,
      opcoes: ["Operando normalmente", "Operando com restrição", "Parado"], opcoes_nc: ["Parado"] },
    { id: "restricao", rotulo: "Descreva a restrição", tipo: "texto", obrigatorio: true,
      condicao: { campo: "condicao_final", valor: "Operando com restrição" } },
    { id: "temperatura", rotulo: "Temperatura do mancal", tipo: "numero", obrigatorio: false, unidade: "°C", limite_max: 80,
      ajuda: "Acima de 80 °C é registrado como não conformidade." },
    { id: "foto_liberacao", rotulo: "Foto do equipamento liberado", tipo: "foto", obrigatorio: false },
    { id: "assinatura", rotulo: "Assinatura do executante", tipo: "assinatura", obrigatorio: true },
  ],
};

// Modelos de exemplo criados pela migração de rotas de inspeção e permissões de trabalho.
export const EXAMPLE_INSPECTION = {
  nome: "Inspeção sensitiva de equipamento (exemplo)",
  tipo: "Inspeção",
  descricao: "Exemplo para pontos de rota: ruído, vibração, temperatura e vazamento.",
  regras: { automatico: false, obrigatorio: false, tipos_om: [], classes_equipamento: [] },
  campos: [
    { id: "ruido", rotulo: "Ruído anormal?", tipo: "simnao", obrigatorio: true, esperado: "Não" },
    { id: "vibracao", rotulo: "Vibração", tipo: "numero", obrigatorio: true, unidade: "mm/s", limite_max: 4.5 },
    { id: "temperatura", rotulo: "Temperatura", tipo: "numero", obrigatorio: false, unidade: "°C", limite_max: 80 },
    { id: "vazamento", rotulo: "Há vazamento?", tipo: "simnao", obrigatorio: true, esperado: "Não" },
    { id: "local_vazamento", rotulo: "Onde está o vazamento?", tipo: "texto", obrigatorio: true, condicao: { campo: "vazamento", valor: "Sim" } },
    { id: "foto", rotulo: "Foto do ponto", tipo: "foto", obrigatorio: false },
  ],
};

export const EXAMPLE_PERMIT = {
  nome: "APR / Permissão de Trabalho (exemplo)",
  tipo: "Permissão",
  descricao: "Análise preliminar de risco e permissão de trabalho. Respostas fora do esperado aparecem como alerta para o aprovador.",
  regras: { automatico: false, obrigatorio: false, tipos_om: [], classes_equipamento: [] },
  campos: [
    { id: "atividade", rotulo: "Atividade a executar", tipo: "texto", obrigatorio: true },
    { id: "altura", rotulo: "Trabalho em altura (acima de 2 m)?", tipo: "simnao", obrigatorio: true },
    { id: "linha_vida", rotulo: "Cinto e linha de vida inspecionados?", tipo: "simnao", obrigatorio: true, esperado: "Sim", condicao: { campo: "altura", valor: "Sim" } },
    { id: "quente", rotulo: "Trabalho a quente (solda, corte, esmerilhamento)?", tipo: "simnao", obrigatorio: true },
    { id: "extintor", rotulo: "Extintor e vigia posicionados?", tipo: "simnao", obrigatorio: true, esperado: "Sim", condicao: { campo: "quente", valor: "Sim" } },
    { id: "confinado", rotulo: "Espaço confinado?", tipo: "simnao", obrigatorio: true },
    { id: "atmosfera", rotulo: "Medição de gases (O₂)", tipo: "numero", obrigatorio: true, unidade: "%", limite_min: 19.5, limite_max: 23, condicao: { campo: "confinado", valor: "Sim" } },
    { id: "loto", rotulo: "Bloqueio de energias (LOTO) aplicado?", tipo: "simnao", obrigatorio: true, esperado: "Sim" },
    { id: "epi", rotulo: "EPIs necessários disponíveis e em bom estado?", tipo: "simnao", obrigatorio: true, esperado: "Sim" },
    { id: "medidas", rotulo: "Medidas de controle adotadas", tipo: "texto", obrigatorio: true },
    { id: "assinatura", rotulo: "Assinatura do solicitante", tipo: "assinatura", obrigatorio: true },
  ],
};
