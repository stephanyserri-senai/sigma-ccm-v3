import React, { useEffect, useState } from "react";
import { Lock, Send, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Card, inputCls, Spinner, ErrorState } from "../components/ui.jsx";
import { useNoticeToast } from "../components/toast.jsx";

const OCCURRENCE_TONES = { Folga: "slate", Férias: "indigo", Falta: "rose", Atestado: "amber" };
const dateBr = (iso) => iso ? iso.split("-").reverse().join("/") : "—";
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function Ocorrencias() {
  const [data, setData] = useState(null);
  const [values, setValues] = useState(null);
  const [error, setError] = useState("");
  const setNotice = useNoticeToast();
  const [saving, setSaving] = useState(false);

  const empty = (source) => ({
    colaborador_id: source.colaboradores.length === 1 ? String(source.colaboradores[0].id) : "",
    tipo: source.tipos_ocorrencia[0], data_inicio: today(), data_fim: today(), horas_dia: String(source.horas_dia_padrao ?? 8), observacao: "",
  });
  const carregar = () => api.minhasOcorrencias().then((result) => {
    setData(result);
    setValues((previous) => previous || empty(result));
    return result;
  }).catch((e) => setError(e.message));
  useEffect(() => { carregar(); }, []);

  if (!data || !values) return error ? <ErrorState message={error} /> : <Spinner />;

  const set = (key) => (event) => setValues((previous) => ({ ...previous, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      await api.criarOcorrencia(values);
      setValues(empty(data));
      setNotice("Ocorrência enviada ao PCM e ao CCM.");
      await carregar();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (row) => {
    if (!window.confirm(`Excluir a ocorrência de ${row.colaborador}?`)) return;
    setError(""); setNotice("");
    try { await api.excluirOcorrencia(row.id); setNotice("Ocorrência excluída."); await carregar(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
      <Card className="p-5 lg:col-span-2">
        <h2 className="font-semibold text-slate-800">Enviar ocorrência</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Informe folga, férias, falta ou atestado de quem é da sua equipe{data.equipe ? ` (${data.equipe.nome})` : ""}. O PCM e o CCM acompanham os envios.
        </p>
        {!data.equipe && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Seu usuário não está vinculado a uma equipe. Procure o CCM.</div>}
        {data.equipe && !data.colaboradores.length && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Nenhum usuário ativo está vinculado à sua equipe. Procure o CCM.</div>}
        <form onSubmit={submit} className="mt-4 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Colaborador</span>
            <select required className={`mt-1 ${inputCls}`} value={values.colaborador_id} onChange={set("colaborador_id")}>
              <option value="">Selecione o colaborador</option>
              {data.colaboradores.map((person) => <option key={person.id} value={person.id}>{person.nome} · {person.username}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Tipo</span>
              <select className={`mt-1 ${inputCls}`} value={values.tipo} onChange={set("tipo")}>
                {data.tipos_ocorrencia.map((tipo) => <option key={tipo}>{tipo}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Horas por dia</span>
              <input type="number" min="0.5" max="24" step="0.5" required className={`mt-1 ${inputCls}`} value={values.horas_dia} onChange={set("horas_dia")} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Início</span>
              <input type="date" required className={`mt-1 ${inputCls}`} value={values.data_inicio}
                onChange={(event) => setValues((previous) => ({ ...previous, data_inicio: event.target.value, data_fim: previous.data_fim < event.target.value ? event.target.value : previous.data_fim }))} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Fim</span>
              <input type="date" required min={values.data_inicio} className={`mt-1 ${inputCls}`} value={values.data_fim} onChange={set("data_fim")} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Observação (opcional)</span>
            <input className={`mt-1 ${inputCls}`} maxLength={500} value={values.observacao} onChange={set("observacao")} />
          </label>
          {values.tipo === "Atestado" && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Dado sensível (LGPD): além de você, só o perfil CCM vê que é um atestado. Não informe diagnóstico.
          </p>}
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <Btn type="submit" className="w-full" disabled={saving || !data.colaboradores.length}><Send className="h-4 w-4" /> {saving ? "Enviando…" : "Enviar ocorrência"}</Btn>
        </form>
      </Card>

      <Card className="lg:col-span-3">
        <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">Ocorrências que você enviou</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-semibold">Colaborador</th>
                <th className="px-5 py-3 font-semibold">Tipo</th>
                <th className="px-5 py-3 font-semibold">Período</th>
                <th className="px-5 py-3 text-right font-semibold">h/dia</th>
                <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {data.ocorrencias.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-slate-700">{row.colaborador}</div>
                    {row.observacao && <div className="text-xs text-slate-400">{row.observacao}</div>}
                  </td>
                  <td className="px-5 py-3"><Badge tone={OCCURRENCE_TONES[row.tipo]}>{row.tipo}</Badge></td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{dateBr(row.data_inicio)}{row.data_fim !== row.data_inicio ? ` a ${dateBr(row.data_fim)}` : ""}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{String(row.horas_dia).replace(".", ",")}</td>
                  <td className="px-5 py-2 text-right">
                    <button type="button" title="Excluir ocorrência" aria-label={`Excluir ocorrência de ${row.colaborador}`} onClick={() => remove(row)}
                      className="rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
              {!data.ocorrencias.length && <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">Você ainda não enviou ocorrências.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
