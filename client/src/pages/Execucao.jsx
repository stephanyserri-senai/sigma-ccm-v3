import React, { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, ImagePlus, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Btn, Card, inputCls, Spinner, ErrorState } from "../components/ui.jsx";
import { useNoticeToast } from "../components/toast.jsx";

const EMPTY_REPORT = {
  atividade_realizada: "", resultado: "Concluído", materiais_utilizados: "", observacoes: "",
  indisponibilidade_horas: "", tempo_reparo_horas: "", causa_falha: "", solucao_aplicada: "",
  anomalias_adicionais: "", condicao_final_ativo: "", equipamento_testado: null, apto_retorno_operacao: null,
  tarefas_executadas: [], materiais_estruturados: [], medicoes_testes: [],
};

export default function Execucao() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [images, setImages] = useState([]);
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [form, setForm] = useState(EMPTY_REPORT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const setNotice = useNoticeToast();

  useEffect(() => {
    let active = true;
    const objectUrls = [];
    setLoading(true);
    setError("");
    Promise.all([api.ordem(id), api.evidencias(id)])
      .then(async ([currentOrder, evidence]) => {
        const evidenceWithImages = await Promise.all(evidence.map(async (image) => {
          const url = URL.createObjectURL(await api.imagemOM(id, image.id));
          objectUrls.push(url);
          return { ...image, url };
        }));
        if (!active) return;
        setOrder(currentOrder);
        setForm(currentOrder.relatorio ? {
          atividade_realizada: currentOrder.relatorio.atividade_realizada || "",
          resultado: currentOrder.relatorio.resultado || "Concluído",
          materiais_utilizados: currentOrder.relatorio.materiais_utilizados || "",
          observacoes: currentOrder.relatorio.observacoes || "",
          indisponibilidade_horas: currentOrder.relatorio.indisponibilidade_horas ?? "",
          tempo_reparo_horas: currentOrder.relatorio.tempo_reparo_horas ?? "",
          causa_falha: currentOrder.relatorio.causa_falha || "",
          solucao_aplicada: currentOrder.relatorio.solucao_aplicada || "",
          anomalias_adicionais: currentOrder.relatorio.anomalias_adicionais || "",
          condicao_final_ativo: currentOrder.relatorio.condicao_final_ativo || "",
          equipamento_testado: currentOrder.relatorio.equipamento_testado,
          apto_retorno_operacao: currentOrder.relatorio.apto_retorno_operacao,
          tarefas_executadas: currentOrder.relatorio.tarefas_executadas || [],
          materiais_estruturados: currentOrder.relatorio.materiais_estruturados || [],
          medicoes_testes: currentOrder.relatorio.medicoes_testes || [],
        } : EMPTY_REPORT);
        setImages(evidenceWithImages);
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [id, revision]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const onFiles = (event) => {
    const selected = Array.from(event.target.files || []);
    if (selected.some((file) => file.size > 5 * 1024 * 1024)) {
      setError("Cada imagem pode ter no máximo 5 MB.");
      event.target.value = "";
      return;
    }
    if (selected.length > 5) {
      setError("Selecione até 5 imagens por envio.");
      event.target.value = "";
      return;
    }
    setError("");
    setFiles(selected);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      let offline = false;
      if (editable) offline = Boolean((await api.salvarRelatorio(id, form, `OM ${order.numero}`))?.offline);
      if (files.length) offline = Boolean((await api.enviarEvidencias(id, files, `OM ${order.numero}`))?.offline) || offline;
      setFiles([]);
      if (offline) {
        // Sem conexão: fica na fila local; não recarrega para não apagar o que foi digitado.
        setNotice("Sem conexão: relatório e fotos salvos neste aparelho e enviados automaticamente ao reconectar.");
      } else {
        setNotice("Relatório salvo e evidências registradas na OM.");
        setRevision((value) => value + 1);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (!order) return <ErrorState message={error || "OM não encontrada ou não atribuída a você."} />;

  const closed = order.status === "Encerrada";
  const editable = order.status === "Em execução";
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));
  const updateEntry = (field, index, key, value) => setForm((previous) => ({
    ...previous, [field]: previous[field].map((row, position) => position === index ? { ...row, [key]: value } : row),
  }));
  const addEntry = (field, row) => setForm((previous) => ({ ...previous, [field]: [...previous[field], row] }));
  const removeEntry = (field, index) => setForm((previous) => ({ ...previous, [field]: previous[field].filter((_, position) => position !== index) }));
  const concludeTechnically = async () => {
    if (!window.confirm("Encaminhar a OM para validação administrativa? Após o envio, o CCM revisará os dados e decidirá sobre o encerramento.")) return;
    setSaving(true);
    setError("");
    try {
      await api.salvarRelatorio(id, form, `OM ${order.numero}`);
      await api.concluirTecnicaOrdem(id);
      setNotice("Conclusão técnica registrada; a OM aguarda validação administrativa do CCM.");
      setRevision((value) => value + 1);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button type="button" onClick={() => navigate("/apropriacao")} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Voltar às OMs atribuídas
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Relatório de execução</div>
          <h2 className="mt-1 text-xl font-bold text-slate-900">OM {order.numero}</h2>
          <p className="mt-1 text-sm text-slate-500">{order.equipamento} · {order.localizacao || "Localização não informada"} · {order.equipe || "Sem equipe"}{order.prioridade_label ? ` · ${order.prioridade_label}` : ""}</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{order.status}</span>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {order.escopo_tecnico && <Card className="space-y-2 border-indigo-100 bg-indigo-50 p-4">
        <h3 className="text-sm font-semibold text-indigo-900">Plano aprovado</h3>
        <p className="whitespace-pre-wrap text-sm text-indigo-900">{order.escopo_tecnico}</p>
        {(order.tarefas_planejadas || []).length > 0 && <ul className="list-inside list-disc text-xs text-indigo-800">{order.tarefas_planejadas.map((task, index) => <li key={index}>{task.descricao}{task.criterio ? ` — ${task.criterio}` : ""}</li>)}</ul>}
        {order.requisitos_seguranca && <p className="whitespace-pre-wrap text-xs text-indigo-800"><strong>Segurança:</strong> {order.requisitos_seguranca}</p>}
      </Card>}

      <form onSubmit={save} className="space-y-5">
        <Card className="space-y-4 p-5">
          <h3 className="font-semibold text-slate-800">Relatório</h3>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Atividade realizada</span>
            <textarea required={editable} rows={4} className={`mt-1 resize-y ${inputCls}`} value={form.atividade_realizada} onChange={set("atividade_realizada")} disabled={!editable} placeholder="Descreva o serviço executado e as etapas concluídas." />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Resultado</span>
              <select className={`mt-1 ${inputCls}`} value={form.resultado} onChange={set("resultado")} disabled={!editable}>
                <option>Concluído</option><option>Parcial</option><option>Pendente</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Materiais utilizados</span>
              <input className={`mt-1 ${inputCls}`} value={form.materiais_utilizados} onChange={set("materiais_utilizados")} disabled={!editable} placeholder="Materiais, peças ou insumos" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Indisponibilidade do equipamento (h)</span>
              <input type="number" min="0" step="0.1" className={`mt-1 ${inputCls}`} value={form.indisponibilidade_horas} onChange={set("indisponibilidade_horas")} disabled={!editable} placeholder="Informe se houve parada" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Tempo efetivo de reparo (h)</span>
              <input type="number" min="0" step="0.1" className={`mt-1 ${inputCls}`} value={form.tempo_reparo_horas} onChange={set("tempo_reparo_horas")} disabled={!editable} placeholder="Informe o tempo de reparo" />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[["causa_falha", "Causa da falha"], ["solucao_aplicada", "Solução aplicada"], ["anomalias_adicionais", "Anomalias adicionais"], ["condicao_final_ativo", "Condição final do ativo"]].map(([key, label]) => <label key={key} className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><textarea rows={2} maxLength={2000} className={`mt-1 resize-y ${inputCls}`} value={form[key]} onChange={set(key)} disabled={!editable} /></label>)}
            <label className="block"><span className="text-xs font-semibold text-slate-500">Equipamento testado?</span><select required={editable} className={`mt-1 ${inputCls}`} value={form.equipamento_testado == null ? "" : String(form.equipamento_testado)} onChange={(event) => setForm((previous) => ({ ...previous, equipamento_testado: event.target.value === "" ? null : event.target.value === "true", apto_retorno_operacao: event.target.value === "true" ? previous.apto_retorno_operacao : null }))} disabled={!editable}><option value="">Selecione</option><option value="true">Sim</option><option value="false">Não</option></select></label>
            {form.equipamento_testado === true && <label className="block"><span className="text-xs font-semibold text-slate-500">Apto a retornar à operação?</span><select required={editable} className={`mt-1 ${inputCls}`} value={form.apto_retorno_operacao == null ? "" : String(form.apto_retorno_operacao)} onChange={(event) => setForm((previous) => ({ ...previous, apto_retorno_operacao: event.target.value === "" ? null : event.target.value === "true" }))} disabled={!editable}><option value="">Selecione</option><option value="true">Sim</option><option value="false">Não</option></select></label>}
          </div>
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-700">Tarefas executadas</h4><Btn type="button" size="sm" variant="ghost" disabled={!editable} onClick={() => addEntry("tarefas_executadas", { descricao: "", resultado: "" })}>Adicionar</Btn></div>
            {form.tarefas_executadas.map((task, index) => <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"><input required maxLength={500} disabled={!editable} className={inputCls} aria-label={`Tarefa executada ${index + 1}`} placeholder="Tarefa" value={task.descricao} onChange={(event) => updateEntry("tarefas_executadas", index, "descricao", event.target.value)} /><input required maxLength={1000} disabled={!editable} className={inputCls} aria-label={`Resultado da tarefa ${index + 1}`} placeholder="Resultado" value={task.resultado} onChange={(event) => updateEntry("tarefas_executadas", index, "resultado", event.target.value)} /><Btn type="button" variant="danger" size="sm" disabled={!editable} onClick={() => removeEntry("tarefas_executadas", index)}>Remover</Btn></div>)}
          </div>
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-700">Materiais utilizados</h4><Btn type="button" size="sm" variant="ghost" disabled={!editable} onClick={() => addEntry("materiais_estruturados", { descricao: "", quantidade: 1, unidade: "un" })}>Adicionar</Btn></div>
            {form.materiais_estruturados.map((item, index) => <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]"><input required maxLength={300} disabled={!editable} className={inputCls} aria-label={`Material ${index + 1}`} placeholder="Material" value={item.descricao} onChange={(event) => updateEntry("materiais_estruturados", index, "descricao", event.target.value)} /><input type="number" required min="0.01" step="any" disabled={!editable} className={inputCls} aria-label={`Quantidade do material ${index + 1}`} value={item.quantidade} onChange={(event) => updateEntry("materiais_estruturados", index, "quantidade", event.target.value)} /><input required maxLength={30} disabled={!editable} className={inputCls} aria-label={`Unidade do material ${index + 1}`} placeholder="Unidade" value={item.unidade} onChange={(event) => updateEntry("materiais_estruturados", index, "unidade", event.target.value)} /><Btn type="button" variant="danger" size="sm" disabled={!editable} onClick={() => removeEntry("materiais_estruturados", index)}>Remover</Btn></div>)}
          </div>
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-700">Medições e testes</h4><Btn type="button" size="sm" variant="ghost" disabled={!editable} onClick={() => addEntry("medicoes_testes", { descricao: "", valor: "", unidade: "", criterio: "", resultado: "" })}>Adicionar</Btn></div>
            {form.medicoes_testes.map((item, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"><input required disabled={!editable} maxLength={300} className={inputCls} aria-label={`Medição ${index + 1}`} placeholder="Medição / teste" value={item.descricao} onChange={(event) => updateEntry("medicoes_testes", index, "descricao", event.target.value)} /><input required disabled={!editable} maxLength={100} className={inputCls} aria-label={`Valor medido ${index + 1}`} placeholder="Valor obtido" value={item.valor} onChange={(event) => updateEntry("medicoes_testes", index, "valor", event.target.value)} /><input disabled={!editable} maxLength={30} className={inputCls} aria-label={`Unidade da medição ${index + 1}`} placeholder="Unidade" value={item.unidade} onChange={(event) => updateEntry("medicoes_testes", index, "unidade", event.target.value)} /><input disabled={!editable} maxLength={300} className={inputCls} aria-label={`Critério da medição ${index + 1}`} placeholder="Critério" value={item.criterio} onChange={(event) => updateEntry("medicoes_testes", index, "criterio", event.target.value)} /><select required disabled={!editable} className={inputCls} aria-label={`Resultado da medição ${index + 1}`} value={item.resultado} onChange={(event) => updateEntry("medicoes_testes", index, "resultado", event.target.value)}><option value="">Resultado</option><option>Aprovado</option><option>Reprovado</option><option>Observação</option></select><Btn type="button" variant="danger" size="sm" disabled={!editable} onClick={() => removeEntry("medicoes_testes", index)}>Remover medição</Btn></div>)}
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Observações</span>
            <textarea rows={3} className={`mt-1 resize-y ${inputCls}`} value={form.observacoes} onChange={set("observacoes")} disabled={!editable} placeholder="Observações adicionais" />
          </label>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-indigo-600" />
            <h3 className="font-semibold text-slate-800">Fotos da execução</h3>
          </div>
          <p className="text-sm text-slate-500">Anexe até 5 imagens por envio, com até 5 MB cada.</p>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={onFiles} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100" />
          {previews.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {previews.map((url, index) => <figure key={url} className="overflow-hidden rounded-lg border border-slate-200"><img src={url} alt={`Prévia da imagem ${index + 1}`} className="aspect-video w-full object-cover" /><figcaption className="truncate px-2 py-1.5 text-xs text-slate-500">{files[index]?.name}</figcaption></figure>)}
          </div>}
          {images.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((image) => <figure key={image.id} className="overflow-hidden rounded-lg border border-slate-200"><img src={image.url} alt={`Evidência da OM ${order.numero}`} className="aspect-video w-full object-cover" /><figcaption className="truncate px-2 py-1.5 text-xs text-slate-500">{image.nome_arquivo}</figcaption></figure>)}
          </div>}
          {!images.length && !previews.length && <p className="text-sm text-slate-400">Nenhuma imagem registrada.</p>}
        </Card>

        {(editable || files.length > 0) && <div className="flex flex-wrap justify-end gap-2">
          {editable && <Btn type="submit" disabled={saving || !form.atividade_realizada.trim()}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</> : "Salvar relatório e fotos"}</Btn>}
          {files.length > 0 && !editable && <Btn type="submit" disabled={saving}>{saving ? "Enviando…" : "Enviar fotos"}</Btn>}
          {editable && <Btn type="button" variant="ghost" disabled={saving || !form.atividade_realizada.trim()} onClick={concludeTechnically}><CheckCircle2 className="h-4 w-4" /> Concluir tecnicamente</Btn>}
        </div>}
        {!editable && <div className={`rounded-lg px-4 py-3 text-sm font-semibold ${closed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{closed ? "Esta OM está encerrada. O relatório está bloqueado; evidências podem ser anexadas." : order.status === "Aguardando validação" ? "Conclusão técnica enviada; aguardando validação administrativa do CCM." : order.status === "Devolvida para ajuste" ? "OM devolvida para ajuste. Solicite ao PCM/CCM nova distribuição após a correção." : "O relatório só pode ser editado enquanto a OM estiver em execução."}</div>}
      </form>
    </div>
  );
}
