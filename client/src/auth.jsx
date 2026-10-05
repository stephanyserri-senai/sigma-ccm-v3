import React, { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getToken();
    if (!t) { setLoading(false); return; }
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const login = async (username, senha) => {
    const { token, user } = await api.login(username, senha);
    setToken(token);
    setUser(user);
    return user;
  };
  const logout = () => { setToken(null); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Página inicial conforme o papel do usuário
export const homeFor = (papel) => (papel === "EXECUTANTE" ? "/apropriacao" : "/dashboard");

// Permissões de navegação por papel
export const PERMS = {
  CCM: ["dashboard", "indicadores", "notas", "ordens", "planejamento", "passagem-turno", "formularios", "mao-de-obra", "ia", "metas", "usuarios", "cadastros"],
  PCM: ["dashboard", "indicadores", "ordens", "planejamento", "passagem-turno", "formularios", "mao-de-obra", "ia"],
  EXECUTANTE: ["meu-plano", "apropriacao", "execucao", "ocorrencias", "passagem-turno", "formularios"],
};
