import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Card, Eyebrow, Spinner, dataBr, isIsoDate, statusTone, ErrorState } from "../components/ui.jsx";
import { useAuth } from "../auth.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const DONE = new Set(["Encerrada", "Cancelada"]);

const toIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (iso, days) => {
  const [year, month, day] = iso.split("-").map(Number);
  return toIso(new Date(year, month - 1, day + days));
};
const mondayOf = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return addDays(iso, -((new Date(year, month - 1, day).getDay() + 6) % 7));
};
const hours = (value) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
// Uma OM ocupa do dia programado até o término previsto (ou só o dia programado).
const endOf = (order) => isIsoDate(order.data_fim_programada) && order.data_fim_programada >= order.data_programada ? order.data_fim_programada : order.data_programada;

export default function MeuPlano() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = toIso(new Date());
  const [ordens, setOrdens] = useState(null);
  const [semana, setSemana] = useState(() => mondayOf(today));
  const [erro, setErro] = useState("");

  useEffect(() => { api.ordens().then(setOrdens).catch((e) => setErro(e.message)); }, []);

  if (erro) return <ErrorState message={erro} />;
  if (!ordens) return <Spinner />;

  const abrir = (order) => navigate(`/apropriacao?om=${order.id}`);
  const datadas = ordens.filter((order) => isIsoDate(order.data_programada));
  const fimSemana = addDays(semana, 6);
  const daSemana = datadas.filter((order) => order.data_programada <= fimSemana && endOf(order) >= semana);
  const dias = WEEKDAYS.map((nome, index) => {
    const data = addDays(semana, index);
    return { nome, data, ordens: daSemana.filter((order) => order.data_programada <= data && endOf(order) >= data) };
  });
  const pendentes = daSemana.filter((order) => !DONE.has(order.status));
  const atrasadas = datadas.filter((order) => !DONE.has(order.status) && endOf(order) < today);
  const ordenadas = [...ordens].sort((left, right) => {
    const a = isIsoDate(left.data_programada) ? left.data_programada : "9999";
    const b = isIsoDate(right.data_programada) ? right.data_programada : "9999";
    return a === b ? right.id - left.id : a < b ? -1 : 1;
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <Eyebrow>Plano individual</Eyebrow>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{user.nome}{user.equipe ? <span className="font-normal text-slate-500"> · {user.equipe}</span> : null}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Semana de {dataBr(semana)} a {dataBr(fimSemana)}: {daSemana.length} OM(s), {pendentes.length} pendente(s), {hours(pendentes.reduce((sum, order) => sum + (order.hh_previsto || 0), 0))} HH previstos a executar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setSemana(addDays(semana, -7))}><ChevronLeft className="h-4 w-4" /><span className="sr-only">Semana anterior</span></Btn>
          <Btn variant="ghost" onClick={() => setSemana(mondayOf(today))} disabled={semana === mondayOf(today)}>Esta semana</Btn>
          <Btn variant="ghost" onClick={() => setSemana(addDays(semana, 7))}><ChevronRight className="h-4 w-4" /><span className="sr-only">Próxima semana</span></Btn>
        </div>
      </header>

      {atrasadas.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {atrasadas.length} OM(s) com data vencida e ainda não encerrada(s): {atrasadas.map((order) => order.numero).join(", ")}.
      </div>}

      <section aria-label="Plano semanal" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {dias.map((dia) => (
          <Card key={dia.data} className={`flex min-h-36 flex-col p-3 ${dia.data === today ? "border-indigo-400 ring-1 ring-indigo-200" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-sm font-semibold ${dia.data === today ? "text-indigo-700" : "text-slate-800"}`}>{dia.nome}</span>
              <span className="text-xs tabular-nums text-slate-400">{dataBr(dia.data).slice(0, 5)}{dia.data === today ? " · hoje" : ""}</span>
            </div>
            <div className="mt-2 flex-1 space-y-2">
              {dia.ordens.map((order) => (
                <button key={order.id} type="button" onClick={() => abrir(order)}
                  className={`block w-full rounded-lg border border-slate-200 px-2.5 py-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 ${DONE.has(order.status) ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-800">{order.numero}</span>
                    <span className="text-[11px] tabular-nums text-slate-500">{hours(order.hh_previsto)} HH</span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{order.equipamento || "Sem equipamento"}</div>
                  <div className="mt-1.5"><Badge tone={statusTone(order.status)}>{order.status}</Badge></div>
                </button>
              ))}
              {!dia.ordens.length && <p className="pt-3 text-center text-xs text-slate-400">Sem OMs</p>}
            </div>
          </Card>
        ))}
      </section>

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">
          <ThemeIcon name="wrench" className="h-5 w-5" /> Minhas OMs ({ordens.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-semibold">OM</th>
                <th className="px-5 py-3 font-semibold">Tipo</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Programada</th>
                <th className="px-5 py-3 font-semibold">Término previsto</th>
                <th className="px-5 py-3 font-semibold">Plano de manutenção</th>
                <th className="px-5 py-3 text-right font-semibold">HH previsto</th>
                <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((order) => (
                <tr key={order.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-mono font-semibold text-slate-800">{order.numero}</div>
                    <div className="font-mono text-xs text-slate-500">{order.equipamento || "Sem equipamento"}</div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{order.tipo}</td>
                  <td className="px-5 py-3"><Badge tone={statusTone(order.status)}>{order.status}</Badge></td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{dataBr(order.data_programada) || "Sem data"}</td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{dataBr(order.data_fim_programada) || "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{order.plano_descricao || "—"}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{hours(order.hh_previsto)} h</td>
                  <td className="px-5 py-2 text-right">
                    <Btn size="sm" variant="ghost" onClick={() => abrir(order)}>{DONE.has(order.status) ? "Consultar" : "Executar"} <ArrowRight className="h-3.5 w-3.5" /></Btn>
                  </td>
                </tr>
              ))}
              {!ordens.length && <tr><td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-400">Nenhuma OM foi atribuída à sua conta. Peça ao PCM ou CCM para distribuir uma OM.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
