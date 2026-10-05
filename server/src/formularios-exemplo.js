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
