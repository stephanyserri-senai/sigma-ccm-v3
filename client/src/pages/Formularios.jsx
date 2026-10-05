import React, { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Badge, Btn, Card, Modal, Spinner, inputCls } from "../components/ui.jsx";
import { FIELD_TYPES, FillForm, FormRenderer, ResponseView, SIM_NAO, dateTimeBr } from "../components/FormRenderer.jsx";

const TIPOS_MODELO = ["Checklist", "Inspeção", "Permissão", "Formulário livre"];
const TIPOS_OM = ["Corretiva", "Preventiva", "Inspeção"];
const CLASSES = ["Bomba", "Motor", "Painel", "Correia", "Compressor", "Sensor", "Estrutura", "Outro"];
const EMPTY_MODEL = { nome: "", tipo: "Checklist", descricao: "", regras: { automatico: false, obrigatorio: false, tipos_om: [], classes_equipamento: [] }, campos: [] };
let sequence = 0;
const newId = () => `c${Date.now().toString(36)}${(sequence += 1).toString(36)}`;

export default function Formularios() {
  const { user } = useAuth();
  const isCcm = user.papel === "CCM";
  const tabs = [...(isCcm ? [["modelos", "Modelos (No-Code)"]] : []), ["preencher", "Preencher"], ["respostas", user.papel === "EXECUTANTE" ? "Minhas respostas" : "Respostas"]];
  const [tab, setTab] = useState(tabs[0][0]);

  return (
    <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Formulários">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "modelos" && <Modelos />}
      {tab === "preencher" && <Preencher />}
      {tab === "respostas" && <Respostas />}
    </div>
  );
}

// ------------------------------------------------------------------ Modelos
function Modelos() {
  const [models, setModels] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api.formularioModelos(true).then(setModels).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (editing) return <Construtor initial={editing} onCancel={() => setEditing(null)} onSaved={(message) => { setEditing(null); setNotice(message); load(); }} />;
  if (!models) return error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : <Spinner />;

  const remove = async (model) => {
    if (!window.confirm(model.respostas ? `"${model.nome}" tem respostas e será desativado (o histórico é mantido). Continuar?` : `Excluir "${model.nome}"?`)) return;
    setError(""); setNotice("");
    try { const result = await api.excluirFormularioModelo(model.id); setNotice(result.desativado ? "Formulário desativado." : "Formulário excluído."); load(); } catch (e) { setError(e.message); }
  };
  const reactivate = async (model) => {
    try { await api.salvarFormularioModelo(model.id, { ...model, ativo: true }); setNotice(`"${model.nome}" reativado.`); load(); } catch (e) { setError(e.message); }
  };
  const rulesText = (regras) => regras.automatico
    ? `Automático: ${regras.tipos_om?.length ? regras.tipos_om.join(", ") : "todos os tipos"} · ${regras.classes_equipamento?.length ? regras.classes_equipamento.join(", ") : "todas as classes"}${regras.obrigatorio ? " · obrigatório" : ""}`
    : "Só por vínculo manual";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Monte checklists, inspeções, permissões e formulários livres sem programar. Cada alteração gera uma nova versão.</p>
        <Btn onClick={() => setEditing(EMPTY_MODEL)}><Plus className="h-4 w-4" /> Novo formulário</Btn>
      </div>
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-semibold">Formulário</th>
                <th className="px-5 py-3 font-semibold">Aplicação nas OMs</th>
                <th className="px-5 py-3 text-right font-semibold">Campos</th>
                <th className="px-5 py-3 text-right font-semibold">Respostas</th>
                <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id} className={`border-b border-slate-50 last:border-0 ${model.ativo ? "" : "opacity-60"}`}>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">{model.nome} <Badge tone="indigo">{model.tipo}</Badge>{!model.ativo && <Badge>Inativo</Badge>}</div>
                    <div className="text-xs text-slate-400">versão {model.versao}{model.atualizado_por ? ` · ${model.atualizado_por}` : ""}{model.atualizado_em ? ` · ${dateTimeBr(model.atualizado_em)}` : ""}</div>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">{rulesText(model.regras)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{model.campos.length}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{model.respostas}</td>
                  <td className="px-5 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      {!model.ativo && <Btn size="sm" variant="ghost" onClick={() => reactivate(model)}>Reativar</Btn>}
                      <button type="button" title="Duplicar" aria-label={`Duplicar ${model.nome}`} onClick={() => setEditing({ ...model, id: undefined, nome: `${model.nome} (cópia)` })}
                        className="rounded-md p-2 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><Copy className="h-4 w-4" /></button>
                      <button type="button" title="Editar" aria-label={`Editar ${model.nome}`} onClick={() => setEditing(model)}
                        className="rounded-md p-2 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><Pencil className="h-4 w-4" /></button>
                      {model.ativo && <button type="button" title={model.respostas ? "Desativar" : "Excluir"} aria-label={`Excluir ${model.nome}`} onClick={() => remove(model)}
                        className="rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!models.length && <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">Nenhum formulário criado.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Construtor({ initial, onCancel, onSaved }) {
  const [model, setModel] = useState(() => ({ ...EMPTY_MODEL, ...initial, regras: { ...EMPTY_MODEL.regras, ...initial.regras }, campos: (initial.campos || []).map((campo) => ({ ...campo })) }));
  const [preview, setPreview] = useState({ values: {}, files: {} });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setModel((previous) => ({ ...previous, [key]: value }));
  const setRule = (key, value) => setModel((previous) => ({ ...previous, regras: { ...previous.regras, [key]: value } }));
  const toggle = (list, value) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  const updateField = (index, patch) => setModel((previous) => ({ ...previous, campos: previous.campos.map((campo, position) => position === index ? { ...campo, ...patch } : campo) }));
  const addField = (tipo) => setModel((previous) => ({
    ...previous,
    campos: [...previous.campos, { id: newId(), rotulo: "", tipo, obrigatorio: tipo !== "foto", ...(tipo === "selecao" ? { opcoes: ["Opção 1", "Opção 2"], opcoes_nc: [] } : {}) }],
  }));
  // Remover ou mover um campo desfaz condições que apontariam para campo inexistente ou posterior.
  const normalize = (campos) => campos.map((campo, index) => (campo.condicao && !campos.slice(0, index).some((other) => other.id === campo.condicao.campo) ? { ...campo, condicao: undefined } : campo));
  const removeField = (index) => setModel((previous) => ({ ...previous, campos: normalize(previous.campos.filter((_, position) => position !== index)) }));
  const moveField = (index, delta) => setModel((previous) => {
    const campos = [...previous.campos];
    const [item] = campos.splice(index, 1);
    campos.splice(index + delta, 0, item);
    return { ...previous, campos: normalize(campos) };
  });

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { nome: model.nome, tipo: model.tipo, descricao: model.descricao, regras: model.regras, campos: model.campos };
      const result = model.id ? await api.salvarFormularioModelo(model.id, payload) : await api.criarFormularioModelo(payload);
      onSaved(`"${model.nome}" salvo (versão ${result.versao}).`);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-5">
      <div className="space-y-4 2xl:col-span-3">
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">{model.id ? `Editar formulário · versão ${model.versao}` : "Novo formulário"}</h2>
            <div className="flex gap-2">
              <Btn type="button" variant="ghost" onClick={onCancel}>Cancelar</Btn>
              <Btn type="submit" disabled={saving || !model.campos.length}>{saving ? "Salvando…" : "Salvar formulário"}</Btn>
            </div>
          </div>
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-slate-500">Nome</span>
              <input required maxLength={120} className={`mt-1 ${inputCls}`} value={model.nome} onChange={(event) => set("nome", event.target.value)} placeholder="Ex.: Checklist de partida da bomba" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Tipo</span>
              <select className={`mt-1 ${inputCls}`} value={model.tipo} onChange={(event) => set("tipo", event.target.value)}>
                {TIPOS_MODELO.map((tipo) => <option key={tipo}>{tipo}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Descrição (opcional)</span>
            <input maxLength={1000} className={`mt-1 ${inputCls}`} value={model.descricao || ""} onChange={(event) => set("descricao", event.target.value)} />
          </label>
        </Card>

        <Card className="space-y-3 p-5">
          <h3 className="font-semibold text-slate-800">Checklist inteligente nas OMs</h3>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={model.regras.automatico} onChange={(event) => setRule("automatico", event.target.checked)} />
            Aplicar automaticamente às OMs que atendem aos filtros abaixo
          </label>
          {model.regras.automatico && <div className="space-y-3 rounded-lg bg-slate-50 p-3">
            <fieldset>
              <legend className="text-xs font-semibold text-slate-500">Tipos de OM (nenhum marcado = todos)</legend>
              <div className="mt-1 flex flex-wrap gap-3">{TIPOS_OM.map((tipo) => <label key={tipo} className="inline-flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" checked={model.regras.tipos_om.includes(tipo)} onChange={() => setRule("tipos_om", toggle(model.regras.tipos_om, tipo))} />{tipo}</label>)}</div>
            </fieldset>
            <fieldset>
              <legend className="text-xs font-semibold text-slate-500">Classes de equipamento (nenhuma marcada = todas)</legend>
              <div className="mt-1 flex flex-wrap gap-3">{[...new Set([...CLASSES, ...model.regras.classes_equipamento])].map((classe) => <label key={classe} className="inline-flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" checked={model.regras.classes_equipamento.includes(classe)} onChange={() => setRule("classes_equipamento", toggle(model.regras.classes_equipamento, classe))} />{classe}</label>)}</div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={model.regras.obrigatorio} onChange={(event) => setRule("obrigatorio", event.target.checked)} />
              Obrigatório: a OM só é encerrada depois deste formulário respondido
            </label>
          </div>}
          <p className="text-xs text-slate-400">PCM e CCM também podem vincular o formulário a uma OM específica, pela tela Ordens.</p>
        </Card>

        <Card className="space-y-3 p-5">
          <h3 className="font-semibold text-slate-800">Campos ({model.campos.length})</h3>
          {model.campos.map((campo, index) => (
            <FieldEditor key={campo.id} campo={campo} index={index} total={model.campos.length} previous={model.campos.slice(0, index)}
              onChange={(patch) => updateField(index, patch)} onRemove={() => removeField(index)} onMove={(delta) => moveField(index, delta)} />
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs font-semibold text-slate-500">Adicionar campo:</span>
            {Object.entries(FIELD_TYPES).map(([tipo, label]) => <Btn key={tipo} type="button" size="sm" variant="ghost" onClick={() => addField(tipo)}><Plus className="h-3.5 w-3.5" /> {label}</Btn>)}
          </div>
        </Card>
      </div>

      <Card className="p-5 2xl:sticky 2xl:top-0 2xl:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-800">Pré-visualização</h3>
          <Btn type="button" size="sm" variant="ghost" onClick={() => setPreview({ values: {}, files: {} })}>Limpar</Btn>
        </div>
        <p className="mb-4 mt-0.5 text-xs text-slate-400">É assim que o formulário aparece para quem preenche. Teste as condições e as não conformidades.</p>
        {model.campos.some((campo) => campo.rotulo.trim())
          ? <FormRenderer campos={model.campos.filter((campo) => campo.rotulo.trim())} values={preview.values} files={preview.files}
            onValue={(key, value) => setPreview((previous) => ({ ...previous, values: { ...previous.values, [key]: value } }))}
            onFile={(key, file) => setPreview((previous) => ({ ...previous, files: { ...previous.files, [key]: file } }))} />
          : <p className="text-sm text-slate-400">Adicione campos com rótulo para pré-visualizar.</p>}
      </Card>
    </form>
  );
}

function FieldEditor({ campo, index, total, previous, onChange, onRemove, onMove }) {
  const sources = previous.filter((other) => ["simnao", "selecao"].includes(other.tipo));
  const source = sources.find((other) => other.id === campo.condicao?.campo);
  const sourceValues = source ? (source.tipo === "simnao" ? SIM_NAO : source.opcoes || []) : [];
  const optionsText = (campo.opcoes || []).join("\n");

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">{index + 1}.</span>
        <Badge tone="indigo">{FIELD_TYPES[campo.tipo]}</Badge>
        <input required maxLength={200} aria-label={`Rótulo do campo ${index + 1}`} className={`${inputCls} min-w-0 flex-1`} placeholder="Pergunta ou rótulo do campo" value={campo.rotulo} onChange={(event) => onChange({ rotulo: event.target.value })} />
        <div className="flex items-center">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Mover para cima" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Mover para baixo" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={onRemove} aria-label="Remover campo" className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={campo.obrigatorio} onChange={(event) => onChange({ obrigatorio: event.target.checked })} /> Obrigatório</label>
        <input maxLength={300} aria-label="Texto de ajuda" className={inputCls} placeholder="Texto de ajuda (opcional)" value={campo.ajuda || ""} onChange={(event) => onChange({ ajuda: event.target.value })} />

        {campo.tipo === "simnao" && <label className="block">
          <span className="text-xs font-semibold text-slate-500">Resposta esperada (outra resposta = não conformidade)</span>
          <select className={`mt-1 ${inputCls}`} value={campo.esperado || ""} onChange={(event) => onChange({ esperado: event.target.value || undefined })}>
            <option value="">Sem resposta esperada</option>
            {SIM_NAO.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>}

        {campo.tipo === "numero" && <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          {[["limite_min", "Mínimo aceitável"], ["limite_max", "Máximo aceitável"]].map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-xs font-semibold text-slate-500">{label}</span>
              <input type="number" step="any" className={`mt-1 ${inputCls}`} value={campo[key] ?? ""} onChange={(event) => onChange({ [key]: event.target.value === "" ? undefined : Number(event.target.value) })} />
            </label>
          ))}
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Unidade</span>
            <input maxLength={20} className={`mt-1 ${inputCls}`} placeholder="Ex.: °C" value={campo.unidade || ""} onChange={(event) => onChange({ unidade: event.target.value })} />
          </label>
        </div>}

        {campo.tipo === "selecao" && <>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Opções (uma por linha)</span>
            <textarea rows={Math.max(3, (campo.opcoes || []).length + 1)} className={`mt-1 resize-y ${inputCls}`} value={optionsText}
              onChange={(event) => {
                const opcoes = event.target.value.split("\n");
                onChange({ opcoes, opcoes_nc: (campo.opcoes_nc || []).filter((option) => opcoes.includes(option)) });
              }} />
          </label>
          <fieldset>
            <legend className="text-xs font-semibold text-slate-500">Opções não conformes</legend>
            <div className="mt-1 flex flex-col gap-1">
              {(campo.opcoes || []).filter((option) => option.trim()).map((option) => (
                <label key={option} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" checked={(campo.opcoes_nc || []).includes(option)}
                    onChange={() => onChange({ opcoes_nc: (campo.opcoes_nc || []).includes(option) ? campo.opcoes_nc.filter((item) => item !== option) : [...(campo.opcoes_nc || []), option] })} />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>
        </>}
      </div>

      {index > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
        <span className="text-xs font-semibold text-slate-500">Mostrar só quando</span>
        <select aria-label="Campo da condição" className={`${inputCls} w-auto`} value={campo.condicao?.campo || ""}
          onChange={(event) => {
            const chosen = sources.find((other) => other.id === event.target.value);
            onChange({ condicao: chosen ? { campo: chosen.id, valor: chosen.tipo === "simnao" ? "Sim" : (chosen.opcoes || [])[0] } : undefined });
          }}>
          <option value="">sempre visível</option>
          {sources.map((other) => <option key={other.id} value={other.id}>{other.rotulo || "(sem rótulo)"}</option>)}
        </select>
        {source && <>
          <span className="text-xs font-semibold text-slate-500">for</span>
          <select aria-label="Valor da condição" className={`${inputCls} w-auto`} value={campo.condicao.valor} onChange={(event) => onChange({ condicao: { campo: source.id, valor: event.target.value } })}>
            {sourceValues.filter((option) => option.trim()).map((option) => <option key={option}>{option}</option>)}
          </select>
        </>}
        {!sources.length && <span className="text-xs text-slate-400">(adicione antes um campo Sim/Não ou Seleção)</span>}
      </div>}
    </div>
  );
}

// ------------------------------------------------------------------ Preencher
function Preencher() {
  const { user } = useAuth();
  const [models, setModels] = useState(null);
  const [ordens, setOrdens] = useState([]);
  const [equipamentos, setEquipamentos] = useState([]);
  const [choice, setChoice] = useState({ modelo_id: "", ordem_id: "", equipamento_id: "" });
  const [started, setStarted] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.formularioModelos(), api.ordens(), api.cadastros()])
      .then(([modelList, orderList, catalogs]) => {
        setModels(modelList);
        setOrdens(orderList.filter((order) => order.status !== "Encerrada" && order.status !== "Cancelada"));
        setEquipamentos(catalogs.equipamentos);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (!models) return error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : <Spinner />;
  const set = (key) => (event) => setChoice((previous) => ({ ...previous, [key]: event.target.value, ...(key === "ordem_id" && event.target.value ? { equipamento_id: "" } : {}) }));
  const ready = choice.modelo_id && (choice.ordem_id || choice.equipamento_id);

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-5">
      <Card className="space-y-4 p-5 xl:col-span-2">
        <h2 className="font-semibold text-slate-800">Novo preenchimento</h2>
        <p className="text-sm text-slate-500">Escolha o formulário e vincule a uma OM{user.papel === "EXECUTANTE" ? " atribuída a você" : ""} ou a um equipamento (ativo).</p>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Formulário</span>
          <select className={`mt-1 ${inputCls}`} value={choice.modelo_id} onChange={set("modelo_id")}>
            <option value="">Selecione</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.nome} ({model.tipo})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Ordem de manutenção</span>
          <select className={`mt-1 ${inputCls}`} value={choice.ordem_id} onChange={set("ordem_id")}>
            <option value="">Sem OM</option>
            {ordens.map((order) => <option key={order.id} value={order.id}>{order.numero} · {order.equipamento || "sem equipamento"}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Equipamento (quando não há OM)</span>
          <select disabled={Boolean(choice.ordem_id)} className={`mt-1 ${inputCls}`} value={choice.equipamento_id} onChange={set("equipamento_id")}>
            <option value="">{choice.ordem_id ? "Equipamento da OM" : "Selecione"}</option>
            {equipamentos.map((item) => <option key={item.id} value={item.id}>{item.tag} · {item.descricao}</option>)}
          </select>
        </label>
        <Btn className="w-full" disabled={!ready} onClick={() => { setResult(null); setStarted({ ...choice, key: Date.now() }); }}>Abrir formulário</Btn>
        {result && <div role="status" className={`rounded-lg px-3 py-2 text-sm ${result.nao_conformidades.length ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
          {result.nao_conformidades.length ? <><AlertTriangle className="mr-1 inline h-4 w-4" />Enviado com {result.nao_conformidades.length} não conformidade(s).</> : "Enviado sem não conformidades."}
          {result.encerrada && " A OM foi encerrada automaticamente."}
        </div>}
      </Card>
      <Card className="p-5 xl:col-span-3">
        {started
          ? <FillForm key={started.key} modeloId={Number(started.modelo_id)} ordemId={started.ordem_id ? Number(started.ordem_id) : null} equipamentoId={started.equipamento_id ? Number(started.equipamento_id) : null}
            onCancel={() => setStarted(null)} onDone={(response) => { setStarted(null); setResult(response); }} />
          : <p className="py-12 text-center text-sm text-slate-400">Escolha o formulário e o vínculo para preencher.</p>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Respostas
function Respostas() {
  const [rows, setRows] = useState(null);
  const [models, setModels] = useState([]);
  const [modelo, setModelo] = useState("");
  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { api.formularioModelos().then(setModels).catch(() => setModels([])); }, []);
  useEffect(() => { setRows(null); api.formularioRespostas(modelo ? { modelo_id: modelo } : {}).then(setRows).catch((e) => setError(e.message)); }, [modelo]);

  return (
    <div className="space-y-4">
      <label className="block max-w-sm">
        <span className="text-xs font-semibold text-slate-500">Formulário</span>
        <select className={`mt-1 ${inputCls}`} value={modelo} onChange={(event) => setModelo(event.target.value)}>
          <option value="">Todos</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.nome}</option>)}
        </select>
      </label>
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card>
        {!rows ? <Spinner /> : <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-semibold">Formulário</th>
                <th className="px-5 py-3 font-semibold">Vínculo</th>
                <th className="px-5 py-3 font-semibold">Preenchido por</th>
                <th className="px-5 py-3 font-semibold">Quando</th>
                <th className="px-5 py-3 font-semibold">Não conformidades</th>
                <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3"><div className="font-semibold text-slate-800">{row.modelo_nome}</div><div className="text-xs text-slate-400">{row.modelo_tipo} · v{row.modelo_versao}</div></td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{row.ordem_numero ? `OM ${row.ordem_numero}` : ""}{row.ordem_numero && row.equipamento ? " · " : ""}{row.equipamento || ""}</td>
                  <td className="px-5 py-3 text-slate-600">{row.usuario_nome}</td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{dateTimeBr(row.criado_em)}</td>
                  <td className="px-5 py-3">{row.nao_conformidades ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {row.nao_conformidades}</span> : <span className="text-xs text-slate-400">Nenhuma</span>}</td>
                  <td className="px-5 py-2 text-right"><Btn size="sm" variant="ghost" onClick={() => setViewing(row)}>Ver</Btn></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">Nenhuma resposta registrada.</td></tr>}
            </tbody>
          </table>
        </div>}
      </Card>
      {viewing && <Modal title={viewing.modelo_nome} onClose={() => setViewing(null)} className="max-w-2xl">
        <div className="max-h-[70vh] overflow-y-auto pr-1"><ResponseView id={viewing.id} /></div>
      </Modal>}
    </div>
  );
}
