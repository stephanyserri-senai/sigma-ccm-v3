import React, { createContext, useContext, useEffect, useState } from "react";
import { SESSAO_EXPIRADA, api, getCachedUser, getToken, limparCacheOffline, setCachedUser, setToken } from "./api.js";

const AVISO_LOGIN = "sigma_aviso_login";
// Aviso a mostrar na tela de login (ex.: sessão expirada), lido uma única vez.
export const consumirAvisoLogin = () => { const aviso = sessionStorage.getItem(AVISO_LOGIN); sessionStorage.removeItem(AVISO_LOGIN); return aviso; };

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getToken();
    if (!t) { setLoading(false); return; }
    api.me()
      .then((current) => { setCachedUser(current); setUser(current); })
      // Sem conexão, o app abre com o último usuário conhecido; sessão inválida volta ao login.
      .catch((error) => { if (error.network && getCachedUser()) setUser(getCachedUser()); else setToken(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, senha) => {
    const { token, user } = await api.login(username, senha);
    setToken(token);
    setCachedUser(user);
    setUser(user);
    return user;
  };
  const logout = () => { setToken(null); setUser(null); limparCacheOffline(); };

  useEffect(() => {
    const expired = () => {
      if (!getToken()) return;
      sessionStorage.setItem(AVISO_LOGIN, "Sua sessão expirou. Entre novamente para continuar.");
      setToken(null);
      setUser(null);
    };
    window.addEventListener(SESSAO_EXPIRADA, expired);
    return () => window.removeEventListener(SESSAO_EXPIRADA, expired);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Página inicial conforme o papel do usuário
export const homeFor = (papel) => (papel === "EXECUTANTE" ? "/inicio" : "/dashboard");

// Permissões de navegação por papel.
// Formulários online e inspeções saíram do menu: os formulários em papel entram como foto na execução da OM.
export const PERMS = {
  CCM: ["dashboard", "indicadores", "notas", "ordens", "planejamento", "passagem-turno", "permissoes", "notificacoes", "mao-de-obra", "ia", "metas", "usuarios", "auditoria", "cadastros", "exportacao"],
  PCM: ["dashboard", "indicadores", "notas", "ordens", "planejamento", "passagem-turno", "permissoes", "notificacoes", "mao-de-obra", "ia"],
  EXECUTANTE: ["inicio", "meu-plano", "apropriacao", "execucao", "ocorrencias", "passagem-turno", "permissoes", "notificacoes"],
};
