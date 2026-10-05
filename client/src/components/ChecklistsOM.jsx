import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Link2, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Modal, inputCls } from "./ui.jsx";
import { FillForm, ResponseView, dateTimeBr } from "./FormRenderer.jsx";
import { useAuth } from "../auth.jsx";
import { usePendencias } from "../offline/fila.js";

// Checklist inteligente da OM: formulários aplicados por regra ou vínculo, com preenchimento e consulta.
export default function ChecklistsOM({ ordem, podePreencher, podeVincular, onChanged }) {
  const [forms, setForms] = useState(ordem.formularios || []);
  const [models, setModels] = useState([]);
  const [linkModel, setLinkModel] = useState("");
  const [linkRequired, setLinkRequired] = useState(true);
  const [filling, setFilling] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const closed = ordem.status === "Encerrada" || ordem.status === "Cancelada";
  const { user } = useAuth();
  const offlineForms = new Set(usePendencias(user.id).filter((item) => item.tipo === "formulario" && item.meta.ordem_id === ordem.id).map((item) => item.meta.modelo_id));

  useEffect(() => { setForms(ordem.formularios || []); }, [ordem]);
  useEffect(() => { if (podeVincular) api.formularioModelos().then(setModels).catch(() => setModels([])); }, [podeVincular]);

  const run = async (action) => {
    setError("");
    try { setForms(await action()); onChanged?.(); } catch (e) { setError(e.message); }
  };
  const available = models.filter((model) => !forms.some((form) => form.modelo_id === model.id && form.origem === "manual"));

  return (
    <div className="space-y-3">
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {result && (result.offline
        ? <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Sem conexão: respostas salvas neste aparelho e enviadas automaticamente ao reconectar.</div>
        : <div role="status" className={`rounded-lg px-3 py-2 text-sm ${result.nao_conformidades.length ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
          Respostas enviadas{result.nao_conformidades.length ? ` com ${result.nao_conformidades.length} não conformidade(s): ${result.nao_conformidades.map((item) => item.rotulo).join(", ")}` : " sem não conformidades"}.
          {result.encerrada && " A OM foi encerrada automaticamente."}
        </div>)}

      {forms.length ? <ul className="divide-y divide-slate-100">
        {forms.map((form) => (
          <li key={form.modelo_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
              {form.ultima_resposta ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                  {form.nome}
                  <Badge tone={form.obrigatorio ? "rose" : "slate"}>{form.obrigatorio ? "Obrigatório" : "Opcional"}</Badge>
                  <span className="text-[11px] font-normal text-slate-400">{form.tipo} · {form.origem === "regra" ? "aplicado por regra" : "vinculado à OM"}</span>
                </div>
                {offlineForms.has(form.modelo_id) && <div className="mt-0.5 text-xs font-semibold text-amber-700">Preenchido sem conexão · aguardando sincronização</div>}
                {form.ultima_resposta && <div className="mt-0.5 text-xs text-slate-500">
                  {form.ultima_resposta.usuario_nome} · {dateTimeBr(form.ultima_resposta.criado_em)}
                  {form.ultima_resposta.nao_conformidades > 0 && <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" /> {form.ultima_resposta.nao_conformidades} não conformidade(s)</span>}
                </div>}
              </div>
            </div>
            <div className="flex gap-1.5">
              {form.ultima_resposta && <Btn size="sm" variant="ghost" onClick={() => setViewing(form)}>Ver</Btn>}
              {podePreencher && !closed && <Btn size="sm" variant={form.ultima_resposta ? "ghost" : "primary"} onClick={() => { setResult(null); setFilling(form); }}>{form.ultima_resposta ? "Preencher de novo" : "Preencher"}</Btn>}
              {podeVincular && form.origem === "manual" && !closed && <button type="button" title="Desvincular" aria-label={`Desvincular ${form.nome}`}
                onClick={() => run(() => api.desvincularFormularioOM(ordem.id, form.modelo_id))} className="rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>}
            </div>
          </li>
        ))}
      </ul> : <p className="text-sm text-slate-400">Nenhum checklist aplicado a esta OM.</p>}

      {podeVincular && !closed && available.length > 0 && <form className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"
        onSubmit={(event) => { event.preventDefault(); if (linkModel) run(() => api.vincularFormularioOM(ordem.id, { modelo_id: Number(linkModel), obrigatorio: linkRequired })).then(() => setLinkModel("")); }}>
        <select aria-label="Formulário para vincular" className={`${inputCls} max-w-xs`} value={linkModel} onChange={(event) => setLinkModel(event.target.value)}>
          <option value="">Vincular formulário…</option>
          {available.map((model) => <option key={model.id} value={model.id}>{model.nome} ({model.tipo})</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={linkRequired} onChange={(event) => setLinkRequired(event.target.checked)} /> Obrigatório para encerrar</label>
        <Btn type="submit" size="sm" variant="ghost" disabled={!linkModel}><Link2 className="h-3.5 w-3.5" /> Vincular</Btn>
      </form>}

      {filling && <Modal title={filling.nome} subtitle={`OM ${ordem.numero}${ordem.equipamento ? ` · ${ordem.equipamento}` : ""}`} onClose={() => setFilling(null)} className="max-w-2xl">
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <FillForm modeloId={filling.modelo_id} ordemId={ordem.id} onCancel={() => setFilling(null)}
            submit={(dados, files) => api.responderFormulario(dados, files, filling.nome)}
            onDone={async (response) => {
              setFilling(null);
              setResult(response);
              if (response.offline) return;
              setForms(await api.formulariosOM(ordem.id));
              onChanged?.();
            }} />
        </div>
      </Modal>}
      {viewing && <Modal title={viewing.nome} subtitle={`OM ${ordem.numero}`} onClose={() => setViewing(null)} className="max-w-2xl">
        <div className="max-h-[70vh] overflow-y-auto pr-1"><ResponseView id={viewing.ultima_resposta.id} /></div>
      </Modal>}
    </div>
  );
}
