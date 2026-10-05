import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Card, Eyebrow, inputCls, Spinner, ErrorState } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import { useAuth } from "../auth.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

const OCCURRENCE_TONES = { Folga: "slate", Férias: "indigo", Falta: "rose", Atestado: "amber", Ausência: "slate" };

const hours = (value, digits = 1) => value == null ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
const dateBr = (iso) => iso ? iso.split("-").reverse().join("/") : "—";
// O servidor grava data e hora em UTC ("AAAA-MM-DD HH:MM:SS").
const dateTimeBr = (value) => new Date(`${value.replace(" ", "T")}Z`).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const shiftWeek = (iso, days) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function Iamot({ value }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="w-14 text-right font-semibold tabular-nums text-slate-900">{hours(value)}%</span>
    </div>
  );
}

export default function MaoDeObra() {
  const toast = useToast();
  const { user } = useAuth();
  const [semana, setSemana] = useState("");
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [savingTeam, setSavingTeam] = useState(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const isCcm = user.papel === "CCM";

  useEffect(() => {
    let active = true;
    api.maoDeObra(semana)
      .then((result) => {
        if (!active) return;
        setData(result);
        setDrafts(Object.fromEntries(result.equipes.map((team) => [team.equipe_id, team.hh_disponivel == null ? "" : String(team.hh_disponivel)])));
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [semana, revision]);

  if (!data) return error ? <ErrorState message={error} /> : <Spinner />;

  const inicio = data.semana.inicio;
  const refresh = () => setRevision((value) => value + 1);
  const run = async (action, message) => {
    setError("");
    try { await action(); refresh(); toast.success(message); } catch (e) { setError(e.message); }
  };
  const saveTeam = async (team) => {
    setSavingTeam(team.equipe_id);
    await run(() => api.lancarHhDisponivel({ equipe_id: team.equipe_id, semana: inicio, hh_disponivel: drafts[team.equipe_id] }), `HH disponível da equipe ${team.equipe} salvo.`);
    setSavingTeam(null);
  };
  const changed = (team) => (drafts[team.equipe_id] ?? "") !== (team.hh_disponivel == null ? "" : String(team.hh_disponivel));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <Eyebrow>IAMOT por equipe</Eyebrow>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            HH apropriado ÷ HH disponível líquido (disponível menos folgas, férias, faltas e atestados em dias úteis).
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Btn variant="ghost" onClick={() => setSemana(shiftWeek(inicio, -7))}><ChevronLeft className="h-4 w-4" /><span className="sr-only">Semana anterior</span></Btn>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Semana de {dateBr(inicio)} a {dateBr(data.semana.fim)}</span>
            <input type="date" className={`mt-1 ${inputCls} bg-white`} value={inicio} onChange={(event) => event.target.value && setSemana(event.target.value)} />
          </label>
          <Btn variant="ghost" onClick={() => setSemana(shiftWeek(inicio, 7))}><ChevronRight className="h-4 w-4" /><span className="sr-only">Próxima semana</span></Btn>
        </div>
      </header>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">
          <ThemeIcon name="worker" className="h-5 w-5" /> HH disponível e apropriação da semana
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 text-left font-semibold">Equipe</th>
                <th className="px-5 py-3 text-left font-semibold">HH disponível</th>
                <th className="px-5 py-3 text-right font-semibold">Ocorrências</th>
                <th className="px-5 py-3 text-right font-semibold">HH líquido</th>
                <th className="px-5 py-3 text-right font-semibold">HH apropriado</th>
                <th className="px-5 py-3 text-right font-semibold">IAMOT</th>
              </tr>
            </thead>
            <tbody>
              {data.equipes.map((team) => (
                <tr key={team.equipe_id} className="border-b border-slate-50">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-slate-800">{team.equipe}</div>
                    <div className="text-xs text-slate-400">{team.tipo} · {team.colaboradores} usuário(s)</div>
                  </td>
                  <td className="px-5 py-2">
                    <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); saveTeam(team); }}>
                      <input type="number" min="0" step="0.5" aria-label={`HH disponível da equipe ${team.equipe}`}
                        className={`${inputCls} w-28 tabular-nums`} placeholder={team.colaboradores ? String(team.colaboradores * (data.hh_semana_pessoa ?? 40)) : "0"}
                        value={drafts[team.equipe_id] ?? ""} onChange={(event) => setDrafts((previous) => ({ ...previous, [team.equipe_id]: event.target.value }))} />
                      <Btn type="submit" size="sm" variant={changed(team) ? "primary" : "ghost"} disabled={!changed(team) || savingTeam === team.equipe_id}>
                        {savingTeam === team.equipe_id ? "Salvando…" : "Salvar"}
                      </Btn>
                    </form>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{team.hh_ocorrencias ? `− ${hours(team.hh_ocorrencias)} h` : "—"}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{team.hh_liquido == null ? "—" : `${hours(team.hh_liquido)} h`}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{hours(team.hh_apropriado, 2)} h</td>
                  <td className="px-5 py-3"><Iamot value={team.iamot} /></td>
                </tr>
              ))}
              {!data.equipes.length && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">Nenhuma equipe cadastrada.</td></tr>}
            </tbody>
            {data.total.hh_disponivel != null && <tfoot>
              <tr className="bg-slate-50 font-semibold text-slate-800">
                <td className="px-5 py-3">Total das equipes com HH lançado</td>
                <td className="px-5 py-3 tabular-nums">{hours(data.total.hh_disponivel)} h</td>
                <td className="px-5 py-3 text-right tabular-nums">{data.total.hh_ocorrencias ? `− ${hours(data.total.hh_ocorrencias)} h` : "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums">{hours(data.total.hh_liquido)} h</td>
                <td className="px-5 py-3 text-right tabular-nums">{hours(data.total.hh_apropriado, 2)} h</td>
                <td className="px-5 py-3"><Iamot value={data.total.iamot} /></td>
              </tr>
            </tfoot>}
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
          Sem HH disponível lançado, a equipe fica sem IAMOT e fora do indicador da Visão geral. Deixe o campo vazio e salve para remover o lançamento.
        </p>
      </Card>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <Card>
          <div className="border-b border-slate-100 px-5 py-3">
            <div className="font-semibold text-slate-800">Ocorrências na semana</div>
            <p className="mt-0.5 text-xs text-slate-500">Enviadas pelos executantes em campo; aqui é somente acompanhamento.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-semibold">Colaborador</th>
                  <th className="px-5 py-3 font-semibold">Tipo</th>
                  <th className="px-5 py-3 font-semibold">Período</th>
                  <th className="px-5 py-3 text-right font-semibold">h/dia</th>
                  <th className="px-5 py-3 font-semibold">Enviado por</th>
                  {isCcm && <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.ocorrencias.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-700">{row.colaborador}</div>
                      <div className="text-xs text-slate-400">{row.equipe || "Sem equipe"}{row.observacao ? ` · ${row.observacao}` : ""}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={OCCURRENCE_TONES[row.tipo]}>{row.tipo}</Badge>
                        {(row.restrito || row.tipo === "Atestado") && <Lock className="h-3.5 w-3.5 text-slate-400" aria-label="Dado sensível restrito ao perfil CCM" />}
                      </span>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">{dateBr(row.data_inicio)}{row.data_fim !== row.data_inicio ? ` a ${dateBr(row.data_fim)}` : ""}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{hours(row.horas_dia)}</td>
                    <td className="px-5 py-3 text-slate-600">{row.enviado_por || "—"}</td>
                    {isCcm && <td className="px-5 py-2 text-right">
                      <button type="button" title="Excluir ocorrência" aria-label={`Excluir ocorrência de ${row.colaborador}`}
                        onClick={() => window.confirm(`Excluir a ocorrência de ${row.colaborador}?`) && run(() => api.excluirOcorrencia(row.id), "Ocorrência excluída.")}
                        className="rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                    </td>}
                  </tr>
                ))}
                {!data.ocorrencias.length && <tr><td colSpan={isCcm ? 6 : 5} className="px-5 py-12 text-center text-sm text-slate-400">Nenhuma ocorrência nesta semana.</td></tr>}
              </tbody>
            </table>
          </div>
          {!isCcm && <p className="flex items-center gap-1.5 border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
            <Lock className="h-3.5 w-3.5 shrink-0" /> Atestados aparecem como "Ausência": o motivo é dado sensível (LGPD) e fica restrito ao perfil CCM.
          </p>}
        </Card>

        <Card>
          <div className="border-b border-slate-100 px-5 py-3">
            <div className="font-semibold text-slate-800">Intercorrências nas OMs</div>
            <p className="mt-0.5 text-xs text-slate-500">Desvios e alterações de rota ou de serviço registrados durante a execução.</p>
          </div>
          <ul className="divide-y divide-slate-50">
            {data.intercorrencias.map((item) => (
              <li key={item.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone="amber">{item.tipo}</Badge>
                    <span className="font-mono font-semibold text-slate-800">OM {item.ordem_numero}</span>
                    {item.equipamento && <span className="font-mono text-xs text-slate-500">{item.equipamento}</span>}
                  </span>
                  <span className="text-xs text-slate-400">{dateTimeBr(item.registrado_em)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-slate-700">{item.descricao}</p>
                <div className="mt-1 text-xs text-slate-400">{item.enviado_por || "—"}{item.equipe ? ` · ${item.equipe}` : ""}</div>
              </li>
            ))}
            {!data.intercorrencias.length && <li className="px-5 py-12 text-center text-sm text-slate-400">Nenhuma intercorrência nesta semana.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
