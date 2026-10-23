import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Camera, Check, CheckCircle2, Circle, CloudUpload, Loader2, Pause, Play, Plus, Square, X } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Card, Eyebrow, Modal, Spinner, dataBr, inputCls, statusTone, ErrorState } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import { useNoticeToast } from "../components/toast.jsx";
import { useAuth } from "../auth.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";
import PermissaoOM from "../components/PermissaoOM.jsx";
import { FILA_SINCRONIZADA, momentoServidor, usePendencias } from "../offline/fila.js";
import { RecusaModal } from "./Inicio.jsx";

const TIPOS_INTERCORRENCIA = ["Desvio", "Alteração de rota", "Alteração de serviço", "Outro"];
const MAX_AJUDANTES = 49;

// O servidor grava datas em UTC no formato "AAAA-MM-DD HH:MM:SS".
const serverTime = (value) => Date.parse(`${value.replace(" ", "T")}Z`);
const localTime = (value) => new Date(serverTime(value)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const hours = (value) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const clock = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map((part) => String(part).padStart(2, "0")).join(":");
};
const aguardandoAceite = (order) => order.status === "Distribuída" && !order.aceita_em;

export default function Apropriacao() {
  const toast = useToast();
  const { user } = useAuth();
  const [ordens, setOrdens] = useState(null);
  const [searchParams] = useSearchParams();
  // "?om=<id>" abre direto a OM escolhida no Início ou em Meu plano.
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
  const [recusaAberta, setRecusaAberta] = useState(false);
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
  const aceitar = async () => {
    if (await executar(() => api.aceitarOrdem(ordemId))) toast.success(`OM ${om.numero} aceita e incluída no seu plano.`);
  };
  if (!ordens) return erro ? <ErrorState message={erro} /> : <Spinner />;

  if (!ordens.length) {
    return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Nenhuma OM foi atribuída à sua conta. As OMs chegam automaticamente quando uma nota é aberta para um equipamento da sua equipe.</div>;
  }

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
  const concluida = ["Aguardando validação", "Encerrada"].includes(om?.status);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">
          <ThemeIcon name="wrench" className="h-5 w-5" /> OMs de {user.nome}
        </div>
        <div className="divide-y divide-slate-50">
          {ordens.map((order) => (
            <button key={order.id} type="button" aria-current={ordemId === order.id} onClick={() => setOrdemId(order.id)}
              className={`flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors ${ordemId === order.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold text-slate-800">{order.numero}</div>
                <div className="truncate font-mono text-xs text-slate-500">{order.equipamento || "Sem equipamento"}</div>
              </div>
              <div className="flex flex-col items-end gap-1"><Badge tone={aguardandoAceite(order) ? "indigo" : statusTone(order.status)}>{aguardandoAceite(order) ? "Aguardando aceite" : order.status}</Badge>{order.prioridade_label && <span className="text-[10px] font-semibold text-rose-700">{order.prioridade_label}</span>}</div>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</div>}

        {res?.hh != null && (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
            <Check className="h-5 w-5" /> {hours(res.hh)} HH apropriados ({hours(res.duracao_horas)} h × {res.num_executantes} executante(s)). Agora anexe as fotos e conclua a OM.
          </div>
        )}

        {!om ? <Spinner /> : (<>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow>{om.equipamento || "Sem equipamento"}{om.localizacao ? ` · ${om.localizacao}` : ""}</Eyebrow>
                <h2 className="mt-1 font-mono text-xl font-bold text-slate-900">OM {om.numero}</h2>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={aguardandoAceite(om) ? "indigo" : statusTone(om.status)}>{aguardandoAceite(om) ? "Aguardando aceite" : om.status}</Badge>
                {om.prioridade_label && <Badge tone={om.prioridade_nivel <= 2 ? "rose" : "amber"}>{om.prioridade_label}</Badge>}
              </div>
            </div>
            {om.nota_descricao && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{om.nota_descricao}”</p>}
            <p className="mt-3 text-sm text-slate-600">
              {om.tipo} · {om.data_programada ? `programada para ${dataBr(om.data_programada)}` : "sem data"} · {hours(om.hh_previsto)} HH previsto
            </p>
          </Card>

          {aguardandoAceite(om) && <Card className="border-indigo-300 p-5">
            <h3 className="font-semibold text-slate-800">Esta OM foi enviada para você</h3>
            <p className="mt-1 text-sm text-slate-600">Ao aceitar, ela entra no seu plano da semana. Se não puder atender, recuse: o sistema envia para outro executante.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn onClick={aceitar} disabled={enviando}><Check className="h-4 w-4" /> Aceitar OM</Btn>
              <Btn variant="ghost" onClick={() => setRecusaAberta(true)} disabled={enviando}><X className="h-4 w-4" /> Recusar</Btn>
            </div>
          </Card>}

          {(om.exige_pt || om.permissoes?.length > 0) && !aguardandoAceite(om) && <Card className="p-5">
            <h3 className="mb-3 font-semibold text-slate-800">Permissão de trabalho</h3>
            <PermissaoOM ordem={om} podeConfigurar={false} />
          </Card>}

          {!aguardandoAceite(om) && <>
            <Etapa numero={1} titulo="Executar" ok={Boolean(apropriacao)}>
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
                    {execucao.pausado_em
                      ? <Btn onClick={retomar} disabled={enviando || execucao.offline}><Play className="h-4 w-4" /> {enviando ? "Retomando…" : "Retomar"}</Btn>
                      : <Btn onClick={finalizar} disabled={enviando}><Square className="h-4 w-4" /> {enviando ? "Finalizando…" : "Finalizar serviço"}</Btn>}
                    {!execucao.pausado_em && <Btn variant="ghost" onClick={() => setPausaAberta(true)} disabled={enviando || execucao.offline}><Pause className="h-4 w-4" /> Pausar</Btn>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <button type="button" className="font-semibold text-slate-500 hover:text-indigo-700" onClick={() => setIntercorrenciaAberta(true)} disabled={enviando}>+ Registrar intercorrência</button>
                    <button type="button" className="font-semibold text-slate-500 hover:text-rose-700" onClick={() => setImpedimentoAberto(true)} disabled={enviando}>Bloquear por impedimento</button>
                  </div>
                </div>
              ) : bloqueada ? (
                <p className="text-sm text-slate-500">{om.status === "Encerrada" || om.status === "Cancelada" ? `OM ${om.status.toLowerCase()}; registros somente para consulta.` : om.status === "Bloqueada" ? "OM bloqueada por impedimento. Aguarde PCM/CCM registrar a resolução." : om.status === "Aguardando validação" ? "Serviço concluído; aguardando a validação do CCM." : om.status === "Devolvida para ajuste" ? "OM devolvida para ajuste. Aguarde nova distribuição após a correção." : "A OM ainda não foi liberada para execução."}</p>
              ) : (
                <InicioExecucao key={om.id} nomeUsuario={user.nome} colaboradores={colaboradores} enviando={enviando}
                  bloqueado={om.exige_pt && !om.pt_vigente ? "Inicie somente com Permissão de Trabalho aprovada e vigente (veja acima)." : ""}
                  onImpedimento={() => setImpedimentoAberto(true)}
                  onIniciar={async (dados) => { if (await executar(() => api.iniciarExecucao(om.id, dados, `OM ${om.numero}`))) toast.success("Serviço iniciado: o cronômetro está contando."); }} />
              )}
              <Intercorrencias itens={om.intercorrencias} />
              {intercorrenciasOffline.length > 0 && <div className="mt-3"><PendenteSincronizacao>{intercorrenciasOffline.length} intercorrência(s) registrada(s) sem conexão: {intercorrenciasOffline.map((item) => item.meta.tipo).join(", ")}.</PendenteSincronizacao></div>}
            </Etapa>

            <Etapa numero={2} titulo="Fotos do serviço e dos formulários" ok={om.evidencias?.length > 0}>
              <FotosOM key={om.id} ordem={om} podeEnviar={!concluida && !["Encerrada", "Cancelada"].includes(om.status)}
                onEnviadas={() => carregarOm(om.id)} onOffline={() => setAviso("Sem conexão: fotos salvas neste aparelho e enviadas automaticamente ao reconectar.")} />
            </Etapa>

            <Etapa numero={3} titulo="Concluir" ok={concluida}>
              {concluida
                ? <p className="text-sm text-slate-600">{om.status === "Encerrada" ? "O CCM validou e encerrou a OM." : "Serviço concluído e enviado ao CCM para validação."}{om.relatorio?.atividade_realizada ? <span className="mt-1 block text-slate-500">“{om.relatorio.atividade_realizada}”</span> : null}</p>
                : <ConclusaoOM key={om.id} ordem={om} pronto={Boolean(apropriacao) && om.status === "Em execução"}
                  onConcluida={async () => { toast.success(`OM ${om.numero} concluída e enviada para validação.`); await Promise.all([carregar(), carregarOm(om.id)]); }}
                  onOffline={() => setAviso("Sem conexão: o relatório foi salvo neste aparelho. Conclua a OM quando a conexão voltar.")} />}
            </Etapa>
          </>}
        </>)}
      </div>

      {recusaAberta && <RecusaModal order={om} onClose={() => setRecusaAberta(false)} onSaved={async (resultado) => {
        setRecusaAberta(false);
        toast.success(resultado.redistribuida_para ? `OM ${om.numero} enviada para ${resultado.redistribuida_para}.` : `OM ${om.numero} devolvida ao PCM/CCM para redistribuição.`);
        setOrdemId(null);
        await carregar();
      }} />}
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
        {ok && <span className="ml-auto"><Badge tone="emerald">Feito</Badge></span>}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

// Início do serviço: o executante é quem está logado; ajudantes são opcionais.
function InicioExecucao({ nomeUsuario, colaboradores, enviando, onIniciar, onImpedimento, bloqueado }) {
  const [ajudantes, setAjudantes] = useState([]);
  const nomes = [nomeUsuario, ...ajudantes.map((nome) => nome.trim()).filter(Boolean)];

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onIniciar({ num_executantes: nomes.length, nomes }); }}>
      {ajudantes.length > 0 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ajudantes.map((nome, index) => (
          <div key={index} className="flex gap-1">
            <input list="apropriacao-colaboradores" maxLength={120} className={inputCls} value={nome} autoFocus={index === ajudantes.length - 1}
              aria-label={`Nome do ajudante ${index + 1}`} placeholder={`Ajudante ${index + 1}`}
              onChange={(event) => setAjudantes((previous) => previous.map((item, position) => position === index ? event.target.value : item))} />
            <button type="button" aria-label={`Remover ajudante ${index + 1}`} className="rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
              onClick={() => setAjudantes((previous) => previous.filter((_, position) => position !== index))}><X className="h-4 w-4" /></button>
          </div>
        ))}
        <datalist id="apropriacao-colaboradores">
          {colaboradores.map((person) => <option key={person.id} value={person.nome} />)}
        </datalist>
      </div>}
      <div className="flex flex-wrap items-center gap-3">
        <Btn type="submit" disabled={enviando || Boolean(bloqueado)}><Play className="h-4 w-4" /> {enviando ? "Iniciando…" : "Iniciar serviço"}</Btn>
        {ajudantes.length < MAX_AJUDANTES && <Btn type="button" variant="ghost" onClick={() => setAjudantes((previous) => [...previous, ""])}><Plus className="h-4 w-4" /> Ajudante</Btn>}
      </div>
      <p className={`text-xs ${bloqueado ? "font-semibold text-amber-700" : "text-slate-500"}`}>{bloqueado || `O cronômetro conta o tempo; o HH apropriado é o tempo × ${nomes.length} pessoa(s).`}</p>
      <button type="button" className="text-xs font-semibold text-slate-500 hover:text-rose-700" onClick={onImpedimento} disabled={enviando}>
        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Não consigo iniciar (registrar impedimento)
      </button>
    </form>
  );
}

// Fotos da execução: serviço realizado e formulários/checklists preenchidos em papel.
function FotosOM({ ordem, podeEnviar, onEnviadas, onOffline }) {
  const [imagens, setImagens] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    const urls = [];
    Promise.all((ordem.evidencias || []).map(async (image) => {
      const url = URL.createObjectURL(await api.imagemOM(ordem.id, image.id));
      urls.push(url);
      return { ...image, url };
    })).then((lista) => { if (ativo) setImagens(lista); }).catch(() => {});
    return () => { ativo = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [ordem.id, ordem.evidencias?.length]);

  const enviar = async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    if (!files.length) return;
    setErro("");
    setEnviando(true);
    try {
      for (let start = 0; start < files.length; start += 5) {
        const resultado = await api.enviarEvidencias(ordem.id, files.slice(start, start + 5), `OM ${ordem.numero}`);
        if (resultado?.offline) { onOffline(); return; }
      }
      await onEnviadas();
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Fotografe o serviço e os formulários/checklists preenchidos em papel.</p>
      {imagens.length > 0 && <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {imagens.map((image) => (
          <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-slate-200">
            <img src={image.url} alt={image.nome_arquivo} className="h-full w-full object-cover" />
          </a>
        ))}
      </div>}
      {podeEnviar && <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-indigo-300 px-4 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 ${enviando ? "pointer-events-none opacity-60" : ""}`}>
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {enviando ? "Enviando…" : "Tirar foto ou anexar"}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" multiple className="sr-only" onChange={enviar} disabled={enviando} />
      </label>}
      {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
    </div>
  );
}

// Conclusão em um passo: o que foi feito + se o equipamento pode voltar a operar.
function ConclusaoOM({ ordem, pronto, onConcluida, onOffline }) {
  const [atividade, setAtividade] = useState(ordem.relatorio?.atividade_realizada || "");
  const [liberado, setLiberado] = useState(ordem.relatorio?.apto_retorno_operacao ?? null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const concluir = async (event) => {
    event.preventDefault();
    setErro("");
    setSalvando(true);
    try {
      const salvo = await api.salvarRelatorio(ordem.id, {
        atividade_realizada: atividade.trim(),
        equipamento_testado: true,
        apto_retorno_operacao: liberado,
        condicao_final_ativo: liberado ? "Liberado para operação." : "Não liberado: requer nova intervenção.",
      }, `OM ${ordem.numero}`);
      if (salvo?.offline) { onOffline(); return; }
      await api.concluirTecnicaOrdem(ordem.id);
      await onConcluida();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={concluir} className="space-y-4">
      <label className="block"><span className="text-xs font-semibold text-slate-500">O que foi feito?</span>
        <textarea required rows={3} maxLength={4000} className={`mt-1 resize-y ${inputCls}`} value={atividade} onChange={(event) => setAtividade(event.target.value)}
          placeholder="Ex.: troca do rolamento do mancal e reaperto da base; teste funcional sem ruído." /></label>
      <fieldset>
        <legend className="text-xs font-semibold text-slate-500">O equipamento pode voltar a operar?</legend>
        <div className="mt-1 flex gap-2">
          {[[true, "Sim, liberado"], [false, "Não"]].map(([value, label]) => (
            <button key={label} type="button" aria-pressed={liberado === value} onClick={() => setLiberado(value)}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold ${liberado === value ? (value ? "border-emerald-600 bg-emerald-600 text-white" : "border-rose-600 bg-rose-600 text-white") : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{label}</button>
          ))}
        </div>
      </fieldset>
      {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <Btn type="submit" disabled={salvando || !pronto || !atividade.trim() || liberado == null}><CheckCircle2 className="h-4 w-4" /> {salvando ? "Concluindo…" : "Concluir OM"}</Btn>
        {!pronto && <span className="text-xs text-slate-500">Finalize o serviço (passo 1) para concluir.</span>}
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
