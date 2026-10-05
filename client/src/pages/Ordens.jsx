import React, { useEffect, useState } from "react";
import { CheckCircle2, Circle, Check } from "lucide-react";
import { api } from "../api.js";
import { Card, Badge, Btn, Modal, Spinner, statusTone, inputCls, dataBr, isIsoDate } from "../components/ui.jsx";
import { useAuth } from "../auth.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";
import ChecklistsOM from "../components/ChecklistsOM.jsx";

const LABEL = { "Apropriação": "Apropriação de mão de obra", "Relatório": "Relatório de execução", "Validação": "Validação do líder", Checklists: "Checklists obrigatórios respondidos" };

export default function Ordens() {
  const { user } = useAuth();
  const [lista, setLista] = useState(null);
  const [sel, setSel] = useState(null);
  const [om, setOm] = useState(null);
  const [evidenceImages, setEvidenceImages] = useState([]);
  const [executantes, setExecutantes] = useState([]);
  const [executanteId, setExecutanteId] = useState("");
  const [planos, setPlanos] = useState([]);
  const [programando, setProgramando] = useState(false);
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
    try { await api.statusOrdem(sel, status, responsavel_id); await carregarLista(); await carregarOm(sel); } catch (e) { setErro(e.message); }
  };

  if (erro) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{erro}</div>;
  if (!lista) return <Spinner />;

  const podeGerir = user.papel === "CCM" || user.papel === "PCM";
  const cond = om?.condicoes || [];
  const completa = cond.length > 0 && cond.every((c) => c.ok);

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
              <Badge tone={statusTone(o.status)}>{o.status}</Badge>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-4 lg:col-span-3">
        {!om ? <Spinner /> : (<>
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-xl font-bold text-slate-900">OM {om.numero}</div>
                <div className="mt-1 flex items-center gap-2"><Badge tone={statusTone(om.status)}>{om.status}</Badge><span className="font-mono text-xs text-slate-500">{om.equipamento}</span></div>
              </div>
              {podeGerir && om.status !== "Encerrada" && (
                <div className="flex flex-col items-end gap-2 sm:flex-row">
                  <select aria-label="Executante responsável" className={`${inputCls} min-w-48`} value={executanteId} onChange={(event) => setExecutanteId(event.target.value)}>
                    <option value="">Selecione o executante</option>
                    {executantes.map((person) => <option key={person.id} value={person.id}>{person.nome} · {person.username}</option>)}
                  </select>
                  <Btn size="sm" variant="ghost" onClick={() => setProgramando(true)}>{isIsoDate(om.data_programada) ? "Reprogramar" : "Programar"}</Btn>
                  <Btn size="sm" disabled={!executanteId} onClick={() => acao("Distribuída", Number(executanteId))}>Distribuir</Btn>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[["Tipo", om.tipo], ["Equipe", om.equipe], ["Executante", om.executante_nome], ["HH previsto", `${om.hh_previsto},0 h`], ["Programada", dataBr(om.data_programada)], ["Término previsto", dataBr(om.data_fim_programada)], ["Plano de manutenção", om.plano_descricao], ["Apropriado por", om.apontamentos?.find((entry) => entry.tipo === "Apropriação")?.usuario_nome]].map(([k, v]) => (
                <div key={k}><div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k === "Equipe" && <ThemeIcon name="worker" className="h-4 w-4" />}{k === "Programada" && <ThemeIcon name="calendar" className="h-4 w-4" />}{k}</div><div className="mt-0.5 text-sm text-slate-700">{v || "—"}</div></div>
              ))}
            </div>
            {om.apontamentos?.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Registros de execução</div>
              <div className="space-y-1.5">
                {om.apontamentos.map((entry) => <div key={entry.id} className="flex flex-wrap justify-between gap-2 text-sm text-slate-600"><span>{entry.tipo}{entry.usuario_nome ? ` · ${entry.usuario_nome}` : ""}</span><span className="text-xs text-slate-400">{entry.tipo === "Apropriação" ? `${entry.hh_apropriado} h · ` : ""}{entry.data}</span></div>)}
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
                  <div className="flex flex-wrap items-center justify-between gap-2"><Badge tone="amber">{item.tipo}</Badge><span className="text-xs text-slate-500">{item.usuario_nome} · {item.registrado_em}</span></div>
                  <p className="mt-1 whitespace-pre-wrap">{item.descricao}</p>
                </div>)}
              </div>
            </div>}
          </Card>}

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
            </div>
          </Card>}

          {evidenceImages.length > 0 && <Card className="p-5">
            <div className="mb-3 font-semibold text-slate-800">Fotos da execução</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {evidenceImages.map((image) => <figure key={image.id} className="overflow-hidden rounded-lg border border-slate-200"><img src={image.url} alt={`Evidência ${image.nome_arquivo}`} className="aspect-video w-full object-cover" /><figcaption className="truncate px-2 py-1.5 text-xs text-slate-500">{image.nome_arquivo}</figcaption></figure>)}
            </div>
          </Card>}

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-slate-800"><ThemeIcon name="list-check" className="h-5 w-5" /> Encerramento automático</div>
              <span className="text-xs text-slate-400">{cond.filter((c) => c.ok).length}/{cond.length} condições</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">Todas as condições liberam o encerramento da ordem.</p>
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
              : <Btn className="mt-3 w-full" disabled={!completa || !podeGerir} onClick={() => acao("Encerrada")}>{completa ? "Encerrar ordem" : "Aguardando as condições"}</Btn>}
          </Card>
        </>)}
      </div>

      {programando && om && <ProgramarModal om={om} planos={planos} onClose={() => setProgramando(false)}
        onSaved={async () => { setProgramando(false); await carregarLista(); await carregarOm(om.id); }} />}
    </div>
  );
}

function ProgramarModal({ om, planos, onClose, onSaved }) {
  const [values, setValues] = useState({
    data_programada: isIsoDate(om.data_programada) ? om.data_programada : "",
    data_fim_programada: isIsoDate(om.data_fim_programada) ? om.data_fim_programada : "",
    plano_id: om.plano_id ? String(om.plano_id) : "",
  });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Planos do mesmo equipamento da OM aparecem primeiro.
  const doEquipamento = planos.filter((plano) => plano.equipamento_id === om.equipamento_id);
  const outros = planos.filter((plano) => plano.equipamento_id !== om.equipamento_id);
  const opcao = (plano) => <option key={plano.id} value={plano.id}>{plano.descricao}{plano.periodicidade ? ` · ${plano.periodicidade}` : ""}{plano.equipamento ? ` · ${plano.equipamento}` : ""}</option>;

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
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={salvando || !values.data_programada}>{salvando ? "Salvando…" : "Salvar programação"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
