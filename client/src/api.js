import { FILA_SINCRONIZADA, adicionarPendencia, atualizarPendencia, listarPendencias, removerPendencia } from "./offline/fila.js";

const TOKEN_KEY = "sigma_token";
const USER_KEY = "sigma_usuario";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
// Usuário guardado para abrir o app sem conexão.
export const getCachedUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; } };
export const setCachedUser = (user) => (user ? localStorage.setItem(USER_KEY, JSON.stringify(user)) : localStorage.removeItem(USER_KEY));

// Falha de rede (sem conexão ou API fora do ar), diferente de um erro devolvido pela API.
const networkError = () => Object.assign(new Error("Sem conexão com o servidor. Verifique a rede e tente novamente."), { network: true });
// Mensagem em português quando a API não explica o erro.
const STATUS_MESSAGES = {
  400: "Dados inválidos. Revise os campos e tente novamente.",
  401: "Sua sessão expirou. Entre novamente.",
  403: "Você não tem permissão para esta ação.",
  404: "Registro não encontrado.",
  409: "A operação conflita com o estado atual do registro. Atualize a tela e tente novamente.",
  413: "Arquivo grande demais para envio.",
  500: "Erro interno do servidor. Tente novamente em instantes.",
};
export const SESSAO_EXPIRADA = "sessao:expirada";

async function req(path, { method = "GET", body, chave } = {}) {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (chave) headers["X-Idempotency-Key"] = chave;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? (isFormData ? body : JSON.stringify(body)) : undefined });
  } catch {
    throw networkError();
  }
  if ([502, 503, 504].includes(res.status)) throw networkError();
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    // Sessão expirada ou inválida em qualquer tela: volta ao login com aviso.
    if (res.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event(SESSAO_EXPIRADA));
    throw Object.assign(new Error((data && data.error) || STATUS_MESSAGES[res.status] || "Não foi possível concluir a operação."), { status: res.status });
  }
  return data;
}

// ---------------------------------------------------------------- Fila offline
const novaChave = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const usuarioAtual = () => getCachedUser()?.id ?? null;
const jsonBody = (valor) => ({ tipo: "json", valor: valor ?? {} });
const formBody = (dados, arquivos = {}) => ({
  tipo: "form",
  entradas: [["dados", JSON.stringify(dados)], ...Object.entries(arquivos).filter(([, file]) => file).map(([campo, file]) => [`arquivo:${campo}`, file, file.name || `${campo}.png`])],
});
const toFetchBody = (body) => {
  if (body.tipo === "json") return body.valor;
  const form = new FormData();
  body.entradas.forEach(([name, value, filename]) => (filename ? form.append(name, value, filename) : form.append(name, value)));
  return form;
};
// Registra no corpo o momento real em que a ação foi feita no aparelho.
const carimbar = (body, campo, momento) => {
  if (!campo) return body;
  if (body.tipo === "json") return { ...body, valor: { ...body.valor, [campo]: momento } };
  return { ...body, entradas: body.entradas.map(([name, value, filename]) => (name === "dados" ? [name, JSON.stringify({ ...JSON.parse(value), [campo]: momento })] : [name, value, filename])) };
};

// Envia agora; sem conexão, guarda na fila (com a mesma chave) e devolve { offline: true }.
async function mutate(path, { method = "POST", body, fila, carimbo }) {
  const chave = novaChave();
  const momento = new Date().toISOString();
  if (navigator.onLine !== false) {
    try { return await req(path, { method, body: toFetchBody(body), chave }); } catch (error) { if (!error.network) throw error; }
  }
  await adicionarPendencia({
    chave, path, method, body: carimbar(body, carimbo, momento), usuario_id: usuarioAtual(),
    tipo: fila.tipo, descricao: fila.descricao, meta: { ...fila.meta, momento },
  });
  return { offline: true };
}

let syncing = null;
// Envia as pendências do usuário em ordem. Para na falta de rede; erros da API ficam marcados.
export function sincronizar() {
  if (syncing) return syncing;
  syncing = (async () => {
    const userId = usuarioAtual();
    if (!userId || !getToken()) return { enviadas: 0 };
    let enviadas = 0;
    for (const item of await listarPendencias(userId)) {
      if (item.status !== "pendente") continue;
      try {
        await req(item.path, { method: item.method, body: toFetchBody(item.body), chave: item.chave });
        await removerPendencia(item.id);
        enviadas += 1;
      } catch (error) {
        if (error.network || error.status === 401) break;
        await atualizarPendencia(item.id, { status: "erro", erro: error.message, tentativas: (item.tentativas || 0) + 1 });
      }
    }
    if (enviadas) window.dispatchEvent(new Event(FILA_SINCRONIZADA));
    return { enviadas };
  })().finally(() => { syncing = null; });
  return syncing;
}

export async function tentarNovamente(id) {
  await atualizarPendencia(id, { status: "pendente", erro: null });
  return sincronizar();
}
export const descartarPendencia = removerPendencia;

// Sincroniza ao abrir, ao reconectar e a cada 30 s.
export function iniciarSincronizacao() {
  window.addEventListener("online", () => sincronizar());
  setInterval(() => { if (navigator.onLine !== false) sincronizar(); }, 30000);
  sincronizar();
}

// Limpa os dados guardados no aparelho ao sair (cache da API é por aparelho, não por usuário).
export async function limparCacheOffline() {
  setCachedUser(null);
  if (typeof caches !== "undefined") await caches.delete("sigma-api").catch(() => {});
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
      throw new Error((data && data.error) || STATUS_MESSAGES[response.status] || "Não foi possível exportar os indicadores.");
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
  responderFormulario: (dados, arquivos = {}, contexto = "Formulário") => mutate("/formularios/respostas", {
    body: formBody(dados, arquivos), carimbo: "preenchido_em",
    fila: { tipo: "formulario", descricao: `${contexto}${dados.ordem_id ? ` · OM #${dados.ordem_id}` : ""}`, meta: { modelo_id: dados.modelo_id, ordem_id: dados.ordem_id || null, equipamento_id: dados.equipamento_id || null } },
  }),
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
  responderPontoRonda: (rondaId, pontoId, respostas, arquivos = {}, contexto = `Ronda #${rondaId}`) => mutate(`/inspecoes/rondas/${rondaId}/pontos/${pontoId}/resposta`, {
    body: formBody({ respostas }, arquivos), carimbo: "preenchido_em",
    fila: { tipo: "ponto_ronda", descricao: `${contexto} · ponto inspecionado`, meta: { ronda_id: rondaId, ponto_id: pontoId } },
  }),
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
  notificacoes: (filtros = {}) => req(`/notificacoes?${new URLSearchParams(filtros).toString()}`),
  notificacoesContador: () => req("/notificacoes/contador"),
  notificacao: (id) => req(`/notificacoes/${id}`),
  destinatariosNotificacao: () => req("/notificacoes/destinatarios"),
  marcarNotificacaoLida: (id) => req(`/notificacoes/${id}/lida`, { method: "POST" }),
  marcarTodasNotificacoesLidas: () => req("/notificacoes/lidas", { method: "POST" }),
  responderNotificacao: (id, texto, resolver) => req(`/notificacoes/${id}/responder`, { method: "POST", body: { texto, resolver } }),
  encaminharNotificacao: (id, usuario_id, texto) => req(`/notificacoes/${id}/encaminhar`, { method: "POST", body: { usuario_id, texto } }),
  auditoria: (filtros = {}) => req(`/auditoria?${new URLSearchParams(filtros).toString()}`),
  auditoriaFiltros: () => req("/auditoria/filtros"),
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
  salvarRelatorio: (id, dados, contexto = `OM #${id}`) => mutate(`/ordens/${id}/relatorio`, {
    method: "PUT", body: jsonBody(dados), fila: { tipo: "relatorio", descricao: `${contexto} · Relatório de execução`, meta: { ordem_id: id } },
  }),
  evidencias: (id) => req(`/ordens/${id}/evidencias`),
  enviarEvidencias: (id, imagens, contexto = `OM #${id}`) => mutate(`/ordens/${id}/evidencias`, {
    body: { tipo: "form", entradas: imagens.map((image) => ["imagens", image, image.name]) },
    fila: { tipo: "evidencias", descricao: `${contexto} · ${imagens.length} foto(s) da execução`, meta: { ordem_id: id } },
  }),
  imagemOM: async (ordemId, evidenciaId) => {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api/ordens/${ordemId}/evidencias/${evidenciaId}/arquivo`, { headers });
    if (!response.ok) throw new Error("Não foi possível carregar a imagem.");
    return response.blob();
  },
  gerarOmPlano: (id) => req(`/gestao-cadastros/planos-preventivos/${id}/gerar-om`, { method: "POST" }),

  criarApontamento: (ap, contexto = `OM #${ap.ordem_id}`) => mutate("/apontamentos", {
    body: jsonBody(ap), carimbo: "registrado_em",
    fila: { tipo: "apontamento", descricao: `${contexto} · ${ap.tipo}`, meta: { ordem_id: ap.ordem_id, tipo_apontamento: ap.tipo } },
  }),
  iniciarExecucao: (id, dados, contexto = `OM #${id}`) => mutate(`/ordens/${id}/execucao/iniciar`, {
    body: jsonBody(dados), carimbo: "iniciado_em",
    fila: { tipo: "iniciar_execucao", descricao: `${contexto} · Início da execução`, meta: { ordem_id: id, num_executantes: dados.num_executantes, nomes: dados.nomes } },
  }),
  registrarIntercorrencia: (id, dados, contexto = `OM #${id}`) => mutate(`/ordens/${id}/execucao/intercorrencias`, {
    body: jsonBody(dados), carimbo: "registrado_em",
    fila: { tipo: "intercorrencia", descricao: `${contexto} · Intercorrência (${dados.tipo})`, meta: { ordem_id: id, tipo: dados.tipo, descricao: dados.descricao } },
  }),
  finalizarExecucao: (id, contexto = `OM #${id}`) => mutate(`/ordens/${id}/execucao/finalizar`, {
    body: jsonBody({}), carimbo: "finalizado_em",
    fila: { tipo: "finalizar_execucao", descricao: `${contexto} · Fim da execução (apropriação de HH)`, meta: { ordem_id: id } },
  }),

  maoDeObra: (semana) => req(`/mao-de-obra${semana ? `?semana=${semana}` : ""}`),
  lancarHhDisponivel: (dados) => req("/mao-de-obra/hh-disponivel", { method: "PUT", body: dados }),
  minhasOcorrencias: () => req("/mao-de-obra/minhas-ocorrencias"),
  criarOcorrencia: (dados) => req("/mao-de-obra/ocorrencias", { method: "POST", body: dados }),
  excluirOcorrencia: (id) => req(`/mao-de-obra/ocorrencias/${id}`, { method: "DELETE" }),

  sinalizacoes: (filtros = {}) => req(`/sinalizacoes?${new URLSearchParams(filtros).toString()}`),
  sinalizacao: (id) => req(`/sinalizacoes/${id}`),
  sinalizacoesContador: () => req("/sinalizacoes/contador"),
  // Decisão humana: aceitar (com valor ajustável) ou rejeitar com justificativa.
  aceitarSinal: (id, { valor, justificativa } = {}) => req(`/sinalizacoes/${id}/aceitar`, { method: "POST", body: { valor, justificativa } }),
  rejeitarSinal: (id, justificativa) => req(`/sinalizacoes/${id}/rejeitar`, { method: "POST", body: { justificativa } }),

  usuarios: () => req("/usuarios"),
  criarUsuario: (u) => req("/usuarios", { method: "POST", body: u }),
  vincularEquipeUsuario: (id, equipe_id) => req(`/usuarios/${id}/equipe`, { method: "PATCH", body: { equipe_id } }),
};
