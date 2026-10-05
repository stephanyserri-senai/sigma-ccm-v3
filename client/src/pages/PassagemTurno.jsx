import React, { useEffect, useState } from "react";
import { CheckCircle2, Eye, Send } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Card, Spinner, dataBr, inputCls } from "../components/ui.jsx";
import { useAuth } from "../auth.jsx";

const TURNOS = ["Manhã", "Tarde", "Noite"];
const SECTIONS = [
  ["ocorrencias", "Ocorrências", "Fatos relevantes, falhas, incidentes."],
  ["feito", "O que foi feito", "Serviços executados e concluídos no turno."],
  ["pendencias", "Pendências", "O que ficou em aberto e precisa de continuidade."],
  ["avisos", "Avisos ao próximo turno", "Cuidados, bloqueios, riscos e combinados."],
];
const toIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const currentShift = () => { const hour = new Date().getHours(); return hour >= 6 && hour < 14 ? "Manhã" : hour >= 14 && hour < 22 ? "Tarde" : "Noite"; };
// O servidor grava data e hora em UTC ("AAAA-MM-DD HH:MM:SS").
const dateTimeBr = (value) => new Date(`${value.replace(" ", "T")}Z`).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function PassagemTurno() {
  const { user } = useAuth();
  const [filtro, setFiltro] = useState("pendentes");
  const [rows, setRows] = useState(null);
  const [equipes, setEquipes] = useState([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.passagensTurno(filtro).then((result) => { if (active) setRows(result); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [filtro, revision]);
  useEffect(() => { api.cadastros().then((catalogs) => setEquipes(catalogs.equipes)).catch(() => setEquipes([])); }, []);

  const refresh = () => setRevision((value) => value + 1);
  const confirm = async (row) => {
    setError("");
    try { await api.confirmarLeituraPassagem(row.id); refresh(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-5">
      <NovaPassagem user={user} equipes={equipes} onSaved={() => { setFiltro("todas"); refresh(); }} />

      <div className="space-y-4 xl:col-span-3">
        <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="Filtro das passagens">
          {[["pendentes", "Aguardando minha leitura"], ["todas", "Todas"]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filtro === id} onClick={() => setFiltro(id)}
              className={`border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${filtro === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {label}
            </button>
          ))}
        </div>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {!rows ? <Spinner /> : rows.length === 0 ? (
          <Card className="px-5 py-12 text-center text-sm text-slate-400">{filtro === "pendentes" ? "Nenhuma passagem de turno aguardando sua leitura." : "Nenhuma passagem de turno registrada."}</Card>
        ) : rows.map((row) => (
          <Card key={row.id} className={`p-5 ${!row.sou_autor && !row.lido_por_mim ? "border-indigo-300" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{dataBr(row.data)} · Turno {row.turno.toLowerCase()}</span>
                  {row.equipe && <Badge tone="indigo">{row.equipe}</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">Registrado por {row.autor} em {dateTimeBr(row.criado_em)}</div>
              </div>
              {row.sou_autor ? <Badge>Seu registro</Badge>
                : row.lido_por_mim ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Leitura confirmada</span>
                : <Btn size="sm" onClick={() => confirm(row)}><Eye className="h-3.5 w-3.5" /> Confirmar leitura</Btn>}
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SECTIONS.map(([key, label]) => (
                <div key={key} className={key === "avisos" && row.avisos ? "rounded-lg bg-amber-50 p-3 sm:col-span-2" : ""}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{row[key] || "—"}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              {row.leituras.length
                ? <>Lido por: {row.leituras.map((reader) => `${reader.nome} (${dateTimeBr(reader.lido_em)})`).join(", ")}</>
                : "Nenhuma confirmação de leitura ainda."}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NovaPassagem({ user, equipes, onSaved }) {
  const empty = () => ({ data: toIso(new Date()), turno: currentShift(), equipe_id: user.equipe_id ? String(user.equipe_id) : "", ocorrencias: "", feito: "", pendencias: "", avisos: "" });
  const [values, setValues] = useState(empty);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setValues((previous) => ({ ...previous, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      await api.registrarPassagem(values);
      setValues(empty());
      setNotice("Passagem de turno registrada. O próximo turno confirma a leitura.");
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 xl:col-span-2">
      <h2 className="font-semibold text-slate-800">Registrar passagem de turno</h2>
      <p className="mt-0.5 text-xs text-slate-500">Depois de enviado, o registro não é alterado; cada pessoa do próximo turno confirma a leitura.</p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Data</span>
            <input type="date" required className={`mt-1 ${inputCls}`} value={values.data} onChange={set("data")} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Turno</span>
            <select className={`mt-1 ${inputCls}`} value={values.turno} onChange={set("turno")}>
              {TURNOS.map((turno) => <option key={turno}>{turno}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Equipe</span>
            <select className={`mt-1 ${inputCls}`} value={values.equipe_id} onChange={set("equipe_id")}>
              <option value="">Geral</option>
              {equipes.map((team) => <option key={team.id} value={team.id}>{team.nome}</option>)}
            </select>
          </label>
        </div>
        {SECTIONS.map(([key, label, hint]) => (
          <label key={key} className="block">
            <span className="text-xs font-semibold text-slate-500">{label}{key === "feito" ? " *" : ""}</span>
            <textarea rows={3} maxLength={4000} required={key === "feito"} className={`mt-1 resize-y ${inputCls}`} placeholder={hint} value={values[key]} onChange={set(key)} />
          </label>
        ))}
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
        <Btn type="submit" className="w-full" disabled={saving || !values.feito.trim()}><Send className="h-4 w-4" /> {saving ? "Registrando…" : "Registrar passagem de turno"}</Btn>
      </form>
    </Card>
  );
}
