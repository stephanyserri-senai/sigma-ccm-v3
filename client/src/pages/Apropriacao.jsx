import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wifi, CheckCircle2, AlertTriangle, Check, ArrowRight } from "lucide-react";
import { api } from "../api.js";
import { Btn, Spinner, inputCls } from "../components/ui.jsx";
import { useAuth, PERMS } from "../auth.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

const TIPOS = ["Apropriação", "Validação"];

export default function Apropriacao() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ordens, setOrdens] = useState(null);
  const [ordemId, setOrdemId] = useState("");
  const [tipo, setTipo] = useState("Apropriação");
  const [hh, setHh] = useState("6");
  const [res, setRes] = useState(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = () => api.ordens().then((l) => {
    setOrdens(l);
    setOrdemId((current) => l.some((order) => String(order.id) === current) ? current : l[0] ? String(l[0].id) : "");
  }).catch((e) => setErro(e.message));

  useEffect(() => { carregar(); }, []);

  const podeVerIA = (PERMS[user.papel] || []).includes("ia");

  const enviar = async () => {
    setErro(""); setRes(null); setEnviando(true);
    try {
      const r = await api.criarApontamento({ ordem_id: Number(ordemId), tipo, hh: Number(hh) });
      setRes(r);
      await carregar();
    } catch (e) { setErro(e.message); }
    finally { setEnviando(false); }
  };

  if (!ordens) return <Spinner />;
    const ordemSelecionada = ordens.find((order) => String(order.id) === ordemId);
    const encerrada = ordemSelecionada?.status === "Encerrada";

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
      <div className="mx-auto w-full max-w-xs">
        <div className="rounded-3xl border-8 border-slate-900 bg-white shadow-xl">
          <div className="flex items-center gap-2 rounded-t-2xl bg-slate-900 px-4 py-3">
            <img src="/sigma-icon.svg" alt="" className="h-6 w-6 rounded-md" />
            <span className="text-sm font-semibold text-white">SIGMA·CCM — Campo</span>
            <Wifi className="ml-auto h-4 w-4 text-emerald-400" />
          </div>
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900"><ThemeIcon name="worker" className="h-6 w-6" /> Apropriação de MO</div>
            <div>
              <label className="text-xs font-semibold text-slate-500">OM atribuída a {user.nome}</label>
              <select className={`mt-1 ${inputCls}`} value={ordemId} onChange={(e) => setOrdemId(e.target.value)}>
                {!ordens.length && <option value="">Nenhuma OM atribuída</option>}
                {ordens.map((o) => <option key={o.id} value={o.id}>{o.numero} — {o.equipamento}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Tipo de registro</label>
              <div className="mt-1 flex gap-1.5">
                {TIPOS.map((t) => (
                  <button key={t} onClick={() => setTipo(t)} className={`flex-1 rounded-full px-2 py-1.5 text-xs font-semibold transition-colors ${tipo === t ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">HH apropriado</label>
              <input type="number" step="0.5" className={`mt-1 ${inputCls}`} value={hh} onChange={(e) => setHh(e.target.value)} />
            </div>
            <Btn className="w-full" onClick={enviar} disabled={enviando || !ordemId || encerrada}>{enviando ? "Enviando…" : tipo === "Apropriação" ? "Apropriar mão de obra" : "Registrar validação"}</Btn>
            {ordemId && <Btn className="w-full" variant="ghost" onClick={() => navigate(`/execucao/${ordemId}`)}>Relatório de execução e fotos</Btn>}
            {encerrada && <div className="rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-600">OM encerrada; registros somente para consulta.</div>}
            {ordemSelecionada?.apropriado_por && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700">Mão de obra apropriada por {ordemSelecionada.apropriado_por}</div>}
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 py-2 text-xs font-semibold text-emerald-700"><Wifi className="h-3.5 w-3.5" /> online · registro sincronizado</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {!ordens.length && <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Nenhuma OM foi atribuída à sua conta. Peça ao PCM ou CCM para distribuir uma OM.</div>}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Execução em campo</div>
          <h3 className="mt-1 text-xl font-bold text-slate-900">Apropriação, relatório e validação</h3>
          <p className="mt-1 text-sm text-slate-500">Registre os três tipos na mesma ordem; ao completá-los, a ordem é encerrada automaticamente.</p>
        </div>

        {erro && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</div>}

        {res && (
          <div className="space-y-2">
            {res.sinal && (
              <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600" />
                <div className="text-sm">
                  <div className="font-semibold text-rose-700">Inconsistência detectada no HH registrado.</div>
                  {podeVerIA && <button onClick={() => navigate("/ia")} className="mt-1 inline-flex items-center gap-1 font-semibold text-rose-700 underline">Abrir em Qualidade de dados <ArrowRight className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            )}
            {res.encerrada && (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-5 w-5" /> Ordem {res.ordem_numero} encerrada automaticamente.
              </div>
            )}
            {!res.sinal && !res.encerrada && (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <Check className="h-5 w-5 text-emerald-600" /> Registro enviado.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
