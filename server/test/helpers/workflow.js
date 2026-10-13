export async function prepareOrder(api, controlToken, order, executanteId, { release = false } = {}) {
  const plan = await api(controlToken, `/ordens/${order.id}/planejamento`, "PUT", {
    hh_previsto: order.hh_previsto || 4,
    escopo: "Executar a manutenção descrita na OM.",
    especialidades: "Equipe de manutenção compatível com o ativo.",
    ferramentas: "Ferramental padrão e instrumentos adequados.",
    procedimentos: "Seguir procedimento operacional vigente.",
    requisitos_seguranca: "Aplicar bloqueio e etiquetagem; utilizar EPIs.",
    criterios_aceitacao: "Teste funcional aprovado e área liberada.",
    tarefas: [{ descricao: "Inspecionar e corrigir a falha.", criterio: "Ativo operando dentro dos critérios." }],
    materiais: [],
    pronto: true,
  });
  if (!plan.ok) throw new Error(`Falha ao preparar planejamento da OM: ${plan.status} ${await plan.text()}`);

  const schedule = await api(controlToken, `/ordens/${order.id}/programacao`, "PATCH", {
    data_programada: new Date().toISOString().slice(0, 10),
    data_fim_programada: null,
    plano_id: order.plano_id || "",
    justificativa: "Adequação de programação para o teste do fluxo.",
  });
  if (!schedule.ok) throw new Error(`Falha ao programar OM: ${schedule.status} ${await schedule.text()}`);

  const distribution = await api(controlToken, `/ordens/${order.id}/status`, "PATCH", {
    status: "Distribuída",
    responsavel_id: executanteId,
  });
  if (!distribution.ok) throw new Error(`Falha ao distribuir OM: ${distribution.status} ${await distribution.text()}`);

  if (release) {
    const response = await api(controlToken, `/ordens/${order.id}/liberar`, "POST", {});
    if (!response.ok) throw new Error(`Falha ao liberar OM: ${response.status} ${await response.text()}`);
  }
}
