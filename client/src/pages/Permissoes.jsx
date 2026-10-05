import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Badge, Btn, Card, Modal, Spinner, inputCls } from "../components/ui.jsx";
import { useNoticeToast } from "../components/toast.jsx";
import { FillForm, ResponseView, dateTimeBr } from "../components/FormRenderer.jsx";

const STATUS_TONE = { Solicitada: "amber", Aprovada: "emerald", Reprovada: "rose", Cancelada: "slate", Encerrada: "indigo" };
const pad = (value) => String(value).padStart(2, "0");
const localDateTime = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const validityBr = (value) => (value ? value.replace("T", " ").replace(/^(\d{4})-(\d{2})-(\d{2})/, "$3/$2/$1") : "—");

export default function Permissoes() {
  const { user } = useAuth();
  const manager = user.papel !== "EXECUTANTE";
  const [params] = useSearchParams();
  const presetOrder = params.get("om") || "";
  const [tab, setTab] = useState(presetOrder ? "solicitar" : manager ? "aguardando" : "todas");
  const [rows, setRows] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [revision, setRevision] = useState(0);
  const setNotice = useNoticeToast();
  const [error, setError] = useState("");

  useEffect(() => {
    if (tab === "solicitar") return undefined;
    let active = true;
    setRows(null);
    api.permissoes(tab === "aguardando" ? { status: "Solicitada" } : {}).then((result) => { if (active) setRows(result); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [tab, revision]);

  const tabs = [...(manager ? [["aguardando", "Aguardando aprovação"]] : []), ["todas", manager ? "Todas" : "Minhas PTs"], ["solicitar", "Solicitar PT"]];
  return (
    <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Permissões de trabalho">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setNotice(""); }}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{label}</button>
        ))}
      </div>
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {tab === "solicitar"
        ? <Solicitar presetOrder={presetOrder} onDone={(result) => {
          setNotice(`${result.numero} solicitada${result.nao_conformidades.length ? ` com ${result.nao_conformidades.length} alerta(s) de risco` : ""}. Aguarde a aprovação do PCM/CCM.`);
          setTab(manager ? "aguardando" : "todas");
        }} />
        : <Card>
          {!rows ? <Spinner /> : <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-semibold">PT</th>
                  <th className="px-5 py-3 font-semibold">OM</th>
                  <th className="px-5 py-3 font-semibold">Validade</th>
                  <th className="px-5 py-3 font-semibold">Solicitante</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3"><div className="font-mono font-semibold text-slate-800">{row.numero}</div>
                      {row.nao_conformidades.length > 0 && <div className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" /> {row.nao_conformidades.length} alerta(s) de risco</div>}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{row.ordem_numero}{row.equipamento ? ` · ${row.equipamento}` : ""}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-600">{validityBr(row.validade_inicio)} até {validityBr(row.validade_fim)}</td>
                    <td className="px-5 py-3 text-slate-600">{row.solicitante}</td>
                    <td className="px-5 py-3"><Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>{row.vigente && <span className="ml-1 text-xs font-semibold text-emerald-700">vigente</span>}</td>
                    <td className="px-5 py-2 text-right"><Btn size="sm" variant={row.status === "Solicitada" && manager ? "primary" : "ghost"} onClick={() => setViewing(row.id)}>{row.status === "Solicitada" && manager ? "Analisar" : "Ver"}</Btn></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">{tab === "aguardando" ? "Nenhuma PT aguardando aprovação." : "Nenhuma permissão de trabalho."}</td></tr>}
              </tbody>
            </table>
          </div>}
        </Card>}

      {viewing && <Detalhe id={viewing} onClose={() => setViewing(null)} onChanged={(message) => { setNotice(message); setRevision((value) => value + 1); setViewing(null); }} />}
    </div>
  );
}

function Solicitar({ presetOrder, onDone }) {
  const [orders, setOrders] = useState(null);
  const [models, setModels] = useState([]);
  const now = new Date();
  const [choice, setChoice] = useState({ ordem_id: presetOrder, modelo_id: "", validade_inicio: localDateTime(now), validade_fim: localDateTime(new Date(now.getTime() + 8 * 3600000)) });
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.ordens(), api.formularioModelos()]).then(([orderList, modelList]) => {
      setOrders(orderList.filter((order) => order.status !== "Encerrada" && order.status !== "Cancelada"));
      const permits = modelList.filter((model) => model.tipo === "Permissão");
      setModels(permits);
      setChoice((previous) => ({ ...previous, modelo_id: previous.modelo_id || (permits[0] ? String(permits[0].id) : "") }));
    }).catch((e) => setError(e.message));
  }, []);

  if (!orders) return error ? <div role="alert" className="text-sm text-rose-700">{error}</div> : <Spinner />;
  const set = (key) => (event) => setChoice((previous) => ({ ...previous, [key]: event.target.value }));
  const ready = choice.ordem_id && choice.modelo_id;

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-5">
      <Card className="space-y-4 p-5 xl:col-span-2">
        <div className="flex items-center gap-2 font-semibold text-slate-800"><ShieldCheck className="h-5 w-5 text-indigo-600" /> Nova permissão de trabalho</div>
        <p className="text-sm text-slate-500">Preencha a APR. A PT passa por aprovação do PCM/CCM e, depois de solicitada, a OM só inicia com PT aprovada e dentro da validade.</p>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Ordem de manutenção</span>
          <select className={`mt-1 ${inputCls}`} value={choice.ordem_id} onChange={set("ordem_id")}>
            <option value="">Selecione a OM</option>
            {orders.map((order) => <option key={order.id} value={order.id}>{order.numero} · {order.equipamento || "sem equipamento"} · {order.status}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Formulário de permissão (APR/PT)</span>
          <select className={`mt-1 ${inputCls}`} value={choice.modelo_id} onChange={set("modelo_id")}>
            <option value="">Selecione</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.nome}</option>)}
          </select>
        </label>
        {!models.length && <p className="text-xs text-amber-700">Nenhum formulário do tipo Permissão ativo. O CCM cria em Formulários › Modelos.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="text-xs font-semibold text-slate-500">Válida de</span><input type="datetime-local" className={`mt-1 ${inputCls}`} value={choice.validade_inicio} onChange={set("validade_inicio")} /></label>
          <label className="block"><span className="text-xs font-semibold text-slate-500">Até (máx. 24 h)</span><input type="datetime-local" min={choice.validade_inicio} className={`mt-1 ${inputCls}`} value={choice.validade_fim} onChange={set("validade_fim")} /></label>
        </div>
      </Card>
      <Card className="p-5 xl:col-span-3">
        {ready
          ? <FillForm key={`${choice.ordem_id}-${choice.modelo_id}`} modeloId={Number(choice.modelo_id)}
            submit={(dados, files) => api.solicitarPermissao({ ...dados, ordem_id: Number(choice.ordem_id), validade_inicio: choice.validade_inicio, validade_fim: choice.validade_fim }, files)}
            submitLabel="Solicitar permissão" onDone={onDone} />
          : <p className="py-12 text-center text-sm text-slate-400">Escolha a OM e o formulário para preencher a APR.</p>}
      </Card>
    </div>
  );
}

function Detalhe({ id, onClose, onChanged }) {
  const { user } = useAuth();
  const manager = user.papel !== "EXECUTANTE";
  const [permit, setPermit] = useState(null);
  const [parecer, setParecer] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.permissao(id).then(setPermit).catch((e) => setError(e.message)); }, [id]);

  const act = async (action, label) => {
    setSaving(true);
    setError("");
    try { await action(); onChanged(`${permit.numero} ${label}.`); } catch (e) { setError(e.message); setSaving(false); }
  };
  if (!permit) return <Modal title="Permissão de trabalho" onClose={onClose}>{error ? <div className="text-sm text-rose-700">{error}</div> : <Spinner />}</Modal>;
  const own = permit.solicitante_id === user.id;
  const canDecide = manager && !own && permit.status === "Solicitada";

  return (
    <Modal title={`${permit.numero} · OM ${permit.ordem_numero}`} subtitle={`${permit.equipamento || "Sem equipamento"} · válida de ${validityBr(permit.validade_inicio)} até ${validityBr(permit.validade_fim)}`} onClose={onClose} className="max-w-3xl">
      <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[permit.status]}>{permit.status}</Badge>
          {permit.vigente && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Vigente agora</span>}
        </div>
        <ol className="space-y-1 border-l-2 border-slate-200 pl-3 text-sm text-slate-600">
          <li>Solicitada por <b>{permit.solicitante}</b> em {dateTimeBr(permit.solicitada_em)}</li>
          {permit.decidida_em && <li>{permit.status === "Reprovada" ? "Reprovada" : "Aprovada"} por <b>{permit.aprovador}</b> em {dateTimeBr(permit.decidida_em)}{permit.parecer ? ` — "${permit.parecer}"` : ""}</li>}
          {permit.status === "Cancelada" && <li>Cancelada{permit.parecer ? ` — "${permit.parecer}"` : ""}</li>}
          {permit.encerrada_em && <li>Encerrada por <b>{permit.encerrada_por_nome}</b> em {dateTimeBr(permit.encerrada_em)}{permit.observacao_encerramento ? ` — "${permit.observacao_encerramento}"` : ""}</li>}
        </ol>
        {permit.nao_conformidades.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> Alertas de risco na APR</div>
          <ul className="mt-1 list-disc pl-5">{permit.nao_conformidades.map((item) => <li key={item.campo}>{item.rotulo}: {String(item.valor)} ({item.motivo})</li>)}</ul>
        </div>}
        <div className="rounded-xl border border-slate-200 p-4"><ResponseView id={permit.resposta_id} /></div>

        {(canDecide || (permit.status === "Solicitada" && (own || manager)) || (permit.status === "Aprovada" && (own || manager))) && <div className="space-y-3 border-t border-slate-100 pt-4">
          <label className="block"><span className="text-xs font-semibold text-slate-500">{permit.status === "Aprovada" ? "Observação de encerramento" : "Parecer (obrigatório para reprovar)"}</span>
            <textarea rows={2} maxLength={1000} className={`mt-1 resize-y ${inputCls}`} value={parecer} onChange={(event) => setParecer(event.target.value)} />
          </label>
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          {manager && own && permit.status === "Solicitada" && <p className="text-xs text-slate-500">Você solicitou esta PT: a aprovação cabe a outro PCM/CCM.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {permit.status === "Solicitada" && (own || manager) && <Btn variant="ghost" disabled={saving} onClick={() => act(() => api.acaoPermissao(permit.id, "cancelar", parecer), "cancelada")}>Cancelar PT</Btn>}
            {canDecide && <Btn variant="danger" disabled={saving || !parecer.trim()} onClick={() => act(() => api.acaoPermissao(permit.id, "reprovar", parecer), "reprovada")}><XCircle className="h-4 w-4" /> Reprovar</Btn>}
            {canDecide && <Btn disabled={saving} onClick={() => act(() => api.acaoPermissao(permit.id, "aprovar", parecer), "aprovada")}><CheckCircle2 className="h-4 w-4" /> Aprovar</Btn>}
            {permit.status === "Aprovada" && (own || manager) && <Btn disabled={saving} onClick={() => act(() => api.acaoPermissao(permit.id, "encerrar", parecer), "encerrada")}>Encerrar PT (trabalho concluído)</Btn>}
          </div>
        </div>}
      </div>
    </Modal>
  );
}
