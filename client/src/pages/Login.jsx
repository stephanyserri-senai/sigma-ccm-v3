import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useAuth, homeFor, consumirAvisoLogin } from "../auth.jsx";
import { inputCls } from "../components/ui.jsx";
import MarcaConjunta from "../components/MarcaConjunta.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [aviso] = useState(() => consumirAvisoLogin());
  const [carregando, setCarregando] = useState(false);

  const entrar = async (event) => {
    event?.preventDefault();
    if (!username.trim() || !senha) { setErro("Informe o usuário e a senha."); return; }
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

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      {/* Lateral com a identidade VLI: azul da marca, assinatura conjunta VLI | SIGMA·CCM em cartão branco e o laranja do "!" como acento. */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: "linear-gradient(160deg, #0075C4 0%, #0063A8 55%, #00508A 100%)" }}>
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-40 h-[28rem] w-[28rem] rounded-full border-[3.5rem] border-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-24 right-24 h-24 w-24 rounded-full" style={{ backgroundColor: "#FF7B00" }} />

        <div className="relative">
          <div className="inline-flex rounded-2xl bg-white px-7 py-5 shadow-lg shadow-black/10">
            <MarcaConjunta size="lg" />
          </div>
        </div>

        <div className="relative max-w-md">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">Plataforma de gestão da manutenção</div>
          <h1 className="mt-3 text-4xl font-bold leading-tight text-white">
            O centro de controle da manutenção, em um só lugar<span style={{ color: "#FF7B00" }}>.</span>
          </h1>
          <p className="mt-4 text-base text-white/90">Notas, ordens, apropriação e indicadores integrados, com verificação automática da qualidade dos dados.</p>
        </div>

        <div className="relative flex items-center gap-2 text-sm text-white/90">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" /> Acesso por perfil · conforme LGPD
        </div>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* Celular: assinatura conjunta centralizada, como num lockup de co-branding. */}
          <div className="mb-8 flex justify-center rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-sm lg:hidden">
            <MarcaConjunta size="sm" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Entrar</h2>
          <p className="mt-1 text-sm text-slate-500">Acesse com seu usuário e senha.</p>

          {aviso && <div role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</div>}

          <form className="mt-6 space-y-4" onSubmit={entrar} noValidate>
            <div>
              <label htmlFor="login-usuario" className="text-xs font-semibold text-slate-500">Usuário</label>
              <input id="login-usuario" name="username" autoComplete="username" className={`mt-1 ${inputCls}`} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus placeholder="seu usuário" />
            </div>
            <div>
              <label htmlFor="login-senha" className="text-xs font-semibold text-slate-500">Senha</label>
              <input id="login-senha" name="password" type="password" autoComplete="current-password" className={`mt-1 ${inputCls}`} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" />
            </div>

            {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}

            <button type="submit" disabled={carregando}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0075C4] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#00508A] disabled:bg-slate-200 disabled:text-slate-400">
              {carregando ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Entrando…</> : <>Entrar <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
