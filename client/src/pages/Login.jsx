import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { useAuth, homeFor } from "../auth.jsx";
import { inputCls } from "../components/ui.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const entrar = async () => {
    setErro("");
    setCarregando(true);
    try {
      const u = await login(username.trim(), senha);
      navigate(homeFor(u.papel), { replace: true });
    } catch (e) {
      setErro(e.message || "Não foi possível entrar.");
    } finally {
      setCarregando(false);
    }
  };

  const onKey = (e) => { if (e.key === "Enter") entrar(); };

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      <div className="hidden w-1/2 flex-col justify-between bg-slate-900 p-12 lg:flex">
        <div className="flex items-center gap-2">
          <img src="/sigma-icon.svg" alt="" className="h-9 w-9 rounded-lg" />
          <span className="text-lg font-bold text-white">SIGMA<span className="text-indigo-400">·CCM</span></span>
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight text-white">O centro de controle da<br />manutenção, em um só lugar.</h1>
          <p className="mt-4 max-w-sm text-sm text-slate-400">Notas, ordens, apropriação e indicadores integrados, com verificação automática da qualidade dos dados.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ThemeIcon name="shield-check" className="h-5 w-5" /> Acesso por perfil · conforme LGPD
        </div>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <img src="/sigma-icon.svg" alt="" className="h-9 w-9 rounded-lg" />
            <span className="text-lg font-bold text-slate-900">SIGMA<span className="text-indigo-600">·CCM</span></span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Entrar</h2>
          <p className="mt-1 text-sm text-slate-500">Acesse com seu usuário e senha.</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-500">Usuário</label>
              <input className={`mt-1 ${inputCls}`} value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={onKey} autoFocus placeholder="usuário" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Senha</label>
              <input type="password" className={`mt-1 ${inputCls}`} value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={onKey} placeholder="••••••••" />
            </div>

            {erro && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}

            <button onClick={entrar} disabled={carregando || !username || !senha}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400">
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Entrar <ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
