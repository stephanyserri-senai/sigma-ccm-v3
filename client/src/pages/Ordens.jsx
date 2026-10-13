import React, { useEffect, useState } from "react";
import { CheckCircle2, Circle, Check, ClipboardList } from "lucide-react";
import { api } from "../api.js";
import { Card, Badge, Btn, Modal, Spinner, statusTone, inputCls, dataBr, isIsoDate, ErrorState, EmptyState } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import { useAuth } from "../auth.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";
import ChecklistsOM from "../components/ChecklistsOM.jsx";
import { dateTimeBr } from "../components/FormRenderer.jsx";
import PermissaoOM from "../components/PermissaoOM.jsx";

const LABEL = { "Apropriação": "Apropriação de mão de obra", "Relatório": "Relatório de execução", "Validação": "Validação do líder", Checklists: "Checklists obrigatórios respondidos" };

export default function Ordens() {
  const toast = useToast();
  const { user } = useAuth();
  const [lista, setLista] = useState(null);
  const [sel, setSel] = useState(null);
  const [om, setOm] = useState(null);
  const [evidenceImages, setEvidenceImages] = useState([]);
  const [executantes, setExecutantes] = useState([]);
  const [executanteId, setExecutanteId] = useState("");
  const [planos, setPlanos] = useState([]);
  const [programando, setProgramando] = useState(false);
  const [planejando, setPlanejando] = useState(false);
  const [devolvendo, setDevolvendo] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [erro, setErro] = useState("");

  const carregarLista = () => api.ordens().then((l) => {
    setLista(l);
    setSel((current) => l.some((entry) => entry.id === current) ? current : l[0]?.id || null);
  }).catch((e) => setErro(e.message));
  const carregarOm = (id) => api.ordem(id).then((order) => {
    setOm(order);
    setExecutanteId(order.responsavel_id ? String(order.responsavel_id) : "");
  }).catch((e) => setErro(e.message));

  useEffect(() => { carregarLista(); }, []);
  useEffect(() => { if (sel) carregarOm(sel); }, [sel]);
  useEffect(() => {
    let active = true;
    const objectUrls = [];
    Promise.all((om?.evidencias || []).map(async (evidence) => {
      const url = URL.createObjectURL(await api.imagemOM(om.id, evidence.id));
      objectUrls.push(url);
      return { ...evidence, url };
    })).then((images) => { if (active) setEvidenceImages(images); })
      .catch(() => { if (active) setEvidenceImages([]); });
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [om?.id, om?.evidencias]);
  useEffect(() => {
    if (user.papel !== "CCM" && user.papel !== "PCM") return;
    api.executantes().then(setExecutantes).catch((e) => setErro(e.message));
    api.cadastros().then((catalogs) => setPlanos(catalogs.planos || [])).catch((e) => setErro(e.message));
  }, [user.papel]);

  const acao = async (status, responsavel_id) => {
    setErro("");
    try {
      await api.statusOrdem(sel, status, responsavel_id);
      const pessoa = executantes.find((person) => person.id === responsavel_id);
      toast.success(status === "Distribuída" ? `OM distribuída para ${pessoa?.nome || "o executante"}.` : `OM marcada como ${status.toLowerCase()}.`);
      await carregarLista(); await carregarOm(sel);
    } catch (e) { toast.error(e.message); }
  };
  const workflowAction = async (callback, success) => {
    try {
      await callback();
      toast.success(success);
      await carregarLista();
      await carregarOm(sel);
    } catch (e) { toast.error(e.message); }
  };

  if (erro && !lista) return <ErrorState message={erro} />;
  if (!lista) return <Spinner />;
  if (!lista.length) {
    return <Card><EmptyState title="Nenhuma ordem de manutenção por aqui." icon={ClipboardList}>
      {user.papel === "EXECUTANTE" ? "Nenhuma OM foi atribuída a você." : "Converta uma nota em OM ou gere a OM a partir de um plano preventivo em Cadastros."}
    </EmptyState></Card>;
  }

  const podeGerir = user.papel === "CCM" || user.papel === "PCM";
  const podeValidar = user.papel === "CCM";
  const podeAlterarPlanejamento = ["Aberta", "Programada", "Distribuída", "Devolvida para ajuste"].includes(om?.status);
  const cond = om?.condicoes || [];
  const validacaoPendente = cond.some((c) => c.tipo === "Validação" && !c.ok);
  const requisitosTecnicosCompletos = cond.filter((c) => c.tipo !== "Validação").every((c) => c.ok);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold text-slate-800"><ThemeIcon name="wrench" className="h-5 w-5" /> Ordens de manutenção</div>
        <div className="divide-y divide-slate-50">
          {lista.map((o) => (
            <button key={o.id} onClick={() => setSel(o.id)} className={`flex w-full items-center justify-between px-5 py-3 text-left transition-colors ${sel === o.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
              <div>
                <div className="font-mono text-sm font-semibold text-slate-800">{o.numero}</div>
                <div className="font-mono text-xs text-slate-500">{o.equipamento}{o.executante_nome ? ` · ${o.executante_nome}` : ""}</div>
              </div>
              <div className="flex flex-col items-end gap-1"><Badge tone={statusTone(o.status)}>{o.status}</Badge>{o.prioridade_label && <span className="text-[10px] font-semibold text-rose-700">{o.prioridade_label}</span>}</div>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-4 lg:col-span-3">
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</div>}
        {!om ? <Spinner /> : (<>
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-xl font-bold text-slate-900">OM {om.numero}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2"><Badge tone={statusTone(om.status)}>{om.status}</Badge><span className="font-mono text-xs text-slate-500">{om.equipamento}</span>{om.prioridade_label && <Badge tone={om.prioridade_nivel <= 2 ? "rose" : "amber"}>{om.prioridade_label} · Criticidade {om.criticidade}</Badge>}</div>
              </div>
              {podeGerir && podeAlterarPlanejamento && (
                <div className="flex flex-col items-end gap-2 sm:flex-row">
                  <select aria-label="Executante responsável" className={`${inputCls} min-w-48`} value={executanteId} onChange={(event) => setExecutanteId(event.target.value)}>
                    <option value="">Selecione o executante</option>
                    {executantes.map((person) => <option key={person.id} value={person.id}>{person.nome} · {person.username}</option>)}
                  </select>
                  <Btn size="sm" variant="ghost" onClick={() => setProgramando(true)}>{isIsoDate(om.data_programada) ? "Reprogramar" : "Programar"}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setPlanejando(true)}>{om.planejamento_pronto ? "Editar plano" : "Planejar"}</Btn>
                  <Btn size="sm" disabled={!executanteId || !om.data_programada} onClick={() => acao("Distribuída", Number(executanteId))}>Distribuir</Btn>
                  {om.status === "Distribuída" && <Btn size="sm" disabled={!om.planejamento_pronto || !om.data_programada || !executanteId} onClick={() => workflowAction(() => api.liberarOrdem(om.id), "OM liberada para execução.")}>Liberar para execução</Btn>}
                  <Btn size="sm" variant="danger" onClick={() => setCancelando(true)}>Cancelar OM</Btn>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[["Tipo", om.tipo], ["Localização", om.localizacao], ["Equipe", om.equipe], ["Executante", om.executante_nome], ["HH previsto", `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(om.hh_previsto) || 0)} h`], ["Programada", dataBr(om.data_programada)], ["Término previsto", dataBr(om.data_fim_programada)], ["Plano de manutenção", om.plano_descricao], ["Apropriado por", om.apontamentos?.find((entry) => entry.tipo === "Apropriação")?.usuario_nome]].map(([k, v]) => (
                <div key={k}><div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k === "Equipe" && <ThemeIcon name="worker" className="h-4 w-4" />}{k === "Programada" && <ThemeIcon name="calendar" className="h-4 w-4" />}{k}</div><div className="mt-0.5 text-sm text-slate-700">{v || "—"}</div></div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Planejamento técnico</div><Badge tone={om.planejamento_pronto ? "emerald" : "amber"}>{om.planejamento_pronto ? "Pronto" : "Pendente"}</Badge></div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{om.escopo_tecnico || "Defina o escopo, as tarefas, os recursos e os requisitos antes de liberar a execução."}</p>
              {(om.tarefas_planejadas || []).length > 0 && <ul className="mt-2 list-inside list-disc text-xs text-slate-600">{om.tarefas_planejadas.map((task, index) => <li key={index}>{task.descricao}{task.criterio ? ` — ${task.criterio}` : ""}</li>)}</ul>}
              {(om.materiais_planejados || []).length > 0 && <p className="mt-2 text-xs text-slate-600">Materiais planejados: {om.materiais_planejados.map((item) => `${item.descricao} (${item.quantidade} ${item.unidade}; ${item.disponibilidade})`).join("; ")}</p>}
            </div>
            {om.apontamentos?.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Registros de execução</div>
              <div className="space-y-1.5">
                {om.apontamentos.map((entry) => <div key={entry.id} className="flex flex-wrap justify-between gap-2 text-sm text-slate-600"><span>{entry.tipo}{entry.usuario_nome ? ` · ${entry.usuario_nome}` : ""}</span><span className="text-xs text-slate-400">{entry.tipo === "Apropriação" ? `${entry.hh_apropriado} h · ` : ""}{entry.data ? dateTimeBr(entry.data) : ""}</span></div>)}
              </div>
            </div>}
          </Card>

          {(om.execucao || om.intercorrencias?.length > 0) && <Card className="space-y-3 p-5">
            <div className="font-semibold text-slate-800">Execução em campo</div>
            {om.execucao && <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[["Início", om.execucao.iniciado_em], ["Fim", om.execucao.finalizado_em || "Em andamento"], ["Executantes", om.execucao.num_executantes],
                ["HH cronometrado", om.execucao.hh_calculado == null ? null : `${om.execucao.hh_calculado} h`]].map(([k, v]) => (
                <div key={k}><div className="text-xs font-semibold text-slate-400">{k}</div><div className="text-slate-700">{v || "—"}</div></div>
              ))}
            </div>}
            {om.execucao?.executantes?.length > 0 && <p className="text-sm text-slate-600"><span className="font-semibold">Nomes:</span> {om.execucao.executantes.join(", ")}</p>}
            {om.intercorrencias?.length > 0 && <div className="border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Intercorrências</div>
              <div className="space-y-2">
                {om.intercorrencias.map((item) => <div key={item.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2"><Badge tone="amber">{item.tipo}</Badge><span className="text-xs text-slate-500">{item.usuario_nome} · {item.registrado_em ? dateTimeBr(item.registrado_em) : "—"}</span></div>
                  <p className="mt-1 whitespace-pre-wrap">{item.descricao}</p>
                </div>)}
              </div>
            </div>}
          </Card>}

          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2 font-semibold text-slate-800"><ThemeIcon name="shield-check" className="h-5 w-5" /> Permissão de trabalho</div>
            <PermissaoOM ordem={om} podeConfigurar={podeGerir} onChanged={() => carregarOm(om.id)} />
          </Card>

          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2 font-semibold text-slate-800"><ThemeIcon name="checklist" className="h-5 w-5" /> Checklists e formulários</div>
            <ChecklistsOM ordem={om} podePreencher={podeGerir} podeVincular={podeGerir} onChanged={() => { carregarLista(); carregarOm(om.id); }} />
          </Card>

          {om.relatorio && <Card className="space-y-3 p-5">
            <div className="font-semibold text-slate-800">Relatório do executante</div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{om.relatorio.atividade_realizada}</p>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div><div className="text-xs font-semibold text-slate-400">Resultado</div><div className="text-slate-700">{om.relatorio.resultado || "—"}</div></div>
              <div><div className="text-xs font-semibold text-slate-400">Materiais</div><div className="text-slate-700">{om.relatorio.materiais_utilizados || "—"}</div></div>
              <div><div className="text-xs font-semibold text-slate-400">Observações</div><div className="text-slate-700">{om.relatorio.observacoes || "—"}</div></div>
              <div><div className="text-xs font-semibold text-slate-400">Causa / solução</div><div className="text-slate-700">{om.relatorio.causa_falha || "—"} / {om.relatorio.solucao_aplicada || "—"}</div></div>
              <div><div className="text-xs font-semibold text-slate-400">Condição final do ativo</div><div className="text-slate-700">{om.relatorio.condicao_final_ativo || "—"}</div></div>
              <div><div className="text-xs font-semibold text-slate-400">Testado / apto a retornar</div><div className="text-slate-700">{om.relatorio.equipamento_testado == null ? "—" : `${om.relatorio.equipamento_testado ? "Sim" : "Não"} / ${om.relatorio.apto_retorno_operacao == null ? "não informado" : om.relatorio.apto_retorno_operacao ? "Sim" : "Não"}`}</div></div>
            </div>
            {(om.relatorio.tarefas_executadas || []).length > 0 && <div><div className="text-xs font-semibold text-slate-400">Tarefas executadas</div><ul className="mt-1 list-inside list-disc text-sm text-slate-700">{om.relatorio.tarefas_executadas.map((task, index) => <li key={index}>{task.descricao}: {task.resultado}</li>)}</ul></div>}
            {(om.relatorio.materiais_estruturados || []).length > 0 && <div><div className="text-xs font-semibold text-slate-400">Materiais utilizados</div><ul className="mt-1 list-inside list-disc text-sm text-slate-700">{om.relatorio.materiais_estruturados.map((item, index) => <li key={index}>{item.descricao} — {item.quantidade} {item.unidade}</li>)}</ul></div>}
            {(om.relatorio.medicoes_testes || []).length > 0 && <div><div className="text-xs font-semibold text-slate-400">Medições e testes</div><ul className="mt-1 list-inside list-disc text-sm text-slate-700">{om.relatorio.medicoes_testes.map((item, index) => <li key={index}>{item.descricao}: {item.valor} {item.unidade} · {item.resultado}</li>)}</ul></div>}
          </Card>}

          {evidenceImages.length > 0 && <Card className="p-5">
            <div className="mb-3 font-semibold text-slate-800">Fotos da execução</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {evidenceImages.map((image) => <figure key={image.id} className="overflow-hidden rounded-lg border border-slate-200"><img src={image.url} alt={`Evidência ${image.nome_arquivo}`} className="aspect-video w-full object-cover" /><figcaption className="truncate px-2 py-1.5 text-xs text-slate-500">{image.nome_arquivo}</figcaption></figure>)}
            </div>
          </Card>}

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-slate-800"><ThemeIcon name="list-check" className="h-5 w-5" /> Validação e encerramento administrativo</div>
              <span className="text-xs text-slate-400">{cond.filter((c) => c.ok).length}/{cond.length} condições</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">A conclusão técnica segue para validação; somente CCM pode aprovar o encerramento administrativo.</p>
            <div className="mt-3 divide-y divide-slate-50">
              {cond.map((x) => (
                <div key={x.tipo} className="flex items-center gap-3 py-2">
                  {x.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                  <span className={`text-sm ${x.ok ? "text-slate-700" : "text-slate-400"}`}>{LABEL[x.tipo]}</span>
                  {x.ok && <Check className="ml-auto h-4 w-4 text-emerald-600" />}
                </div>
              ))}
            </div>
            {om.status === "Encerrada"
              ? <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" /> Ordem encerrada em {om.data_encerramento || "—"}.</div>
              : om.status === "Aguardando validação" && podeValidar
                ? <div className="mt-3 flex flex-wrap gap-2"><Btn className="flex-1" disabled={!requisitosTecnicosCompletos || !validacaoPendente} onClick={() => workflowAction(() => api.validarOrdem(om.id), "OM validada e encerrada.")}>Aprovar e encerrar</Btn><Btn variant="ghost" onClick={() => setDevolvendo(true)}>Devolver para correção</Btn></div>
                : <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">{om.status === "Aguardando validação" ? "Aguardando validação administrativa do CCM." : om.status === "Devolvida para ajuste" ? "OM devolvida para correção e novo encaminhamento." : "A OM será encerrada somente após conclusão técnica e aprovação administrativa."}</div>}
          </Card>
          {(om.historico_status?.length > 0 || om.historico_reprogramacao?.length > 0 || om.impedimentos?.length > 0) && <Card className="space-y-3 p-5">
            <div className="font-semibold text-slate-800">Rastreabilidade da OM</div>
            {om.historico_status?.length > 0 && <ol className="space-y-2">{om.historico_status.map((item) => <li key={item.id} className="border-l-2 border-indigo-200 pl-3 text-sm"><div className="font-medium text-slate-700">{item.status_anterior || "Criada"} → {item.status_novo}</div><div className="text-xs text-slate-500">{item.usuario_nome} · {item.data_hora}{item.justificativa ? ` · ${item.justificativa}` : ""}</div></li>)}</ol>}
            {om.impedimentos?.map((item) => <div key={`imp-${item.id}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><strong>{item.tipo}</strong> · {item.descricao}<div className="mt-1 text-xs text-slate-500">{item.registrado_por_nome} · {item.registrado_em}{item.resolucao ? ` · Resolução: ${item.resolucao}` : ""}</div>{podeGerir && !item.resolvido_em && om.status === "Bloqueada" && <Btn size="sm" variant="ghost" className="mt-2" onClick={() => {
              const resolution = window.prompt("Descreva como o impedimento foi resolvido (mínimo 5 caracteres).");
              if (resolution) workflowAction(() => api.resolverImpedimento(om.id, item.id, resolution), "Impedimento resolvido; OM retomada.");
            }}>Resolver impedimento</Btn>}</div>)}
            {om.historico_reprogramacao?.map((item) => <div key={`reprog-${item.id}`} className="text-xs text-slate-500">Reprogramação: {dataBr(item.data_programada_anterior)} → {dataBr(item.data_programada_nova)} · {item.justificativa} · {item.usuario_nome}</div>)}
          </Card>}
        </>)}
      </div>

      {programando && om && <ProgramarModal om={om} planos={planos} onClose={() => setProgramando(false)}
        onSaved={async () => { setProgramando(false); toast.success("Programação da OM salva."); await carregarLista(); await carregarOm(om.id); }} />}
      {planejando && om && <PlanejamentoOM om={om} onClose={() => setPlanejando(false)}
        onSaved={async () => { setPlanejando(false); toast.success("Planejamento salvo."); await carregarLista(); await carregarOm(om.id); }} />}
      {devolvendo && om && <DevolverModal om={om} onClose={() => setDevolvendo(false)}
        onSaved={async (justificativa) => {
          try {
            await api.devolverOrdem(om.id, justificativa);
            toast.success("OM devolvida para correção.");
            setDevolvendo(false);
            await carregarLista();
            await carregarOm(om.id);
          } catch (error) {
            toast.error(error.message);
            throw error;
          }
        }} />}
      {cancelando && om && <CancelarModal om={om} onClose={() => setCancelando(false)}
        onSaved={async (justificativa) => {
          await api.statusOrdem(om.id, "Cancelada", undefined, justificativa);
          toast.success("OM cancelada com justificativa registrada.");
          setCancelando(false);
          await carregarLista();
          await carregarOm(om.id);
        }} />}
    </div>
  );
}

function CancelarModal({ om, onClose, onSaved }) {
  const [justificativa, setJustificativa] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try { await onSaved(justificativa); }
    catch (error) { setErro(error.message); setSalvando(false); }
  };
  return (
    <Modal title={`Cancelar OM ${om.numero}`} subtitle="O cancelamento é rastreável e exige justificativa." onClose={onClose}>
      <form onSubmit={salvar} className="space-y-4">
        <label className="block"><span className="text-xs font-semibold text-slate-500">Motivo do cancelamento (mínimo 10 caracteres)</span><textarea required minLength={10} maxLength={1000} autoFocus rows={4} className={`mt-1 resize-y ${inputCls}`} value={justificativa} onChange={(event) => setJustificativa(event.target.value)} /></label>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onClose}>Manter OM</Btn><Btn type="submit" variant="danger" disabled={salvando || justificativa.trim().length < 10}>{salvando ? "Cancelando…" : "Confirmar cancelamento"}</Btn></div>
      </form>
    </Modal>
  );
}

function ProgramarModal({ om, planos, onClose, onSaved }) {
  const [values, setValues] = useState({
    hh_previsto: String(om.hh_previsto || 4),
    data_programada: isIsoDate(om.data_programada) ? om.data_programada : "",
    data_fim_programada: isIsoDate(om.data_fim_programada) ? om.data_fim_programada : "",
    plano_id: om.plano_id ? String(om.plano_id) : "",
    justificativa: "",
  });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Planos do mesmo equipamento da OM aparecem primeiro.
  const doEquipamento = planos.filter((plano) => plano.equipamento_id === om.equipamento_id);
  const outros = planos.filter((plano) => plano.equipamento_id !== om.equipamento_id);
  const opcao = (plano) => <option key={plano.id} value={plano.id}>{plano.descricao}{plano.periodicidade ? ` · ${plano.periodicidade}` : ""}{plano.equipamento ? ` · ${plano.equipamento}` : ""}</option>;
  const alterandoDatas = Boolean(om.data_programada) && (values.data_programada !== om.data_programada || (values.data_fim_programada || null) !== (om.data_fim_programada || null));

  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      await api.programarOrdem(om.id, values);
      await onSaved();
    } catch (e) {
      setErro(e.message);
      setSalvando(false);
    }
  };

  return (
    <Modal title={`Programar OM ${om.numero}`} subtitle={`${om.equipamento || "Sem equipamento"} · ${om.tipo}`} onClose={onClose} className="max-w-lg">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Data programada</span>
            <input type="date" required autoFocus className={`mt-1 ${inputCls}`} value={values.data_programada}
              onChange={(event) => setValues((previous) => ({ ...previous, data_programada: event.target.value, data_fim_programada: previous.data_fim_programada && previous.data_fim_programada < event.target.value ? event.target.value : previous.data_fim_programada }))} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Término previsto (opcional)</span>
            <input type="date" min={values.data_programada} className={`mt-1 ${inputCls}`} value={values.data_fim_programada}
              onChange={(event) => setValues((previous) => ({ ...previous, data_fim_programada: event.target.value }))} />
          </label>
        </div>
        {om.data_programada && !isIsoDate(om.data_programada) && <p className="text-xs text-slate-500">Data anterior registrada: {om.data_programada}.</p>}
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Plano de manutenção</span>
          <select className={`mt-1 ${inputCls}`} value={values.plano_id} onChange={(event) => setValues((previous) => ({ ...previous, plano_id: event.target.value }))}>
            <option value="">Sem plano vinculado</option>
            {doEquipamento.length > 0 && <optgroup label={`Planos de ${om.equipamento}`}>{doEquipamento.map(opcao)}</optgroup>}
            {outros.length > 0 && <optgroup label="Outros planos">{outros.map(opcao)}</optgroup>}
          </select>
        </label>
        {!planos.length && <p className="text-xs text-slate-500">Nenhum plano cadastrado. Os planos são criados em Cadastros › Planos preventivos (perfil CCM).</p>}
        {alterandoDatas && <label className="block"><span className="text-xs font-semibold text-slate-500">Justificativa da reprogramação (mínimo 10 caracteres)</span><textarea required minLength={10} maxLength={1000} rows={3} className={`mt-1 resize-y ${inputCls}`} value={values.justificativa} onChange={(event) => setValues((previous) => ({ ...previous, justificativa: event.target.value }))} /></label>}
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={salvando || !values.data_programada || (alterandoDatas && values.justificativa.trim().length < 10)}>{salvando ? "Salvando…" : "Salvar programação"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PlanejamentoOM({ om, onClose, onSaved }) {
  const [values, setValues] = useState({
    escopo: om.escopo_tecnico || "",
    especialidades: om.especialidades || "",
    ferramentas: om.ferramentas || "",
    procedimentos: om.procedimentos || "",
    requisitos_seguranca: om.requisitos_seguranca || "",
    criterios_aceitacao: om.criterios_aceitacao || "",
    pronto: om.planejamento_pronto || false,
    tarefas: om.tarefas_planejadas?.length ? om.tarefas_planejadas : [{ descricao: "", criterio: "" }],
    materiais: om.materiais_planejados || [],
  });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const setField = (key) => (event) => setValues((old) => ({ ...old, [key]: event.target.value }));
  const updateRow = (field, index, key, value) => setValues((old) => ({
    ...old, [field]: old[field].map((row, position) => position === index ? { ...row, [key]: value } : row),
  }));
  const addRow = (field, row) => setValues((old) => ({ ...old, [field]: [...old[field], row] }));
  const removeRow = (field, index) => setValues((old) => ({ ...old, [field]: old[field].filter((_, position) => position !== index) }));

  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      await api.salvarPlanejamentoOrdem(om.id, values);
      await onSaved();
    } catch (error) {
      setErro(error.message);
      setSalvando(false);
    }
  };

  return (
    <Modal title={`Planejar OM ${om.numero}`} subtitle={`${om.equipamento || "Sem equipamento"} · registre dados verificáveis, sem presumir disponibilidade de estoque.`} onClose={onClose} className="max-w-3xl">
      <form onSubmit={salvar} className="space-y-4">
        <label className="block"><span className="text-xs font-semibold text-slate-500">Estimativa de mão de obra (HH)</span><input type="number" required min="0.01" step="0.01" max="100000" className={`mt-1 ${inputCls}`} value={values.hh_previsto} onChange={setField("hh_previsto")} /></label>
        {[["escopo", "Escopo técnico"], ["especialidades", "Especialidades / equipe necessária"], ["ferramentas", "Ferramentas e recursos"], ["procedimentos", "Procedimentos e documentos técnicos"], ["requisitos_seguranca", "Requisitos de segurança"], ["criterios_aceitacao", "Critérios de aceitação"]].map(([key, label]) => (
          <label key={key} className="block">
            <span className="text-xs font-semibold text-slate-500">{label}</span>
            <textarea rows={key === "escopo" || key === "requisitos_seguranca" ? 3 : 2} maxLength={4000} className={`mt-1 resize-y ${inputCls}`} value={values[key]} onChange={setField(key)} />
          </label>
        ))}
        <div className="space-y-2">
          <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-700">Tarefas planejadas</h4><Btn type="button" size="sm" variant="ghost" onClick={() => addRow("tarefas", { descricao: "", criterio: "" })}>Adicionar tarefa</Btn></div>
          {values.tarefas.map((task, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto]">
            <input required={values.pronto} maxLength={500} className={inputCls} aria-label={`Descrição da tarefa ${index + 1}`} placeholder="Tarefa" value={task.descricao} onChange={(event) => updateRow("tarefas", index, "descricao", event.target.value)} />
            <input maxLength={500} className={inputCls} aria-label={`Critério da tarefa ${index + 1}`} placeholder="Critério / resultado esperado" value={task.criterio} onChange={(event) => updateRow("tarefas", index, "criterio", event.target.value)} />
            <Btn type="button" variant="danger" size="sm" disabled={values.tarefas.length === 1} onClick={() => removeRow("tarefas", index)}>Remover</Btn>
          </div>)}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-700">Materiais planejados</h4><Btn type="button" size="sm" variant="ghost" onClick={() => addRow("materiais", { descricao: "", quantidade: 1, unidade: "un", disponibilidade: "A verificar" })}>Adicionar material</Btn></div>
          {!values.materiais.length && <p className="text-xs text-slate-500">Nenhum material planejado. Este sistema não consulta estoque.</p>}
          {values.materiais.map((item, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
            <input maxLength={300} className={inputCls} aria-label={`Descrição do material ${index + 1}`} placeholder="Descrição" value={item.descricao} onChange={(event) => updateRow("materiais", index, "descricao", event.target.value)} />
            <div className="flex gap-2"><input type="number" min="0.01" step="any" className={`${inputCls} w-28`} aria-label={`Quantidade do material ${index + 1}`} value={item.quantidade} onChange={(event) => updateRow("materiais", index, "quantidade", event.target.value)} /><input maxLength={30} className={inputCls} aria-label={`Unidade do material ${index + 1}`} placeholder="Unidade" value={item.unidade} onChange={(event) => updateRow("materiais", index, "unidade", event.target.value)} /></div>
            <select className={inputCls} aria-label={`Disponibilidade do material ${index + 1}`} value={item.disponibilidade || "A verificar"} onChange={(event) => updateRow("materiais", index, "disponibilidade", event.target.value)}>
              {["A verificar", "Disponível", "Indisponível", "Compra/contratação necessária"].map((choice) => <option key={choice}>{choice}</option>)}
            </select>
            <Btn type="button" variant="danger" size="sm" onClick={() => removeRow("materiais", index)}>Remover material</Btn>
          </div>)}
        </div>
        <label className="flex items-start gap-2 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
          <input type="checkbox" checked={values.pronto} onChange={(event) => setValues((old) => ({ ...old, pronto: event.target.checked }))} />
          Marcar planejamento como pronto para liberar a execução. Requer escopo, especialidades, tarefa, segurança e critério de aceitação.
        </label>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn><Btn type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar planejamento"}</Btn></div>
      </form>
    </Modal>
  );
}

function DevolverModal({ om, onClose, onSaved }) {
  const [justificativa, setJustificativa] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try { await onSaved(justificativa); } catch (error) { setErro(error.message); setSalvando(false); }
  };
  return (
    <Modal title={`Devolver OM ${om.numero}`} subtitle="A devolução exige justificativa e ficará no histórico da ordem." onClose={onClose}>
      <form onSubmit={salvar} className="space-y-4">
        <label className="block"><span className="text-xs font-semibold text-slate-500">Motivo da devolução (mínimo 10 caracteres)</span><textarea required minLength={10} maxLength={2000} autoFocus rows={4} className={`mt-1 resize-y ${inputCls}`} value={justificativa} onChange={(event) => setJustificativa(event.target.value)} /></label>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn><Btn type="submit" variant="danger" disabled={salvando || justificativa.trim().length < 10}>{salvando ? "Devolvendo…" : "Confirmar devolução"}</Btn></div>
      </form>
    </Modal>
  );
}
