import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Bell, CalendarDays, Check, CheckCircle2, CloudUpload, FileText,
  Inbox, Play, Plus, ShieldAlert, ShieldCheck, Timer, X,
} from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Badge, Btn, Card, EmptyState, ErrorState, Modal, Spinner, inputCls, statusTone } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import { FILA_SINCRONIZADA, usePendencias } from "../offline/fila.js";
import { NovaNota, resumoOm } from "./Notas.jsx";

const parseIso = (iso) => new Date(`${iso}T12:00:00Z`);
const weekday = (iso, style = "short") => parseIso(iso).toLocaleDateString("pt-BR", { weekday: style, timeZone: "UTC" }).replace(".", "");
const dayMonth = (iso) => parseIso(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const longDate = (iso) => parseIso(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const hours = (value) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value || 0);
// O servidor grava datas e horas em UTC ("AAAA-MM-DD HH:MM:SS").
const serverTime = (value) => Date.parse(`${value.replace(" ", "T")}Z`);
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"; };

function Decorrido({ desde }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const minutes = Math.max(0, Math.floor((now - serverTime(desde)) / 60000));
  return <span className="tabular-nums">{Math.floor(minutes / 60)} h {String(minutes % 60).padStart(2, "0")} min</span>;
}

function Tile({ label, value, detail, tone = "slate" }) {
  const color = { slate: "text-slate-900", rose: "text-rose-700", emerald: "text-emerald-700" }[tone];
  return (
    <Card className="p-3 sm:p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {detail && <div className="text-xs text-slate-500">{detail}</div>}
    </Card>
  );
}

function OrdemCard({ order, onOpen }) {
  const action = order.em_execucao ? "Continuar" : !order.aberta ? "Consultar" : order.status === "Em execução" ? "Continuar" : "Executar";
  return (
    <li>
      <Card className={`p-4 ${order.em_execucao ? "border-emerald-300" : order.atrasada ? "border-rose-300" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold text-slate-900">OM {order.numero}</span>
              <Badge tone={statusTone(order.status)}>{order.status}</Badge>
            </div>
            <p className="mt-0.5 truncate text-sm text-slate-700"><span className="font-mono font-semibold">{order.equipamento || "Sem equipamento"}</span>{order.equipamento_descricao ? ` · ${order.equipamento_descricao}` : ""}</p>
            <p className="text-xs text-slate-500">{order.tipo}{order.area ? ` · ${order.area}` : ""} · {hours(order.hh_previsto)} HH previsto{order.fim && order.fim !== order.inicio ? ` · até ${dayMonth(order.fim)}` : ""}</p>
          </div>
          <Btn size="sm" variant={order.aberta ? "primary" : "ghost"} onClick={onOpen}>
            {order.em_execucao ? <Timer className="h-3.5 w-3.5" /> : order.aberta ? <Play className="h-3.5 w-3.5" /> : null}{action}
          </Btn>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {order.em_execucao && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"><Timer className="h-3 w-3" /> Em execução há <Decorrido desde={order.iniciado_em} /></span>}
          {order.atrasada && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" /> Atrasada (prazo {dayMonth(order.fim)})</span>}
          {order.aberta && order.exige_pt && (order.pt_vigente
            ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"><ShieldCheck className="h-3 w-3" /> PT vigente</span>
            : <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800"><ShieldAlert className="h-3 w-3" /> Exige PT aprovada</span>)}
          {order.plano && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Plano: {order.plano}</span>}
        </div>
      </Card>
    </li>
  );
}

// OM atribuída pelo sistema que ainda espera o aceite do executante.
function AceiteCard({ order, onAceitar, onRecusar, enviando }) {
  return (
    <li>
      <Card className={`p-4 ${order.prioridade_nivel <= 2 ? "border-rose-300" : "border-indigo-300"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold text-slate-900">OM {order.numero}</span>
              {order.prioridade_label && <Badge tone={order.prioridade_nivel <= 2 ? "rose" : "amber"}>{order.prioridade_label}</Badge>}
            </div>
            <p className="mt-0.5 truncate text-sm text-slate-700"><span className="font-mono font-semibold">{order.equipamento || "Sem equipamento"}</span>{order.equipamento_descricao ? ` · ${order.equipamento_descricao}` : ""}</p>
            {order.nota_descricao && <p className="mt-1 text-sm text-slate-600">“{order.nota_descricao}”</p>}
            <p className="mt-1 text-xs text-slate-500">{order.inicio ? `Programada para ${weekday(order.inicio, "long")}, ${dayMonth(order.inicio)}` : "Sem data"} · {hours(order.hh_previsto)} HH previsto</p>
          </div>
          <div className="flex gap-2">
            <Btn size="sm" variant="ghost" onClick={onRecusar} disabled={enviando}><X className="h-3.5 w-3.5" /> Recusar</Btn>
            <Btn size="sm" onClick={onAceitar} disabled={enviando}><Check className="h-3.5 w-3.5" /> Aceitar</Btn>
          </div>
        </div>
      </Card>
    </li>
  );
}

const MOTIVOS_RECUSA = ["Sem disponibilidade na data", "Fora da minha especialidade", "Ausência programada"];

export function RecusaModal({ order, onClose, onSaved }) {
  const [motivo, setMotivo] = useState(MOTIVOS_RECUSA[0]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try { await onSaved(await api.recusarOrdem(order.id, motivo.trim())); }
    catch (error) { setErro(error.message); setSalvando(false); }
  };
  return (
    <Modal title={`Recusar OM ${order.numero}`} subtitle="O sistema envia a OM para outro executante disponível." onClose={onClose} className="max-w-lg">
      <form onSubmit={salvar} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {MOTIVOS_RECUSA.map((option) => (
            <button key={option} type="button" onClick={() => setMotivo(option)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${motivo === option ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{option}</button>
          ))}
        </div>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Motivo</span>
          <textarea required minLength={5} maxLength={1000} rows={2} className={`mt-1 resize-y ${inputCls}`} value={motivo} onChange={(event) => setMotivo(event.target.value)} /></label>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onClose}>Voltar</Btn><Btn type="submit" disabled={salvando || motivo.trim().length < 5}>{salvando ? "Enviando…" : "Recusar OM"}</Btn></div>
      </form>
    </Modal>
  );
}

export default function Inicio() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [recusando, setRecusando] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [novaNota, setNovaNota] = useState(null);
  const pendencias = usePendencias(user.id);
  const [data, setData] = useState(null);
  const [dia, setDia] = useState(null);
  const [error, setError] = useState("");

  const load = () => api.campoResumo().then((result) => { setData(result); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    window.addEventListener(FILA_SINCRONIZADA, load);
    return () => window.removeEventListener(FILA_SINCRONIZADA, load);
  }, []);

  if (!data) return error ? <ErrorState message={error} onRetry={load} /> : <Spinner />;

  const abrir = (order) => navigate(`/apropriacao?om=${order.id}`);
  const aceitar = async (order) => {
    setEnviando(true);
    try {
      await api.aceitarOrdem(order.id);
      toast.success(`OM ${order.numero} aceita e incluída no seu plano.`);
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setEnviando(false); }
  };
  const abrirNota = () => api.cadastros().then((catalogs) => setNovaNota(catalogs.equipamentos)).catch((e) => toast.error(e.message));
  const paraAceitar = data.ordens.filter((order) => order.aguardando_aceite);
  const byId = new Map(data.ordens.map((order) => [order.id, order]));
  const selecionado = dia || data.hoje;
  const abertas = data.ordens.filter((order) => order.aberta && !order.aguardando_aceite);
  const emExecucao = abertas.filter((order) => order.em_execucao);
  const atrasadas = abertas.filter((order) => order.atrasada);
  // Hoje inclui o que está programado para o dia e o que ficou para trás: em execução ou atrasado.
  const hoje = abertas.filter((order) => order.hoje || order.em_execucao || order.atrasada);
  const programadasNoDia = (data.semana.dias.find((day) => day.data === selecionado)?.ordens || []).map((id) => byId.get(id));
  const doDia = (selecionado === data.hoje ? [...new Set([...hoje, ...programadasNoDia])] : programadasNoDia)
    .sort((a, b) => Number(b.em_execucao) - Number(a.em_execucao) || Number(b.atrasada) - Number(a.atrasada) || Number(a.aberta === false) - Number(b.aberta === false));
  const semData = abertas.filter((order) => !order.inicio);
  const semana = new Set(data.semana.dias.flatMap((day) => day.ordens));
  const hhSemana = abertas.filter((order) => semana.has(order.id)).reduce((sum, order) => sum + (order.hh_previsto || 0), 0);
  const c = data.contadores;

  // O que precisa de atenção, do mais urgente ao informativo.
  const atencao = [
    ...atrasadas.map((order) => ({ key: `atrasada-${order.id}`, tone: "rose", Icon: AlertTriangle, text: `OM ${order.numero} atrasada (prazo ${dayMonth(order.fim)})`, action: "Executar", go: () => abrir(order) })),
    ...abertas.filter((order) => order.exige_pt && !order.pt_vigente).map((order) => ({
      key: `pt-${order.id}`, tone: "amber", Icon: ShieldAlert,
      text: c.pts_aguardando ? `OM ${order.numero} exige PT: aguardando aprovação do PCM/CCM` : `OM ${order.numero} exige Permissão de Trabalho aprovada`,
      action: c.pts_aguardando ? "Ver PT" : "Solicitar PT", go: () => navigate(c.pts_aguardando ? "/permissoes" : `/permissoes?om=${order.id}`),
    })),
    c.passagens_nao_lidas > 0 && { key: "passagens", tone: "amber", Icon: FileText, text: `${c.passagens_nao_lidas} passagem(ns) de turno para ler`, action: "Ler", go: () => navigate("/passagem-turno") },
    c.notificacoes_nao_lidas > 0 && { key: "notificacoes", tone: "indigo", Icon: Bell, text: `${c.notificacoes_nao_lidas} notificação(ões) não lida(s)`, action: "Ver", go: () => navigate("/notificacoes") },
    pendencias.length > 0 && { key: "offline", tone: "amber", Icon: CloudUpload, text: `${pendencias.length} registro(s) feito(s) sem conexão aguardando envio`, action: null },
  ].filter(Boolean);
  const toneClass = { rose: "border-rose-200 bg-rose-50 text-rose-800", amber: "border-amber-200 bg-amber-50 text-amber-900", indigo: "border-slate-200 bg-white text-slate-700" };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{greeting()}, {data.usuario.nome.split(" ")[0]}!</h2>
        <p className="mt-0.5 text-sm text-slate-500"><span className="first-letter:uppercase">{longDate(data.hoje)}</span>{data.usuario.equipe ? ` · ${data.usuario.equipe}` : ""}</p>
      </header>

      <section aria-label="Resumo" className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile label="Hoje" value={hoje.length} detail={`${hours(hoje.reduce((sum, order) => sum + (order.hh_previsto || 0), 0))} HH previsto`} />
        <Tile label="Atrasadas" value={atrasadas.length} tone={atrasadas.length ? "rose" : "emerald"} detail={atrasadas.length ? "resolver primeiro" : "nenhuma"} />
        <Tile label="Na semana" value={[...semana].filter((id) => byId.get(id)?.aberta).length} detail={`${hours(hhSemana)} HH previsto`} />
      </section>

      {paraAceitar.length > 0 && <section aria-labelledby="aceitar">
        <h3 id="aceitar" className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-700"><Inbox className="h-4 w-4" /> Novas OMs para aceitar ({paraAceitar.length})</h3>
        <ul className="space-y-2">{paraAceitar.map((order) => <AceiteCard key={order.id} order={order} enviando={enviando} onAceitar={() => aceitar(order)} onRecusar={() => setRecusando(order)} />)}</ul>
      </section>}

      {emExecucao.length > 0 && <section aria-labelledby="agora">
        <h3 id="agora" className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-emerald-700"><Timer className="h-4 w-4" /> Agora</h3>
        <ul className="space-y-2">{emExecucao.map((order) => <OrdemCard key={order.id} order={order} onOpen={() => abrir(order)} />)}</ul>
      </section>}

      <section aria-labelledby="atencao">
        <h3 id="atencao" className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Precisa da sua atenção</h3>
        {atencao.length ? <ul className="space-y-2">
          {atencao.map((item) => (
            <li key={item.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm ${toneClass[item.tone]}`}>
              <span className="flex min-w-0 items-start gap-2"><item.Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {item.text}</span>
              {item.action && <Btn size="sm" variant="ghost" onClick={item.go}>{item.action} <ArrowRight className="h-3.5 w-3.5" /></Btn>}
            </li>
          ))}
        </ul> : <Card><EmptyState icon={CheckCircle2} title="Tudo em dia.">Nenhuma pendência no momento. Bom trabalho!</EmptyState></Card>}
      </section>

      <section aria-labelledby="plano">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="plano" className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500"><CalendarDays className="h-4 w-4" /> Plano da semana</h3>
          <button type="button" onClick={() => navigate("/meu-plano")} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">Ver plano completo</button>
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2" role="tablist" aria-label="Dias da semana">
          {data.semana.dias.map((day) => {
            const total = day.data === data.hoje ? hoje.length : day.ordens.filter((id) => byId.get(id)?.aberta).length;
            const active = day.data === selecionado;
            const isToday = day.data === data.hoje;
            return (
              <button key={day.data} type="button" role="tab" aria-selected={active} onClick={() => setDia(day.data)}
                aria-label={`${weekday(day.data, "long")} ${dayMonth(day.data)}: ${total} OM(s)`}
                className={`flex flex-col items-center rounded-xl border px-1 py-2 transition-colors ${active ? "border-indigo-600 bg-indigo-600 text-white" : isToday ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                <span className="text-[11px] font-semibold uppercase">{weekday(day.data)}</span>
                <span className="text-sm font-bold tabular-nums">{dayMonth(day.data).slice(0, 2)}</span>
                <span className={`mt-1 min-w-5 rounded-full px-1.5 text-[11px] font-bold tabular-nums ${active ? "bg-white/20" : total ? "bg-indigo-100 text-indigo-700" : "text-slate-300"}`}>{total || "–"}</span>
              </button>
            );
          })}
        </div>
        <h4 className="mb-2 mt-4 text-sm font-semibold text-slate-800">
          {selecionado === data.hoje ? "Tarefas de hoje" : <span className="first-letter:uppercase">Tarefas de {weekday(selecionado, "long")}, {dayMonth(selecionado)}</span>}
        </h4>
        {doDia.length
          ? <ul className="space-y-2">{doDia.map((order) => <OrdemCard key={order.id} order={order} onOpen={() => abrir(order)} />)}</ul>
          : <Card><EmptyState icon={CalendarDays} title={selecionado === data.hoje ? "Nenhuma OM programada para hoje." : "Nenhuma OM programada para este dia."}>
            {semData.length ? "Veja abaixo as OMs atribuídas a você ainda sem data." : "Escolha outro dia da semana ou veja o plano completo."}
          </EmptyState></Card>}
      </section>

      {semData.length > 0 && <section aria-labelledby="sem-data">
        <h3 id="sem-data" className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Atribuídas sem data programada</h3>
        <ul className="space-y-2">{semData.map((order) => <OrdemCard key={order.id} order={order} onOpen={() => abrir(order)} />)}</ul>
      </section>}

      <section aria-labelledby="atalhos">
        <h3 id="atalhos" className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Atalhos</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[["Abrir nota", abrirNota, Plus], ["Enviar ocorrência", () => navigate("/ocorrencias"), Bell], ["Passagem de turno", () => navigate("/passagem-turno"), FileText]].map(([label, onClick, Icon]) => (
            <button key={label} type="button" onClick={onClick} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50">
              <Icon className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </section>

      {recusando && <RecusaModal order={recusando} onClose={() => setRecusando(null)} onSaved={async (resultado) => {
        setRecusando(null);
        toast.success(resultado.redistribuida_para ? `OM ${recusando.numero} enviada para ${resultado.redistribuida_para}.` : `OM ${recusando.numero} devolvida ao PCM/CCM para redistribuição.`);
        await load();
      }} />}
      {novaNota && <NovaNota equip={novaNota} onClose={() => setNovaNota(null)} onSaved={async (nota) => {
        setNovaNota(null);
        toast.success(resumoOm(nota.numero, nota.ordem));
        await load();
      }} />}
    </div>
  );
}
