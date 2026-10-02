import React, { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { api } from "../api.js";
import { Card, Badge, Btn, Spinner, statusTone } from "../components/ui.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

export default function IA() {
  const [lista, setLista] = useState(null);
  const [sel, setSel] = useState(null);
  const [erro, setErro] = useState("");

  const carregar = () => api.sinalizacoes().then((l) => { setLista(l); if (sel == null && l[0]) setSel(l[0].id); }).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  const decidir = async (fn, id) => { try { await fn(id); await carregar(); } catch (e) { setErro(e.message); } };

  if (erro) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{erro}</div>;
  if (!lista) return <Spinner />;

  const s = lista.find((x) => x.id === sel) || lista[0];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2 font-semibold text-slate-800"><ThemeIcon name="warning" className="h-5 w-5" /> Sinalizações de inconsistência</div>
          <Badge tone="indigo"><ThemeIcon name="monitor-pulse" className="mr-1 h-3.5 w-3.5" /> detecção heurística + faixa</Badge>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2.5 font-semibold">OM</th>
              <th className="px-5 py-2.5 font-semibold">Tipo</th>
              <th className="px-5 py-2.5 font-semibold">Score</th>
              <th className="px-5 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((x) => (
              <tr key={x.id} onClick={() => setSel(x.id)} className={`cursor-pointer border-b border-slate-50 last:border-0 ${sel === x.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                <td className="px-5 py-3 font-mono font-semibold text-slate-700">{x.ordem_numero}</td>
                <td className="px-5 py-3 text-slate-600">{x.tipo}</td>
                <td className="px-5 py-3 font-mono tabular-nums text-slate-700">{Number(x.score).toFixed(2)}</td>
                <td className="px-5 py-3"><Badge tone={statusTone(x.status)}>{x.status}</Badge></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">Nenhuma inconsistência registrada.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="p-5 lg:col-span-2">
        {s ? (<>
          <div className="font-semibold text-slate-800">Detalhe da sinalização</div>
          <div className="mt-0.5 font-mono text-xs text-slate-500">OM {s.ordem_numero} · campo {s.campo}</div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Valor atual</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-rose-600">{s.valor_atual},0 h</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sugerido</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-emerald-600">{s.valor_sugerido},0 h</div>
            </div>
          </div>

          <div className="mt-5 text-sm font-semibold text-slate-800">Por que foi sinalizado</div>
          <div className="mt-2 space-y-3">
            {(s.fatores || []).map((f, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs text-slate-500"><span>{f.t}</span><span className="tabular-nums">{Math.round(f.v * 100)}%</span></div>
                <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${Math.round(f.v * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <span className="font-semibold text-slate-600">Sugestão: </span>
            <span className="text-slate-700">corrigir HH de {s.valor_atual},0 para {s.valor_sugerido},0 h.</span>
          </div>

          {s.status === "Nova" ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Btn onClick={() => decidir(api.aceitarSinal, s.id)}>Aceitar sugestão</Btn>
              <Btn variant="danger" onClick={() => decidir(api.rejeitarSinal, s.id)}>Rejeitar</Btn>
            </div>
          ) : (
            <div className={`mt-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${s.status === "Aceita" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {s.status === "Aceita" ? <CheckCircle2 className="h-5 w-5" /> : <X className="h-5 w-5" />}
              {s.status === "Aceita" ? "Sugestão aceita — apontamento corrigido." : "Sinalização rejeitada — valor mantido."}
            </div>
          )}
          <p className="mt-3 text-center text-[11px] text-slate-400">A decisão é sempre do responsável.</p>
        </>) : <div className="py-10 text-center text-sm text-slate-400">Selecione uma sinalização.</div>}
      </Card>
    </div>
  );
}
