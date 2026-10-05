import React, { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Circle, CloudUpload, MinusCircle, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Badge, Btn, Card, Modal, Spinner, inputCls, ErrorState } from "../components/ui.jsx";
import { useNoticeToast } from "../components/toast.jsx";
import { FillForm, ResponseView, dateTimeBr } from "../components/FormRenderer.jsx";
import { FILA_SINCRONIZADA, usePendencias } from "../offline/fila.js";

const STATUS_ICON = {
  Pendente: <Circle className="h-4 w-4 text-slate-300" />,
  Inspecionado: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  "Não inspecionado": <MinusCircle className="h-4 w-4 text-rose-600" />,
};

export default function Inspecoes() {
  const { user } = useAuth();
  const manager = user.papel !== "EXECUTANTE";
  const [tab, setTab] = useState("rondas");
  const [roundId, setRoundId] = useState(null);

  if (roundId) return <Ronda id={roundId} onBack={() => setRoundId(null)} />;
  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="Inspeções">
        {[["rondas", manager ? "Rondas" : "Minhas rondas"], ...(manager ? [["rotas", "Rotas de inspeção"]] : [])].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{label}</button>
        ))}
      </div>
      {tab === "rondas" ? <Rondas onOpen={setRoundId} /> : <Rotas />}
    </div>
  );
}

// ------------------------------------------------------------------ Rondas
function Rondas({ onOpen }) {
  const [routes, setRoutes] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api.rotasInspecao(), api.rondasInspecao()]).then(([routeList, roundList]) => { setRoutes(routeList); setRounds(roundList); }).catch((e) => setError(e.message));
  }, []);

  const start = async (route) => {
    setError("");
    try { onOpen((await api.iniciarRonda(route.id)).id); } catch (e) { setError(e.message); }
  };
  if (!routes) return error ? <ErrorState message={error} /> : <Spinner />;

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-5">
      <Card className="xl:col-span-2">
        <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">Iniciar ronda</div>
        {error && <div role="alert" className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <ul className="divide-y divide-slate-50">
          {routes.map((route) => (
            <li key={route.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800">{route.nome}</div>
                <div className="text-xs text-slate-500">{route.pontos} ponto(s){route.area ? ` · ${route.area}` : ""}{route.ultima_ronda ? ` · última ronda ${dateTimeBr(route.ultima_ronda)}` : ""}</div>
              </div>
              <Btn size="sm" onClick={() => start(route)}><Play className="h-3.5 w-3.5" /> Iniciar</Btn>
            </li>
          ))}
          {!routes.length && <li className="px-5 py-10 text-center text-sm text-slate-400">Nenhuma rota de inspeção ativa.</li>}
        </ul>
      </Card>

      <Card className="xl:col-span-3">
        <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">Rondas registradas</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-semibold">Rota</th>
                <th className="px-5 py-3 font-semibold">Executor</th>
                <th className="px-5 py-3 font-semibold">Progresso</th>
                <th className="px-5 py-3 font-semibold">Desvios</th>
                <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((round) => (
                <tr key={round.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3"><div className="font-semibold text-slate-800">{round.rota_nome}</div><div className="text-xs text-slate-400">{dateTimeBr(round.iniciada_em)}</div></td>
                  <td className="px-5 py-3 text-slate-600">{round.usuario_nome}</td>
                  <td className="px-5 py-3"><Badge tone={round.status === "Concluída" ? "emerald" : "indigo"}>{round.status}</Badge> <span className="ml-1 text-xs tabular-nums text-slate-500">{round.pontos_feitos}/{round.pontos}</span></td>
                  <td className="px-5 py-3">{round.desvios ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {round.desvios}</span> : <span className="text-xs text-slate-400">Nenhum</span>}</td>
                  <td className="px-5 py-2 text-right"><Btn size="sm" variant="ghost" onClick={() => onOpen(round.id)}>{round.status === "Em andamento" ? "Continuar" : "Ver"}</Btn></td>
                </tr>
              ))}
              {!rounds.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">Nenhuma ronda registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Ronda({ id, onBack }) {
  const { user } = useAuth();
  const [round, setRound] = useState(null);
  const [current, setCurrent] = useState(null);
  const [skipping, setSkipping] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [observacao, setObservacao] = useState("");
  const setNotice = useNoticeToast();
  const [error, setError] = useState("");
  // Pontos inspecionados sem conexão (na fila local, ainda não sincronizados).
  const queued = new Set(usePendencias(user.id).filter((item) => item.tipo === "ponto_ronda" && item.meta.ronda_id === id).map((item) => item.meta.ponto_id));

  const load = () => api.rondaInspecao(id).then((result) => {
    setRound(result);
    setCurrent(null);
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    window.addEventListener(FILA_SINCRONIZADA, load);
    return () => window.removeEventListener(FILA_SINCRONIZADA, load);
  }, [id]);

  if (!round) return error ? <ErrorState message={error} /> : <Spinner />;
  const mine = round.usuario_id === user.id && round.status === "Em andamento";
  const done = round.pontos.filter((point) => point.status !== "Pendente" || queued.has(point.id)).length;
  // Guia: o ponto escolhido ou o próximo pendente na sequência da rota.
  const open = round.pontos.filter((item) => item.status === "Pendente" && !queued.has(item.id));
  const point = open.find((item) => item.id === current) || open[0];
  const conclude = async () => {
    setError("");
    try { const result = await api.concluirRonda(id, observacao); setNotice(`Ronda concluída com ${result.desvios} desvio(s).`); load(); } catch (e) { setError(e.message); }
  };
  const openNote = async (desvio) => {
    setError("");
    try {
      const note = await api.criarNota({ equipamento_id: desvio.equipamento_id, tipo: "Corretiva", descricao: `Ronda "${round.rota_nome}" · ponto ${desvio.sequencia}: ${desvio.tipo} — ${desvio.descricao}` });
      setNotice(`Nota ${note.numero} aberta para ${desvio.equipamento}.`);
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Voltar às rondas</button>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{round.rota_nome}</h2>
          <p className="text-sm text-slate-500">{round.usuario_nome} · iniciada em {dateTimeBr(round.iniciada_em)}{round.concluida_em ? ` · concluída em ${dateTimeBr(round.concluida_em)}` : ""}</p>
        </div>
        <Badge tone={round.status === "Concluída" ? "emerald" : "indigo"}>{round.status}</Badge>
      </header>
      <div>
        <div className="flex justify-between text-xs text-slate-500"><span>{done} de {round.pontos.length} ponto(s)</span><span>{round.desvios.length} desvio(s)</span></div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${(done / round.pontos.length) * 100}%` }} /></div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <ol className="divide-y divide-slate-50">
            {round.pontos.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => (item.status === "Pendente" ? setCurrent(item.id) : item.resposta_id && setViewing(item))}
                  className={`flex w-full items-start gap-3 px-5 py-3 text-left transition-colors ${item.id === point?.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                  <span className="mt-0.5">{queued.has(item.id) ? <CloudUpload className="h-4 w-4 text-amber-600" /> : STATUS_ICON[item.status]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">{item.sequencia}. <span className="font-mono">{item.equipamento}</span></span>
                    <span className="block truncate text-xs text-slate-500">{item.modelo_nome}{item.localizacao ? ` · ${item.localizacao}` : ""}</span>
                    {queued.has(item.id) && <span className="block text-xs font-semibold text-amber-700">Inspecionado sem conexão · aguardando sincronização</span>}
                    {item.status === "Não inspecionado" && <span className="block text-xs text-rose-700">{item.motivo}</span>}
                    {item.nao_conformidades.length > 0 && <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" /> {item.nao_conformidades.length} não conformidade(s)</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-4 xl:col-span-3">
          {mine && point && <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ponto {point.sequencia} de {round.pontos.length}</div>
                <h3 className="mt-0.5 font-semibold text-slate-900"><span className="font-mono">{point.equipamento}</span> · {point.equipamento_descricao}</h3>
              </div>
              <Btn size="sm" variant="ghost" onClick={() => setSkipping(true)}>Não foi possível inspecionar</Btn>
            </div>
            {point.instrucao && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{point.instrucao}</p>}
            <div className="mt-4">
              <FillForm key={point.id} modeloId={point.modelo_id}
                submit={(dados, files) => api.responderPontoRonda(id, point.id, dados.respostas, files, `${round.rota_nome} · ponto ${point.sequencia}`)}
                onDone={(result) => {
                  if (result?.offline) { setNotice("Sem conexão: ponto salvo neste aparelho. Siga para o próximo; o envio é automático ao reconectar."); setCurrent(null); return; }
                  setNotice("Ponto registrado."); load();
                }} />
            </div>
          </Card>}

          {mine && !point && queued.size > 0 && <Card className="p-5 text-sm text-amber-800"><CloudUpload className="mr-1 inline h-4 w-4" /> {queued.size} ponto(s) aguardando sincronização. Conclua a ronda depois de reconectar.</Card>}

          {mine && !point && queued.size === 0 && <Card className="space-y-3 p-5">
            <h3 className="font-semibold text-slate-800">Todos os pontos registrados</h3>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Observação final (opcional)</span>
              <textarea rows={2} maxLength={1000} className={`mt-1 resize-y ${inputCls}`} value={observacao} onChange={(event) => setObservacao(event.target.value)} />
            </label>
            <Btn onClick={conclude}>Concluir ronda</Btn>
          </Card>}

          {(round.status === "Concluída" || round.desvios.length > 0) && <Card>
            <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">Desvios encontrados ({round.desvios.length})</div>
            {round.observacao && <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-600">{round.observacao}</p>}
            <ul className="divide-y divide-slate-50">
              {round.desvios.map((desvio, index) => (
                <li key={`${desvio.ponto_id}-${index}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 text-sm">
                    <div className="flex items-center gap-2"><Badge tone={desvio.tipo === "Não conformidade" ? "amber" : "rose"}>{desvio.tipo}</Badge><span className="font-mono text-xs text-slate-500">{desvio.sequencia}. {desvio.equipamento}</span></div>
                    <p className="mt-1 text-slate-700">{desvio.descricao}</p>
                  </div>
                  {desvio.equipamento_id && <Btn size="sm" variant="ghost" onClick={() => openNote(desvio)}>Abrir nota</Btn>}
                </li>
              ))}
              {!round.desvios.length && <li className="px-5 py-8 text-center text-sm text-emerald-700">Nenhum desvio nesta ronda.</li>}
            </ul>
          </Card>}
        </div>
      </div>

      {skipping && point && <SkipModal point={point} onClose={() => setSkipping(false)}
        onConfirm={async (motivo) => { await api.pularPontoRonda(id, point.id, motivo); setSkipping(false); load(); }} />}
      {viewing && <Modal title={`Ponto ${viewing.sequencia} · ${viewing.equipamento}`} onClose={() => setViewing(null)} className="max-w-2xl">
        <div className="max-h-[70vh] overflow-y-auto pr-1"><ResponseView id={viewing.resposta_id} /></div>
      </Modal>}
    </div>
  );
}

function SkipModal({ point, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title="Ponto não inspecionado" subtitle={`${point.sequencia}. ${point.equipamento} — fica registrado como desvio.`} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={!motivo.trim()} onClick={() => onConfirm(motivo).catch((e) => setError(e.message))}>Registrar</Btn></>}>
      <label className="block">
        <span className="text-xs font-semibold text-slate-500">Motivo</span>
        <textarea autoFocus rows={3} maxLength={500} className={`mt-1 resize-y ${inputCls}`} placeholder="Ex.: área interditada, equipamento em operação crítica." value={motivo} onChange={(event) => setMotivo(event.target.value)} />
      </label>
      {error && <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    </Modal>
  );
}

// ------------------------------------------------------------------ Rotas (PCM/CCM)
function Rotas() {
  const [routes, setRoutes] = useState(null);
  const [editing, setEditing] = useState(null);
  const setNotice = useNoticeToast();
  const [error, setError] = useState("");
  const load = () => api.rotasInspecao(true).then(setRoutes).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (editing) return <RotaEditor initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("Rota salva."); load(); }} />;
  if (!routes) return error ? <ErrorState message={error} /> : <Spinner />;

  const edit = async (route) => { try { setEditing(await api.rotaInspecao(route.id)); } catch (e) { setError(e.message); } };
  const remove = async (route) => {
    if (!window.confirm(route.rondas ? `"${route.nome}" tem rondas e será desativada (o histórico é mantido). Continuar?` : `Excluir "${route.nome}"?`)) return;
    try { const result = await api.excluirRotaInspecao(route.id); setNotice(result.desativada ? "Rota desativada." : "Rota excluída."); load(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Sequência de pontos (equipamento + formulário) percorrida em cada ronda.</p>
        <Btn onClick={() => setEditing({ nome: "", area: "", descricao: "", pontos: [] })}><Plus className="h-4 w-4" /> Nova rota</Btn>
      </div>
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card>
        <ul className="divide-y divide-slate-50">
          {routes.map((route) => (
            <li key={route.id} className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 ${route.ativo ? "" : "opacity-60"}`}>
              <div>
                <div className="flex items-center gap-2 font-semibold text-slate-800">{route.nome}{!route.ativo && <Badge>Inativa</Badge>}</div>
                <div className="text-xs text-slate-500">{route.pontos} ponto(s) · {route.rondas} ronda(s){route.area ? ` · ${route.area}` : ""}</div>
              </div>
              <div className="flex gap-1">
                <button type="button" title="Editar" aria-label={`Editar ${route.nome}`} onClick={() => edit(route)} className="rounded-md p-2 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><Pencil className="h-4 w-4" /></button>
                {route.ativo && <button type="button" title="Excluir" aria-label={`Excluir ${route.nome}`} onClick={() => remove(route)} className="rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>}
              </div>
            </li>
          ))}
          {!routes.length && <li className="px-5 py-10 text-center text-sm text-slate-400">Nenhuma rota cadastrada.</li>}
        </ul>
      </Card>
    </div>
  );
}

function RotaEditor({ initial, onCancel, onSaved }) {
  const [route, setRoute] = useState(() => ({ ...initial, pontos: (initial.pontos || []).map((point) => ({ equipamento_id: String(point.equipamento_id), modelo_id: String(point.modelo_id), instrucao: point.instrucao || "" })) }));
  const [equipamentos, setEquipamentos] = useState([]);
  const [models, setModels] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api.cadastros(), api.formularioModelos()]).then(([catalogs, modelList]) => {
      setEquipamentos(catalogs.equipamentos);
      setModels(modelList.filter((model) => model.tipo !== "Permissão"));
    }).catch((e) => setError(e.message));
  }, []);
  const defaultModel = models.find((model) => model.tipo === "Inspeção") || models[0];
  const setPoint = (index, patch) => setRoute((previous) => ({ ...previous, pontos: previous.pontos.map((point, position) => (position === index ? { ...point, ...patch } : point)) }));
  const move = (index, delta) => setRoute((previous) => {
    const pontos = [...previous.pontos];
    const [item] = pontos.splice(index, 1);
    pontos.splice(index + delta, 0, item);
    return { ...previous, pontos };
  });

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { nome: route.nome, area: route.area, descricao: route.descricao, pontos: route.pontos };
      if (route.id) await api.salvarRotaInspecao(route.id, { ...payload, ativo: true }); else await api.criarRotaInspecao(payload);
      onSaved();
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-800">{route.id ? "Editar rota" : "Nova rota de inspeção"}</h2>
          <div className="flex gap-2"><Btn type="button" variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn type="submit" disabled={saving || !route.pontos.length}>{saving ? "Salvando…" : "Salvar rota"}</Btn></div>
        </div>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-2"><span className="text-xs font-semibold text-slate-500">Nome</span><input required maxLength={120} className={`mt-1 ${inputCls}`} value={route.nome} onChange={(event) => setRoute({ ...route, nome: event.target.value })} /></label>
          <label className="block"><span className="text-xs font-semibold text-slate-500">Área</span><input maxLength={120} className={`mt-1 ${inputCls}`} value={route.area || ""} onChange={(event) => setRoute({ ...route, area: event.target.value })} /></label>
        </div>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Descrição (opcional)</span><input maxLength={1000} className={`mt-1 ${inputCls}`} value={route.descricao || ""} onChange={(event) => setRoute({ ...route, descricao: event.target.value })} /></label>
        <p className="text-xs text-slate-400">Alterar a rota não muda rondas já iniciadas.</p>
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-semibold text-slate-800">Pontos da rota ({route.pontos.length})</h3>
        {route.pontos.map((point, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[2rem_1fr_1fr_auto] md:items-start">
            <span className="pt-2 text-sm font-semibold text-slate-400">{index + 1}.</span>
            <div className="space-y-2">
              <select required aria-label={`Equipamento do ponto ${index + 1}`} className={inputCls} value={point.equipamento_id} onChange={(event) => setPoint(index, { equipamento_id: event.target.value })}>
                <option value="">Equipamento</option>
                {equipamentos.map((item) => <option key={item.id} value={item.id}>{item.tag} · {item.descricao}</option>)}
              </select>
              <select required aria-label={`Formulário do ponto ${index + 1}`} className={inputCls} value={point.modelo_id} onChange={(event) => setPoint(index, { modelo_id: event.target.value })}>
                <option value="">Formulário (checklist)</option>
                {models.map((model) => <option key={model.id} value={model.id}>{model.nome} ({model.tipo})</option>)}
              </select>
            </div>
            <textarea rows={3} maxLength={500} aria-label={`Instrução do ponto ${index + 1}`} className={`resize-y ${inputCls}`} placeholder="Instrução para o inspetor (opcional)" value={point.instrucao} onChange={(event) => setPoint(index, { instrucao: event.target.value })} />
            <div className="flex md:flex-col">
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Mover para cima" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" disabled={index === route.pontos.length - 1} onClick={() => move(index, 1)} aria-label="Mover para baixo" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" onClick={() => setRoute({ ...route, pontos: route.pontos.filter((_, position) => position !== index) })} aria-label="Remover ponto" className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
        <Btn type="button" variant="ghost" onClick={() => setRoute({ ...route, pontos: [...route.pontos, { equipamento_id: "", modelo_id: defaultModel ? String(defaultModel.id) : "", instrucao: "" }] })}><Plus className="h-4 w-4" /> Adicionar ponto</Btn>
      </Card>
    </form>
  );
}
