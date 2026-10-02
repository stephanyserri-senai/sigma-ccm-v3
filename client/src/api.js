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

  sinalizacoes: () => req("/sinalizacoes"),
  aceitarSinal: (id) => req(`/sinalizacoes/${id}/aceitar`, { method: "POST" }),
  rejeitarSinal: (id) => req(`/sinalizacoes/${id}/rejeitar`, { method: "POST" }),

  usuarios: () => req("/usuarios"),
  criarUsuario: (u) => req("/usuarios", { method: "POST", body: u }),
};
