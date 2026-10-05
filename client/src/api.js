const TOKEN_KEY = "sigma_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function req(path, { method = "GET", body } = {}) {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) throw new Error((data && data.error) || "Falha na requisição.");
  return data;
}

export const api = {
  login: (username, senha) => req("/auth/login", { method: "POST", body: { username, senha } }),
  me: () => req("/auth/me"),

  dashboard: (filters = {}) => {
    const params = new URLSearchParams(filters);
    return req(`/dashboard?${params.toString()}`);
  },
  indicadores: (filters = {}) => req(`/indicadores?${new URLSearchParams(filters).toString()}`),
  exportarIndicadores: async (params) => {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api/indicadores/export?${new URLSearchParams(params).toString()}`, { headers });
    if (!response.ok) {
      let data = null;
      try { data = await response.json(); } catch { /* sem corpo */ }
      throw new Error((data && data.error) || "Não foi possível exportar os indicadores.");
    }
    const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "indicadores.csv";
    return { blob: await response.blob(), name };
  },
  planejamento: (semana) => req(`/planejamento${semana ? `?semana=${semana}` : ""}`),
  alocarAtividade: (dados) => req("/planejamento/alocacoes", { method: "POST", body: dados }),
  editarAlocacao: (id, dados) => req(`/planejamento/alocacoes/${id}`, { method: "PUT", body: dados }),
  removerAlocacao: (id) => req(`/planejamento/alocacoes/${id}`, { method: "DELETE" }),
  resumoPcm: () => req("/planejamento/resumo"),
  passagensTurno: (filtro) => req(`/passagens-turno?filtro=${filtro}`),
  registrarPassagem: (dados) => req("/passagens-turno", { method: "POST", body: dados }),
  confirmarLeituraPassagem: (id) => req(`/passagens-turno/${id}/leitura`, { method: "POST" }),
  formularioModelos: (todos = false) => req(`/formularios/modelos${todos ? "?todos=1" : ""}`),
  formularioModelo: (id) => req(`/formularios/modelos/${id}`),
  criarFormularioModelo: (dados) => req("/formularios/modelos", { method: "POST", body: dados }),
  salvarFormularioModelo: (id, dados) => req(`/formularios/modelos/${id}`, { method: "PUT", body: dados }),
  excluirFormularioModelo: (id) => req(`/formularios/modelos/${id}`, { method: "DELETE" }),
  formulariosOM: (ordemId) => req(`/formularios/ordem/${ordemId}`),
  vincularFormularioOM: (ordemId, dados) => req(`/formularios/ordem/${ordemId}/vinculos`, { method: "POST", body: dados }),
  desvincularFormularioOM: (ordemId, modeloId) => req(`/formularios/ordem/${ordemId}/vinculos/${modeloId}`, { method: "DELETE" }),
  // Fotos e assinaturas vão como arquivos "arquivo:<campo>"; o restante, em "dados" (JSON).
  responderFormulario: (dados, arquivos = {}) => {
    const body = new FormData();
    body.append("dados", JSON.stringify(dados));
    Object.entries(arquivos).forEach(([campo, file]) => body.append(`arquivo:${campo}`, file, file.name || `${campo}.png`));
    return req("/formularios/respostas", { method: "POST", body });
  },
  formularioRespostas: (filtros = {}) => req(`/formularios/respostas?${new URLSearchParams(filtros).toString()}`),
  formularioResposta: (id) => req(`/formularios/respostas/${id}`),
  anexoFormulario: async (respostaId, anexoId) => {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api/formularios/respostas/${respostaId}/anexos/${anexoId}`, { headers });
    if (!response.ok) throw new Error("Não foi possível carregar o arquivo.");
    return response.blob();
  },
  rotasInspecao: (todas = false) => req(`/inspecoes/rotas${todas ? "?todas=1" : ""}`),
  rotaInspecao: (id) => req(`/inspecoes/rotas/${id}`),
  criarRotaInspecao: (dados) => req("/inspecoes/rotas", { method: "POST", body: dados }),
  salvarRotaInspecao: (id, dados) => req(`/inspecoes/rotas/${id}`, { method: "PUT", body: dados }),
  excluirRotaInspecao: (id) => req(`/inspecoes/rotas/${id}`, { method: "DELETE" }),
  rondasInspecao: () => req("/inspecoes/rondas"),
  rondaInspecao: (id) => req(`/inspecoes/rondas/${id}`),
  iniciarRonda: (rotaId) => req("/inspecoes/rondas", { method: "POST", body: { rota_id: rotaId } }),
  responderPontoRonda: (rondaId, pontoId, respostas, arquivos = {}) => {
    const body = new FormData();
    body.append("dados", JSON.stringify({ respostas }));
    Object.entries(arquivos).forEach(([campo, file]) => body.append(`arquivo:${campo}`, file, file.name || `${campo}.png`));
    return req(`/inspecoes/rondas/${rondaId}/pontos/${pontoId}/resposta`, { method: "POST", body });
  },
  pularPontoRonda: (rondaId, pontoId, motivo) => req(`/inspecoes/rondas/${rondaId}/pontos/${pontoId}/pular`, { method: "POST", body: { motivo } }),
  concluirRonda: (rondaId, observacao) => req(`/inspecoes/rondas/${rondaId}/concluir`, { method: "POST", body: { observacao } }),

  permissoes: (filtros = {}) => req(`/permissoes?${new URLSearchParams(filtros).toString()}`),
  permissao: (id) => req(`/permissoes/${id}`),
  solicitarPermissao: (dados, arquivos = {}) => {
    const body = new FormData();
    body.append("dados", JSON.stringify(dados));
    Object.entries(arquivos).forEach(([campo, file]) => body.append(`arquivo:${campo}`, file, file.name || `${campo}.png`));
    return req("/permissoes", { method: "POST", body });
  },
  acaoPermissao: (id, acao, parecer) => req(`/permissoes/${id}/${acao}`, { method: "POST", body: { parecer } }),
  exigenciaPT: (ordemId, exige) => req(`/permissoes/ordem/${ordemId}/exigencia`, { method: "PATCH", body: { exige_pt: exige } }),
  parametrosKpi: () => req("/parametros-kpi"),
  salvarParametrosKpi: (valores) => req("/parametros-kpi", { method: "PUT", body: { valores } }),
  cadastros: () => req("/cadastros"),
  listarCadastro: (recurso) => req(`/gestao-cadastros/${recurso}`),
  previaTagEquipamento: (dados) => req("/gestao-cadastros/equipamentos/tag-preview", { method: "POST", body: dados }),
  criarCadastro: (recurso, dados) => req(`/gestao-cadastros/${recurso}`, { method: "POST", body: dados }),
  atualizarCadastro: (recurso, id, dados) => req(`/gestao-cadastros/${recurso}/${id}`, { method: "PUT", body: dados }),
  excluirCadastro: (recurso, id) => req(`/gestao-cadastros/${recurso}/${id}`, { method: "DELETE" }),

  notas: () => req("/notas"),
  criarNota: (nota) => req("/notas", { method: "POST", body: nota }),
  converterNota: (id) => req(`/notas/${id}/converter`, { method: "POST" }),

  ordens: () => req("/ordens"),
  ordem: (id) => req(`/ordens/${id}`),
  statusOrdem: (id, status, responsavel_id) => req(`/ordens/${id}/status`, { method: "PATCH", body: { status, responsavel_id } }),
  programarOrdem: (id, dados) => req(`/ordens/${id}/programacao`, { method: "PATCH", body: dados }),
  executantes: () => req("/ordens/executantes"),
  salvarRelatorio: (id, dados) => req(`/ordens/${id}/relatorio`, { method: "PUT", body: dados }),
  evidencias: (id) => req(`/ordens/${id}/evidencias`),
  enviarEvidencias: (id, imagens) => {
    const body = new FormData();
    imagens.forEach((image) => body.append("imagens", image));
    return req(`/ordens/${id}/evidencias`, { method: "POST", body });
  },
  imagemOM: async (ordemId, evidenciaId) => {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api/ordens/${ordemId}/evidencias/${evidenciaId}/arquivo`, { headers });
    if (!response.ok) throw new Error("Não foi possível carregar a imagem.");
    return response.blob();
  },
  gerarOmPlano: (id) => req(`/gestao-cadastros/planos-preventivos/${id}/gerar-om`, { method: "POST" }),

  criarApontamento: (ap) => req("/apontamentos", { method: "POST", body: ap }),
  iniciarExecucao: (id, dados) => req(`/ordens/${id}/execucao/iniciar`, { method: "POST", body: dados }),
  registrarIntercorrencia: (id, dados) => req(`/ordens/${id}/execucao/intercorrencias`, { method: "POST", body: dados }),
  finalizarExecucao: (id) => req(`/ordens/${id}/execucao/finalizar`, { method: "POST" }),

  maoDeObra: (semana) => req(`/mao-de-obra${semana ? `?semana=${semana}` : ""}`),
  lancarHhDisponivel: (dados) => req("/mao-de-obra/hh-disponivel", { method: "PUT", body: dados }),
  minhasOcorrencias: () => req("/mao-de-obra/minhas-ocorrencias"),
  criarOcorrencia: (dados) => req("/mao-de-obra/ocorrencias", { method: "POST", body: dados }),
  excluirOcorrencia: (id) => req(`/mao-de-obra/ocorrencias/${id}`, { method: "DELETE" }),

  sinalizacoes: () => req("/sinalizacoes"),
  aceitarSinal: (id) => req(`/sinalizacoes/${id}/aceitar`, { method: "POST" }),
  rejeitarSinal: (id) => req(`/sinalizacoes/${id}/rejeitar`, { method: "POST" }),

  usuarios: () => req("/usuarios"),
  criarUsuario: (u) => req("/usuarios", { method: "POST", body: u }),
  vincularEquipeUsuario: (id, equipe_id) => req(`/usuarios/${id}/equipe`, { method: "PATCH", body: { equipe_id } }),
};
