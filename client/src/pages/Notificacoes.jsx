import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertOctagon, AlertTriangle, ArrowRight, Bell, CheckCheck, Forward, Info, MessageSquare } from "lucide-react";
import { api } from "../api.js";
import { useAuth, PERMS } from "../auth.jsx";
import { Badge, Btn, Card, Modal, Spinner, inputCls } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import { dateTimeBr } from "../components/FormRenderer.jsx";

const SEVERITIES = ["Crítica", "Alta", "Média", "Baixa"];
export const SEVERITY_STYLE = {
  "Crítica": { tone: "rose", Icon: AlertOctagon, icon: "text-rose-600", border: "border-l-rose-500" },
  Alta: { tone: "amber", Icon: AlertTriangle, icon: "text-amber-600", border: "border-l-amber-500" },
  "Média": { tone: "indigo", Icon: Info, icon: "text-indigo-600", border: "border-l-indigo-400" },
  Baixa: { tone: "slate", Icon: Bell, icon: "text-slate-500", border: "border-l-slate-300" },
};
const STATUS_TONE = { Aberta: "amber", "Em tratamento": "indigo", Resolvida: "emerald" };

export default function Notificacoes() {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const allowed = PERMS[user.papel] || [];
  const [severidade, setSeveridade] = useState("");
  const [status, setStatus] = useState("abertas");
  const [naoLidas, setNaoLidas] = useState(false);
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const filtros = { status, ...(severidade ? { severidade } : {}), ...(naoLidas ? { nao_lidas: "1" } : {}) };
    api.notificacoes(filtros).then((result) => { if (active) setData(result); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [severidade, status, naoLidas, revision]);

  const refresh = () => { setRevision((value) => value + 1); window.dispatchEvent(new Event("notificacoes:atualizar")); };
  const run = async (action, message) => { setError(""); try { await action(); refresh(); toast.success(message); } catch (e) { setError(e.message); } };
  const open = (item) => {
    if (!item.lida) api.marcarNotificacaoLida(item.id).then(refresh).catch(() => {});
    const page = item.link?.slice(1);
    if (page && allowed.includes(page)) navigate(item.link);
  };
  const total = data ? Object.values(data.contagem).reduce((sum, value) => sum + value, 0) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Severidade">
          {[["", "Todas", total], ...SEVERITIES.map((item) => [item, item, data?.contagem[item] ?? 0])].map(([id, label, count]) => (
            <button key={label} type="button" role="tab" aria-selected={severidade === id} onClick={() => setSeveridade(id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${severidade === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {id && React.createElement(SEVERITY_STYLE[id].Icon, { className: `h-4 w-4 ${SEVERITY_STYLE[id].icon}`, "aria-hidden": true })}
              {label} <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-500">{count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Situação" className={`${inputCls} w-auto`} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="abertas">Abertas e em tratamento</option>
            <option value="resolvidas">Resolvidas</option>
            <option value="todas">Todas</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={naoLidas} onChange={(event) => setNaoLidas(event.target.checked)} /> Só não lidas</label>
          <Btn variant="ghost" onClick={() => run(() => api.marcarTodasNotificacoesLidas(), "Notificações marcadas como lidas.")}><CheckCheck className="h-4 w-4" /> Marcar todas como lidas</Btn>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <p className="text-xs text-slate-400">Geradas automaticamente: OM atrasada, preventiva vencida ou a vencer, permissão de trabalho pendente e inconsistência de dados. Quando a condição deixa de existir, a notificação é resolvida sozinha.</p>

      {!data ? <Spinner /> : data.itens.length === 0
        ? <Card className="px-5 py-12 text-center text-sm text-slate-400">Nenhuma notificação nesta seleção.</Card>
        : <ul className="space-y-3">
          {data.itens.map((item) => {
            const style = SEVERITY_STYLE[item.severidade];
            return (
              <li key={item.id}>
                <Card className={`border-l-4 p-4 ${style.border} ${item.lida ? "" : "bg-indigo-50/30"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <style.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.icon}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm ${item.lida ? "font-semibold text-slate-700" : "font-bold text-slate-900"}`}>{item.titulo}</span>
                          {!item.lida && <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">nova</span>}
                        </div>
                        <p className="mt-0.5 text-sm text-slate-600">{item.mensagem}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <Badge tone={style.tone}>{item.severidade}</Badge>
                          <span>{item.tipo}</span>
                          <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                          <span>· {dateTimeBr(item.atualizada_em || item.criada_em)}</span>
                          {item.acoes > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" /> {item.acoes} ação(ões)</span>}
                        </div>
                        {item.status === "Resolvida" && item.resolucao && <p className="mt-1 text-xs text-emerald-700">{item.resolvida_por ? `${item.resolvida_por}: ` : ""}{item.resolucao}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.link && allowed.includes(item.link.slice(1)) && <Btn size="sm" variant="ghost" onClick={() => open(item)}>Abrir <ArrowRight className="h-3.5 w-3.5" /></Btn>}
                      {!item.lida && <Btn size="sm" variant="ghost" onClick={() => run(() => api.marcarNotificacaoLida(item.id), "Notificação marcada como lida.")}>Marcar como lida</Btn>}
                      <Btn size="sm" onClick={() => setDetail(item.id)}>Responder / encaminhar</Btn>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>}

      {detail && <Detalhe id={detail} onClose={() => setDetail(null)} onChanged={refresh} />}
    </div>
  );
}

function Detalhe({ id, onClose, onChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const manager = user.papel !== "EXECUTANTE";
  const [item, setItem] = useState(null);
  const [users, setUsers] = useState([]);
  const [texto, setTexto] = useState("");
  const [resolver, setResolver] = useState(false);
  const [destino, setDestino] = useState("");
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => api.notificacao(id).then(setItem).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api.marcarNotificacaoLida(id).then(onChanged).catch(() => {});
    api.destinatariosNotificacao().then(setUsers).catch(() => setUsers([]));
  }, [id]);

  const act = async (action, message) => {
    setSaving(true);
    setError("");
    try { await action(); toast.success(message); await load(); onChanged(); setTexto(""); setComentario(""); setDestino(""); setResolver(false); } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  if (!item) return <Modal title="Notificação" onClose={onClose}>{error ? <div className="text-sm text-rose-700">{error}</div> : <Spinner />}</Modal>;
  const style = SEVERITY_STYLE[item.severidade];
  const closed = item.status === "Resolvida";

  return (
    <Modal title={item.titulo} subtitle={`${item.tipo} · ${item.severidade} · ${item.status}`} onClose={onClose} className="max-w-2xl">
      <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
        <div className={`flex items-start gap-2 rounded-lg border-l-4 bg-slate-50 p-3 text-sm text-slate-700 ${style.border}`}><style.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} /> {item.mensagem}</div>
        {item.encaminhada_para.length > 0 && <p className="text-xs text-slate-500">Encaminhada para: {item.encaminhada_para.join(", ")}</p>}

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Histórico</h4>
          {item.acoes.length ? <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
            {item.acoes.map((action) => (
              <li key={action.id} className="text-sm">
                <div className="text-xs text-slate-500"><b className="text-slate-700">{action.usuario}</b> · {action.tipo}{action.destinatario ? ` para ${action.destinatario}` : ""} · {dateTimeBr(action.criado_em)}</div>
                {action.texto && <p className="whitespace-pre-wrap text-slate-700">{action.texto}</p>}
              </li>
            ))}
          </ol> : <p className="mt-1 text-sm text-slate-400">Nenhuma ação registrada.</p>}
        </div>

        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {closed ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Resolvida{item.resolucao ? `: ${item.resolucao}` : "."}</p> : <>
          <form className="space-y-2 border-t border-slate-100 pt-4" onSubmit={(event) => { event.preventDefault(); act(() => api.responderNotificacao(id, texto, resolver), resolver ? "Resposta registrada e notificação resolvida." : "Resposta registrada."); }}>
            <label className="block"><span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><MessageSquare className="h-3.5 w-3.5" /> Responder (ação tomada)</span>
              <textarea rows={3} maxLength={2000} className={`mt-1 resize-y ${inputCls}`} value={texto} onChange={(event) => setTexto(event.target.value)} placeholder="Ex.: OM reprogramada para quinta; peça solicitada ao almoxarifado." />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {manager ? <label className="inline-flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={resolver} onChange={(event) => setResolver(event.target.checked)} /> Marcar como resolvida</label> : <span />}
              <Btn type="submit" size="sm" disabled={saving || !texto.trim()}>{resolver ? "Responder e resolver" : "Registrar resposta"}</Btn>
            </div>
          </form>
          <form className="space-y-2 border-t border-slate-100 pt-4" onSubmit={(event) => { event.preventDefault(); act(() => api.encaminharNotificacao(id, Number(destino), comentario), "Notificação encaminhada."); }}>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Forward className="h-3.5 w-3.5" /> Encaminhar</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[14rem_1fr_auto]">
              <select required aria-label="Encaminhar para" className={inputCls} value={destino} onChange={(event) => setDestino(event.target.value)}>
                <option value="">Encaminhar para…</option>
                {users.map((person) => <option key={person.id} value={person.id}>{person.nome} · {person.papel}{person.equipe ? ` · ${person.equipe}` : ""}</option>)}
              </select>
              <input maxLength={2000} aria-label="Comentário do encaminhamento" className={inputCls} placeholder="Comentário (opcional)" value={comentario} onChange={(event) => setComentario(event.target.value)} />
              <Btn type="submit" size="sm" variant="ghost" disabled={saving || !destino}>Encaminhar</Btn>
            </div>
          </form>
        </>}
      </div>
    </Modal>
  );
}
