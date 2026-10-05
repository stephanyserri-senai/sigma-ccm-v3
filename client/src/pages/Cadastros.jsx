import React, { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Badge, Btn, Card, inputCls, Modal, Spinner } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

const CLASSES = ["Bomba", "Motor", "Painel", "Correia", "Compressor", "Sensor", "Estrutura", "Outro"];
const CRITICIDADES = ["Baixa", "Média", "Alta"];
const TIPOS_EQUIPE = ["Própria", "Terceirizada"];

const TABS = [
  {
    id: "equipamentos", label: "Equipamentos", icon: "factory",
    columns: [
      ["TAG", (row) => <span className="font-mono font-semibold text-slate-800">{row.tag}</span>],
      ["Descrição", (row) => row.descricao],
      ["Classe", (row) => row.classe],
      ["Localização", (row) => row.localizacao || "—"],
      ["Criticidade", (row) => <Badge tone={row.criticidade === "Alta" ? "rose" : row.criticidade === "Baixa" ? "slate" : "amber"}>{row.criticidade || "Média"}</Badge>],
    ],
  },
  {
    id: "equipes", label: "Equipes", icon: "gears",
    columns: [["Nome", (row) => row.nome], ["Tipo", (row) => row.tipo], ["Especialidade", (row) => row.especialidade || "—"]],
  },
  {
    id: "planos-preventivos", label: "Planos preventivos", icon: "calendar",
    columns: [["Equipamento", (row) => <span className="font-mono">{row.equipamento || "—"}</span>], ["Descrição", (row) => row.descricao], ["Equipe", (row) => row.equipe || "—"], ["Periodicidade", (row) => row.periodicidade || "—"], ["Próxima execução", (row) => row.proxima_data || "—"], ["OMs geradas", (row) => row.oms_geradas || "—"]],
  },
];

const EMPTY_LOOKUPS = { equipamentos: [], equipes: [] };

export default function Cadastros() {
  const toast = useToast();
  const [tab, setTab] = useState(TABS[0].id);
  const [rows, setRows] = useState([]);
  const [lookups, setLookups] = useState(EMPTY_LOOKUPS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [revision, setRevision] = useState(0);
  const navigate = useNavigate();
  const activeTab = TABS.find((item) => item.id === tab);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api.listarCadastro(tab)
      .then((data) => { if (current) setRows(data); })
      .catch((e) => { if (current) setError(e.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [tab, revision]);

  useEffect(() => {
    api.cadastros()
      .then((catalogs) => setLookups(catalogs))
      .catch(() => setLookups(EMPTY_LOOKUPS));
  }, [revision]);

  const save = async (values, item) => {
    setError("");
    try {
      if (item) await api.atualizarCadastro(tab, item.id, values);
      else await api.criarCadastro(tab, values);
      setDialog(null);
      setRevision((value) => value + 1);
      toast.success(item ? "Cadastro atualizado." : "Cadastro criado.");
    } catch (e) {
      setError(e.message);
      throw e;
    }
  };

  const remove = async (item) => {
    const title = item.tag || item.nome || item.matricula || item.descricao;
    if (!window.confirm(`Excluir "${title}"?`)) return;
    setError("");
    try {
      await api.excluirCadastro(tab, item.id);
      setRevision((value) => value + 1);
      toast.success(`"${title}" excluído.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const generateOrder = async (plan) => {
    try {
      const result = await api.gerarOmPlano(plan.id);
      toast.success(`OM ${result.numero} gerada e vinculada ao plano.`, { action: { label: "Ver ordens", onClick: () => navigate("/ordens") } });
      setRevision((value) => value + 1);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Cadastros mestres de manutenção e planejamento.</p>
        </div>
        <Btn onClick={() => setDialog({ item: null })}><Plus className="h-4 w-4" /> Novo cadastro</Btn>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Tipos de cadastro">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${tab === item.id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            <ThemeIcon name={item.icon} className="h-5 w-5" /> {item.label}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <Card>
        {loading ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  {activeTab.columns.map(([label]) => <th key={label} className="px-5 py-3 font-semibold">{label}</th>)}
                  <th className="px-5 py-3 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                    {activeTab.columns.map(([label, render]) => <td key={label} className="px-5 py-3 text-slate-600">{render(row)}</td>)}
                    <td className="px-5 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {tab === "planos-preventivos" && <button type="button" title="Gerar OM do plano" aria-label={`Gerar OM para ${row.descricao}`} onClick={() => generateOrder(row)}
                          className="rounded-md px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Gerar OM</button>}
                        <button type="button" title="Editar cadastro" aria-label={`Editar ${row.tag || row.nome || row.descricao}`} onClick={() => setDialog({ item: row })}
                          className="rounded-md p-2 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><Pencil className="h-4 w-4" /></button>
                        <button type="button" title="Excluir cadastro" aria-label={`Excluir ${row.tag || row.nome || row.descricao}`} onClick={() => remove(row)}
                          className="rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={activeTab.columns.length + 1} className="px-5 py-12 text-center text-sm text-slate-400">Nenhum registro nesta aba. Use “Novo cadastro” para incluir o primeiro.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog && <CadastroModal key={`${tab}-${dialog.item?.id || "novo"}`} resource={tab} item={dialog.item} lookups={lookups} onClose={() => setDialog(null)} onSave={save} />}
    </div>
  );
}

function initialValues(resource, item) {
  if (resource === "equipamentos") return {
    tag: item?.tag || "", tag_mode: item ? "manual" : "auto", descricao: item?.descricao || "",
    classe: item?.classe && !CLASSES.includes(item.classe) ? "Outro" : item?.classe || "Bomba",
    classe_personalizada: item?.classe && !CLASSES.includes(item.classe) ? item.classe : "",
    localizacao: item?.localizacao || "", criticidade: item?.criticidade || "Média", pai_id: item?.pai_id ? String(item.pai_id) : "",
  };
  if (resource === "equipes") return { nome: item?.nome || "", tipo: item?.tipo || "Própria", especialidade: item?.especialidade || "" };
  return {
    equipamento_id: item?.equipamento_id ? String(item.equipamento_id) : "", descricao: item?.descricao || "",
    periodicidade: item?.periodicidade || "", proxima_data: item?.proxima_data || "", equipe_id: item?.equipe_id ? String(item.equipe_id) : "",
  };
}

function CadastroModal({ resource, item, lookups, onClose, onSave }) {
  const [values, setValues] = useState(() => initialValues(resource, item));
  const [tagMode, setTagMode] = useState(item ? "manual" : "auto");
  const [tagPreview, setTagPreview] = useState(item?.tag || "");
  const [previewError, setPreviewError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const editingEquipment = resource === "equipamentos";
  const equipmentClass = values.classe === "Outro" ? values.classe_personalizada.trim() : values.classe;

  useEffect(() => {
    if (!editingEquipment || tagMode !== "auto") return undefined;
    if (!values.descricao.trim() || !equipmentClass) {
      setTagPreview("");
      setPreviewError("");
      setLoadingPreview(false);
      return undefined;
    }
    let current = true;
    setTagPreview("");
    setLoadingPreview(true);
    const timer = setTimeout(() => {
      setPreviewError("");
      api.previaTagEquipamento({ descricao: values.descricao, classe: equipmentClass })
        .then((result) => { if (current) setTagPreview(result.tag); })
        .catch((e) => { if (current) setPreviewError(e.message); })
        .finally(() => { if (current) setLoadingPreview(false); });
    }, 220);
    return () => { current = false; clearTimeout(timer); };
  }, [editingEquipment, tagMode, values.descricao, equipmentClass]);

  const set = (key) => (event) => setValues((previous) => ({ ...previous, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = editingEquipment ? { ...values, classe: equipmentClass, tag_mode: tagMode, tag: tagMode === "manual" ? values.tag : tagPreview } : values;
    try { await onSave(payload, item); }
    catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  };

  const titleMap = { equipamentos: "Equipamento", equipes: "Equipe", "planos-preventivos": "Plano preventivo" };
  const title = `${item ? "Editar" : "Novo"} ${titleMap[resource].toLowerCase()}`;
  const select = (label, key, options, placeholder, required = false) => (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <select required={required} className={`mt-1 ${inputCls}`} value={values[key]} onChange={set(key)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
  const text = (label, key, placeholder = "", type = "text", required = false) => (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input type={type} required={required} className={`mt-1 ${inputCls}`} value={values[key]} onChange={set(key)} placeholder={placeholder} />
    </label>
  );
  const textarea = (label, key, required = false) => (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <textarea required={required} rows={2} className={`mt-1 resize-y ${inputCls}`} value={values[key]} onChange={set(key)} />
    </label>
  );

  return (
    <Modal title={title} subtitle="Os campos obrigatórios estão marcados." onClose={onClose} className="max-w-xl">
      <form onSubmit={submit}>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {resource === "equipamentos" && <>
            {text("Descrição", "descricao", "Ex.: Bomba de recalque principal", "text", true)}
            {select("Classe", "classe", CLASSES.map((value) => ({ value, label: value })), undefined, true)}
            {values.classe === "Outro" && text("Categoria", "classe_personalizada", "Ex.: Turbina", "text", true)}
            <div>
              <div className="flex items-end justify-between gap-3">
                <label className="block min-w-0 flex-1">
                  <span className="text-xs font-semibold text-slate-500">TAG {tagMode === "auto" ? "prevista" : "manual"}</span>
                  <input required readOnly={tagMode === "auto"} className={`mt-1 ${inputCls} ${tagMode === "auto" ? "bg-slate-50 font-mono font-semibold" : "font-mono"}`}
                    value={tagMode === "auto" ? tagPreview : values.tag} onChange={set("tag")} placeholder={loadingPreview ? "Calculando…" : "Preencha descrição e classe"} />
                </label>
                <button type="button" onClick={() => {
                  const next = tagMode === "auto" ? "manual" : "auto";
                  setTagMode(next);
                  if (next === "manual" && !values.tag) setValues((previous) => ({ ...previous, tag: tagPreview }));
                }} className="shrink-0 pb-2 text-xs font-semibold text-indigo-700 hover:text-indigo-900">
                  {tagMode === "auto" ? "Editar TAG" : "Gerar automaticamente"}
                </button>
              </div>
              {previewError && tagMode === "auto" && <p className="mt-1 text-xs text-rose-600">{previewError}</p>}
              {tagMode === "auto" && <p className="mt-1 text-xs text-slate-400">A TAG é confirmada pelo servidor ao salvar.</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {text("Localização", "localizacao", "Ex.: Terminal Leste")}
              {select("Criticidade", "criticidade", CRITICIDADES.map((value) => ({ value, label: value })))}
            </div>
            {select("Equipamento pai", "pai_id", lookups.equipamentos.filter((entry) => entry.id !== item?.id).map((entry) => ({ value: String(entry.id), label: `${entry.tag} · ${entry.descricao}` })), "Sem equipamento pai")}
          </>}

          {resource === "equipes" && <>
            {text("Nome", "nome", "Ex.: Mecânica industrial", "text", true)}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {select("Tipo", "tipo", TIPOS_EQUIPE.map((value) => ({ value, label: value })))}
              {text("Especialidade", "especialidade", "Ex.: Bombas e motores")}
            </div>
          </>}

          {resource === "planos-preventivos" && <>
            {select("Equipamento", "equipamento_id", lookups.equipamentos.map((entry) => ({ value: String(entry.id), label: `${entry.tag} · ${entry.descricao}` })), "Selecione um equipamento", true)}
            {select("Equipe responsável", "equipe_id", lookups.equipes.map((entry) => ({ value: String(entry.id), label: entry.nome })), "Sem equipe")}
            {textarea("Descrição do plano", "descricao", true)}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {text("Periodicidade", "periodicidade", "Ex.: Mensal, 500 horas")}
              {text("Próxima execução", "proxima_data", "", "date")}
            </div>
          </>}
        </div>
        {formError && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={saving || (editingEquipment && tagMode === "auto" && (loadingPreview || !tagPreview))}>{saving ? "Salvando…" : "Salvar cadastro"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
