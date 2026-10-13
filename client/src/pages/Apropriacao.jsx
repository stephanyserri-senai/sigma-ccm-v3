import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Circle, CloudUpload, Pause, Play, Plus, Square } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Card, Eyebrow, Modal, Spinner, inputCls, statusTone, ErrorState } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import { useNoticeToast } from "../components/toast.jsx";
import { useAuth, PERMS } from "../auth.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";
import ChecklistsOM from "../components/ChecklistsOM.jsx";
import PermissaoOM from "../components/PermissaoOM.jsx";
import { FILA_SINCRONIZADA, momentoServidor, usePendencias } from "../offline/fila.js";

const TIPOS_INTERCORRENCIA = ["Desvio", "Alteração de rota", "Alteração de serviço", "Outro"];
const MAX_EXECUTANTES = 50;

// O servidor grava datas em UTC no formato "AAAA-MM-DD HH:MM:SS".
const serverTime = (value) => Date.parse(`${value.replace(" ", "T")}Z`);
const localTime = (value) => new Date(serverTime(value)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const hours = (value) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const clock = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map((part) => String(part).padStart(2, "0")).join(":");
};

export default function Apropriacao() {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ordens, setOrdens] = useState(null);
  const [searchParams] = useSearchParams();
  // "?om=<id>" abre direto a OM escolhida em Meu plano.
  const [ordemId, setOrdemId] = useState(() => Number(searchParams.get("om")) || null);
  const [om, setOm] = useState(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [colaboradores, setColaboradores] = useState([]);
  const [res, setRes] = useState(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [intercorrenciaAberta, setIntercorrenciaAberta] = useState(false);
  const [impedimentoAberto, setImpedimentoAberto] = useState(false);
  const [pausaAberta, setPausaAberta] = useState(false);
  const setAviso = useNoticeToast();
  const pendencias = usePendencias(user.id);

  const carregar = () => api.ordens().then((lista) => {
    setOrdens(lista);
    setOrdemId((current) => lista.some((order) => order.id === current) ? current : lista[0]?.id ?? null);
  }).catch((e) => setErro(e.message));

  const carregarOm = (id) => api.ordem(id).then((order) => {
    setClockOffset(serverTime(order.servidor_agora) - Date.now());
    setOm(order);
  }).catch((e) => setErro(e.message));

  useEffect(() => {
    carregar();
    api.cadastros().then((catalogs) => setColaboradores(catalogs.colaboradores)).catch(() => setColaboradores([]));
  }, []);
  useEffect(() => {
    setOm(null);
    setRes(null);
    if (ordemId) carregarOm(ordemId);
  }, [ordemId]);
  // Ao sincronizar a fila offline, recarrega a OM com o que o servidor registrou.
  useEffect(() => {
    const reload = () => { setAviso(""); carregar(); if (ordemId) carregarOm(ordemId); };
    window.addEventListener(FILA_SINCRONIZADA, reload);
    return () => window.removeEventListener(FILA_SINCRONIZADA, reload);
  }, [ordemId]);

  const podeVerIA = (PERMS[user.papel] || []).includes("ia");

  const executar = async (acao) => {
    setErro(""); setRes(null); setAviso(""); setEnviando(true);
    try {
      const resultado = await acao();
      // Sem conexão: a ação foi para a fila local; a tela usa as pendências até sincronizar.
      if (resultado?.offline) { setAviso("Sem conexão: registro salvo neste aparelho e enviado automaticamente ao reconectar."); return null; }
      await Promise.all([carregar(), carregarOm(ordemId)]);
      return resultado;
    } catch (e) {
      setErro(e.message);
      return null;
    } finally {
      setEnviando(false);
    }
  };

  const finalizar = async () => {
    if (!window.confirm("Finalizar a execução e apropriar o HH cronometrado?")) return;
    const resultado = await executar(() => api.finalizarExecucao(ordemId, `OM ${om.numero}`));
    if (resultado) { setRes(resultado); toast.success("Execução finalizada e HH apropriado."); }
  };
  const retomar = async () => {
    const resultado = await executar(() => api.retomarExecucao(ordemId));
    if (resultado) toast.success("Execução retomada; o cronômetro voltou a contar.");
  };
  if (!ordens) return erro ? <ErrorState message={erro} /> : <Spinner />;

  if (!ordens.length) {
    return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Nenhuma OM foi atribuída à sua conta. Peça ao PCM ou CCM para distribuir uma OM.</div>;
  }

  const feito = (tipo) => om?.condicoes?.find((condition) => condition.tipo === tipo)?.ok;
  const apropriacao = om?.apontamentos?.find((entry) => entry.tipo === "Apropriação");
  // Pendências offline desta OM (ainda não sincronizadas).
  const daOm = pendencias.filter((item) => item.meta?.ordem_id === om?.id);
  const iniciarOffline = daOm.find((item) => item.tipo === "iniciar_execucao");
  const finalizarOffline = daOm.find((item) => item.tipo === "finalizar_execucao");
  const intercorrenciasOffline = daOm.filter((item) => item.tipo === "intercorrencia");
  const execucao = om?.execucao || (iniciarOffline ? {
    iniciado_em: momentoServidor(iniciarOffline.meta.momento), finalizado_em: null, offline: true,
    num_executantes: iniciarOffline.meta.num_executantes, executantes: (iniciarOffline.meta.nomes || []).filter(Boolean),
  } : null);
  const emAndamento = execucao && !execucao.finalizado_em && !finalizarOffline;
  const bloqueada = !["Liberada para execução", "Em execução"].includes(om?.status);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">
          <ThemeIcon name="wrench" className="h-5 w-5" /> OMs atribuídas a {user.nome}
        </div>
        <div className="divide-y divide-slate-50">
          {ordens.map((order) => (
            <button key={order.id} type="button" aria-current={ordemId === order.id} onClick={() => setOrdemId(order.id)}
              className={`flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors ${ordemId === order.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold text-slate-800">{order.numero}</div>
                <div className="truncate font-mono text-xs text-slate-500">{order.equipamento || "Sem equipamento"}</div>
              </div>
              <div className="flex flex-col items-end gap-1"><Badge tone={statusTone(order.status)}>{order.status}</Badge>{order.prioridade_label && <span className="text-[10px] font-semibold text-rose-700">{order.prioridade_label}</span>}</div>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</div>}

        {res && (
          <div className="space-y-2" role="status">
            {res.hh != null && (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                <Check className="h-5 w-5" /> {hours(res.hh)} HH apropriados ({hours(res.duracao_horas)} h × {res.num_executantes} executante(s)).
              </div>
            )}
            {res.sinal && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div className="text-sm text-amber-900">
                  <div className="font-semibold">A IA detectou uma possível inconsistência no HH registrado ({res.sinal.tipo}, confiança {Math.round(res.sinal.score * 100)}%).</div>
                  <p className="mt-0.5">Seu apontamento foi gravado como informado. A IA só sugere: o PCM/CCM vai analisar e decidir se corrige ou mantém o valor.</p>
                  {podeVerIA && <button type="button" onClick={() => navigate(`/ia?id=${res.sinal.id}`)} className="mt-1.5 inline-flex items-center gap-1 font-semibold text-amber-900 underline">Ver a sinalização em Qualidade de dados <ArrowRight className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            )}
            {res.hh == null && !res.sinal && (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <Check className="h-5 w-5 text-emerald-600" /> Registro enviado.
              </div>
            )}
          </div>
        )}

        {!om ? <Spinner /> : (<>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow>Execução em campo</Eyebrow>
                <h2 className="mt-1 font-mono text-xl font-bold text-slate-900">OM {om.numero}</h2>
              </div>
              <div className="flex flex-col items-end gap-1"><Badge tone={statusTone(om.status)}>{om.status}</Badge>{om.prioridade_label && <Badge tone={om.prioridade_nivel <= 2 ? "rose" : "amber"}>{om.prioridade_label}</Badge>}</div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[["Equipamento / TAG", om.equipamento], ["Localização", om.localizacao], ["Tipo", om.tipo], ["Prioridade", om.prioridade_label], ["Equipe", om.equipe], ["Prazo", om.prazo_dias == null ? "Parada programada" : `${om.prazo_dias} dias`], ["HH previsto", `${hours(om.hh_previsto)} h`]].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className="mt-0.5 text-sm text-slate-700">{value || "—"}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-slate-500">A execução só pode iniciar após liberação do PCM/CCM. A conclusão técnica e o encerramento administrativo são etapas distintas.</p>
          </Card>

          {(om.exige_pt || om.permissoes?.length > 0) && <Card className="p-5">
            <h3 className="mb-3 font-semibold text-slate-800">Permissão de trabalho</h3>
            <PermissaoOM ordem={om} podeConfigurar={false} />
          </Card>}

          <Etapa numero={1} titulo="Apropriação de mão de obra" ok={feito("Apropriação")}>
            {apropriacao ? (
              <ResumoApropriacao apropriacao={apropriacao} execucao={execucao} />
            ) : finalizarOffline ? (
              <PendenteSincronizacao>
                Execução finalizada às {new Date(finalizarOffline.meta.momento).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} sem conexão. O HH será apropriado com esse horário ao sincronizar.
              </PendenteSincronizacao>
            ) : emAndamento ? (
              <div className="space-y-4">
                {execucao.offline && <PendenteSincronizacao>Execução iniciada sem conexão; o cronômetro usa o horário do aparelho.</PendenteSincronizacao>}
                <Cronometro execucao={execucao} offset={execucao.offline ? 0 : clockOffset} />
                {execucao.pausado_em && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-semibold">Execução pausada em {localTime(execucao.pausado_em)}</p>
                  <p className="mt-1">{execucao.motivo_pausa}</p>
                </div>}
                <div className="flex flex-wrap gap-2">
                  <Btn variant="ghost" onClick={() => setIntercorrenciaAberta(true)} disabled={enviando}><Plus className="h-4 w-4" /> Registrar intercorrência</Btn>
                  <Btn variant="ghost" onClick={() => setImpedimentoAberto(true)} disabled={enviando}><AlertTriangle className="h-4 w-4" /> Bloquear por impedimento</Btn>
                  {execucao.pausado_em
                    ? <Btn onClick={retomar} disabled={enviando || execucao.offline}><Play className="h-4 w-4" /> {enviando ? "Retomando…" : "Retomar execução"}</Btn>
                    : <Btn variant="ghost" onClick={() => setPausaAberta(true)} disabled={enviando || execucao.offline}><Pause className="h-4 w-4" /> Pausar execução</Btn>}
                  {!execucao.pausado_em && <Btn onClick={finalizar} disabled={enviando}><Square className="h-4 w-4" /> {enviando ? "Finalizando…" : "Finalizar e apropriar HH"}</Btn>}
                </div>
                {execucao.offline && <p className="text-xs text-amber-700">Pausas e retomadas exigem conexão com o servidor.</p>}
              </div>
            ) : bloqueada ? (
              <p className="text-sm text-slate-500">{om.status === "Encerrada" || om.status === "Cancelada" ? `OM ${om.status.toLowerCase()}; registros somente para consulta.` : om.status === "Bloqueada" ? "OM bloqueada por impedimento. Aguarde PCM/CCM registrar a resolução." : om.status === "Aguardando validação" ? "A conclusão técnica foi enviada ao CCM para validação administrativa." : om.status === "Devolvida para ajuste" ? "OM devolvida para ajuste. Aguarde nova distribuição após a correção." : "A OM ainda não foi liberada para execução pelo PCM/CCM."}</p>
            ) : (
              <div className="space-y-3">
                {om.status === "Liberada para execução" && <Btn variant="ghost" onClick={() => setImpedimentoAberto(true)} disabled={enviando}><AlertTriangle className="h-4 w-4" /> Registrar impedimento antes de iniciar</Btn>}
                <InicioExecucao key={om.id} nomeUsuario={user.nome} colaboradores={colaboradores} enviando={enviando}
                  bloqueado={om.status !== "Liberada para execução" ? "A OM precisa estar liberada pelo PCM/CCM." : om.exige_pt && !om.pt_vigente ? "Inicie somente com Permissão de Trabalho aprovada e vigente (veja acima)." : ""}
                  onIniciar={async (dados) => { if (await executar(() => api.iniciarExecucao(om.id, dados, `OM ${om.numero}`))) toast.success("Execução iniciada: o cronômetro está contando."); }} />
              </div>
            )}
            <Intercorrencias itens={om.intercorrencias} />
            {intercorrenciasOffline.length > 0 && <div className="mt-3"><PendenteSincronizacao>{intercorrenciasOffline.length} intercorrência(s) registrada(s) sem conexão: {intercorrenciasOffline.map((item) => item.meta.tipo).join(", ")}.</PendenteSincronizacao></div>}
          </Etapa>

          <Etapa numero={2} titulo="Relatório de execução e fotos" ok={feito("Relatório")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Descreva a atividade realizada e anexe as evidências.</p>
              <Btn variant="ghost" onClick={() => navigate(`/execucao/${om.id}`)}>{feito("Relatório") ? "Ver relatório e fotos" : "Preencher relatório"} <ArrowRight className="h-4 w-4" /></Btn>
            </div>
          </Etapa>

          {om.formularios?.length > 0 && <Etapa numero={3} titulo="Checklists da OM"
            ok={feito("Checklists") ?? om.formularios.every((form) => form.ultima_resposta)}>
            <ChecklistsOM ordem={om} podePreencher={!bloqueada} podeVincular={false}
              onChanged={() => Promise.all([carregar(), carregarOm(om.id)])} />
          </Etapa>}

          <Etapa numero={om.formularios?.length > 0 ? 4 : 3} titulo="Conclusão técnica e validação administrativa" ok={om.status === "Aguardando validação" || om.status === "Encerrada"}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">{om.status === "Encerrada" ? "O CCM validou e encerrou a ordem." : om.status === "Aguardando validação" ? "Conclusão técnica enviada; aguardando revisão e decisão do CCM." : "Após salvar relatório, horas e checklists, encaminhe a conclusão técnica pela tela do relatório."}</p>
              {om.status === "Em execução" && <Btn variant="ghost" onClick={() => navigate(`/execucao/${om.id}`)} disabled={enviando}>Revisar relatório e concluir tecnicamente <ArrowRight className="h-4 w-4" /></Btn>}
            </div>
          </Etapa>
        </>)}
      </div>

      {intercorrenciaAberta && <IntercorrenciaModal ordemId={om.id} contexto={`OM ${om.numero}`} onClose={() => setIntercorrenciaAberta(false)}
        onSaved={async (resultado) => {
          setIntercorrenciaAberta(false);
          if (resultado?.offline) setAviso("Sem conexão: registro salvo neste aparelho e enviado automaticamente ao reconectar."); else { toast.success("Intercorrência registrada."); await carregarOm(om.id); }
        }} />}
      {pausaAberta && <PausaExecucaoModal onClose={() => setPausaAberta(false)} onSaved={async (motivo) => {
        const resultado = await api.pausarExecucao(om.id, { motivo });
        setPausaAberta(false);
        toast.success("Execução pausada; o tempo da pausa não será apropriado.");
        await carregarOm(om.id);
        return resultado;
      }} />}
      {impedimentoAberto && <ImpedimentoModal ordemId={om.id} contexto={`OM ${om.numero}`} onClose={() => setImpedimentoAberto(false)}
        onSaved={async (resultado) => {
          setImpedimentoAberto(false);
          if (resultado?.offline) setAviso("Sem conexão: registro salvo neste aparelho; sincronize para efetivar o bloqueio da OM.");
          else { toast.success("Impedimento registrado e OM bloqueada."); await Promise.all([carregar(), carregarOm(om.id)]); }
        }} />}
    </div>
  );
}

function PendenteSincronizacao({ children }) {
  return <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"><CloudUpload className="mt-0.5 h-4 w-4 shrink-0" /> <span>{children}</span></p>;
}

function Etapa({ numero, titulo, ok, children }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        {ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
        <h3 className="font-semibold text-slate-800"><span className="text-slate-400">{numero} ·</span> {titulo}</h3>
        {ok && <span className="ml-auto"><Badge tone="emerald">Concluída</Badge></span>}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function InicioExecucao({ nomeUsuario, colaboradores, enviando, onIniciar, bloqueado }) {
  const [quantidade, setQuantidade] = useState("1");
  const [nomes, setNomes] = useState([nomeUsuario]);
  const total = Number(quantidade);
  const valido = Number.isInteger(total) && total >= 1 && total <= MAX_EXECUTANTES;

  const mudarQuantidade = (event) => {
    setQuantidade(event.target.value);
    const next = Number(event.target.value);
    if (Number.isInteger(next) && next >= 1 && next <= MAX_EXECUTANTES) {
      setNomes((previous) => Array.from({ length: next }, (_, index) => previous[index] ?? ""));
    }
  };

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onIniciar({ num_executantes: total, nomes }); }}>
      <label className="block max-w-[14rem]">
        <span className="text-xs font-semibold text-slate-500">Número de executantes</span>
        <input type="number" min="1" max={MAX_EXECUTANTES} step="1" required className={`mt-1 ${inputCls}`} value={quantidade} onChange={mudarQuantidade} />
      </label>
      <fieldset>
        <legend className="text-xs font-semibold text-slate-500">Nomes dos executantes</legend>
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {nomes.map((nome, index) => (
            <input key={index} list="apropriacao-colaboradores" maxLength={120} className={inputCls} value={nome}
              aria-label={`Nome do executante ${index + 1}`} placeholder={`Executante ${index + 1}`}
              onChange={(event) => setNomes((previous) => previous.map((item, position) => position === index ? event.target.value : item))} />
          ))}
        </div>
        <datalist id="apropriacao-colaboradores">
          {colaboradores.map((person) => <option key={person.id} value={person.nome} />)}
        </datalist>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Btn type="submit" disabled={enviando || !valido || Boolean(bloqueado)}><Play className="h-4 w-4" /> {enviando ? "Iniciando…" : "Iniciar OM"}</Btn>
        <p className={`text-xs ${bloqueado ? "font-semibold text-amber-700" : "text-slate-500"}`}>{bloqueado || "O cronômetro começa ao iniciar; o HH é o tempo decorrido × número de executantes."}</p>
      </div>
    </form>
  );
}

function Cronometro({ execucao, offset }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const agoraEfetivo = execucao.pausado_em ? Math.min(agora + offset, serverTime(execucao.pausado_em)) : agora + offset;
  const tempoPausado = (execucao.pausas || []).reduce((total, pausa) => {
    const inicio = serverTime(pausa.pausado_em);
    const fim = pausa.retomado_em ? Math.min(agoraEfetivo, serverTime(pausa.retomado_em)) : agoraEfetivo;
    return total + Math.max(0, fim - Math.min(inicio, agoraEfetivo));
  }, 0);
  const decorrido = Math.max(0, agoraEfetivo - serverTime(execucao.iniciado_em) - tempoPausado);

  return (
    <div className="rounded-xl bg-slate-900 p-5 text-white">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
            <span className={`h-2 w-2 rounded-full ${execucao.pausado_em ? "bg-amber-400" : "animate-pulse bg-emerald-400"}`} /> {execucao.pausado_em ? "Pausada" : "Em andamento"}
          </div>
          <div role="timer" className="mt-1 font-mono text-4xl font-bold tabular-nums sm:text-5xl">{clock(decorrido)}</div>
          <div className="mt-1 text-xs text-slate-400">Iniciada em {localTime(execucao.iniciado_em)}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">HH acumulado</div>
          <div className="font-mono text-2xl font-bold tabular-nums">{hours((decorrido / 3600000) * execucao.num_executantes)}</div>
          <div className="text-xs text-slate-400">{execucao.num_executantes} executante(s)</div>
        </div>
      </div>
      <Executantes nomes={execucao.executantes} className="mt-4 border-t border-slate-700 pt-3 text-slate-300" />
    </div>
  );
}

function Executantes({ nomes, className = "" }) {
  if (!nomes?.length) return null;
  return <p className={`text-sm ${className}`}><span className="font-semibold">Executantes:</span> {nomes.join(", ")}</p>;
}

function PausaExecucaoModal({ onClose, onSaved }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try { await onSaved(motivo.trim()); }
    catch (error) { setErro(error.message); setSalvando(false); }
  };
  return (
    <Modal title="Pausar execução" subtitle="O tempo pausado não será contabilizado nas horas apropriadas. Registre o motivo para manter a rastreabilidade." onClose={onClose} className="max-w-lg">
      <form onSubmit={salvar} className="space-y-4">
        <label className="block"><span className="text-xs font-semibold text-slate-500">Motivo da pausa (mínimo 10 caracteres)</span><textarea required minLength={10} maxLength={1000} autoFocus rows={4} className={`mt-1 resize-y ${inputCls}`} value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Ex.: aguardando bloqueio de energia para prosseguir com segurança." /></label>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onClose}>Continuar execução</Btn><Btn type="submit" disabled={salvando || motivo.trim().length < 10}><Pause className="h-4 w-4" /> {salvando ? "Pausando…" : "Confirmar pausa"}</Btn></div>
      </form>
    </Modal>
  );
}

function ResumoApropriacao({ apropriacao, execucao }) {
  const itens = execucao?.finalizado_em
    ? [["HH apropriado", `${hours(apropriacao.hh_apropriado)} h`], ["Tempo cronometrado", `${hours(execucao.duracao_horas)} h`],
      ["Executantes", execucao.num_executantes], ["Período", `${localTime(execucao.iniciado_em)} – ${localTime(execucao.finalizado_em)}`]]
    : [["HH apropriado", `${hours(apropriacao.hh_apropriado)} h`], ["Apropriado por", apropriacao.usuario_nome]];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {itens.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-slate-800">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      <Executantes nomes={execucao?.executantes} className="text-slate-600" />
    </div>
  );
}

function Intercorrencias({ itens }) {
  if (!itens?.length) return null;
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Intercorrências ({itens.length})</div>
      <ul className="space-y-2">
        {itens.map((item) => (
          <li key={item.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone="amber">{item.tipo}</Badge>
              <span className="text-xs text-slate-500">{localTime(item.registrado_em)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{item.descricao}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IntercorrenciaModal({ ordemId, contexto, onClose, onSaved }) {
  const [tipo, setTipo] = useState(TIPOS_INTERCORRENCIA[0]);
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      await onSaved(await api.registrarIntercorrencia(ordemId, { tipo, descricao }, contexto));
    } catch (e) {
      setErro(e.message);
      setSalvando(false);
    }
  };

  return (
    <Modal title="Registrar intercorrência" subtitle="Desvios e alterações de rota ou de serviço ficam no histórico da OM. O cronômetro continua rodando." onClose={onClose} className="max-w-lg">
      <form onSubmit={salvar} className="space-y-4">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Tipo</span>
          <select className={`mt-1 ${inputCls}`} value={tipo} onChange={(event) => setTipo(event.target.value)}>
            {TIPOS_INTERCORRENCIA.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">O que aconteceu</span>
          <textarea required autoFocus rows={4} maxLength={2000} className={`mt-1 resize-y ${inputCls}`} value={descricao} onChange={(event) => setDescricao(event.target.value)}
            placeholder="Ex.: acesso bloqueado, rota alterada pelo pátio B; serviço ampliado para troca do acoplamento." />
        </label>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={salvando || !descricao.trim()}>{salvando ? "Salvando…" : "Registrar"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ImpedimentoModal({ ordemId, contexto, onClose, onSaved }) {
  const [tipo, setTipo] = useState("Operacional");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try { await onSaved(await api.registrarImpedimento(ordemId, { tipo, descricao }, contexto)); }
    catch (error) { setErro(error.message); setSalvando(false); }
  };
  return (
    <Modal title="Registrar impedimento" subtitle="O registro bloqueia a OM até o PCM/CCM documentar a resolução." onClose={onClose} className="max-w-lg">
      <form onSubmit={salvar} className="space-y-4">
        <label className="block"><span className="text-xs font-semibold text-slate-500">Tipo</span><select className={`mt-1 ${inputCls}`} value={tipo} onChange={(event) => setTipo(event.target.value)}>{["Material", "Recurso", "Segurança", "Escopo", "Operacional", "Outro"].map((choice) => <option key={choice}>{choice}</option>)}</select></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Descrição (mínimo 5 caracteres)</span><textarea required minLength={5} maxLength={2000} autoFocus rows={4} className={`mt-1 resize-y ${inputCls}`} value={descricao} onChange={(event) => setDescricao(event.target.value)} placeholder="Descreva o que impede a execução e o impacto." /></label>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn><Btn type="submit" disabled={salvando || descricao.trim().length < 5}>{salvando ? "Registrando…" : "Registrar e bloquear OM"}</Btn></div>
      </form>
    </Modal>
  );
}
