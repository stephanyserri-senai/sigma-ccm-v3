import React, { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, ImagePlus, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Btn, Card, inputCls, Spinner } from "../components/ui.jsx";

const EMPTY_REPORT = { atividade_realizada: "", resultado: "Concluído", materiais_utilizados: "", observacoes: "", indisponibilidade_horas: "", tempo_reparo_horas: "" };

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
  const [notice, setNotice] = useState("");

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
      if (!closed) offline = Boolean((await api.salvarRelatorio(id, form, `OM ${order.numero}`))?.offline);
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
  if (!order) return <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error || "OM não encontrada ou não atribuída a você."}</div>;

  const closed = order.status === "Encerrada";
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button type="button" onClick={() => navigate("/apropriacao")} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Voltar às OMs atribuídas
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Relatório de execução</div>
          <h2 className="mt-1 text-xl font-bold text-slate-900">OM {order.numero}</h2>
          <p className="mt-1 text-sm text-slate-500">{order.equipamento} · {order.equipe || "Sem equipe"}</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{order.status}</span>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> {notice}</div>}

      <form onSubmit={save} className="space-y-5">
        <Card className="space-y-4 p-5">
          <h3 className="font-semibold text-slate-800">Relatório</h3>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Atividade realizada</span>
            <textarea required={!closed} rows={4} className={`mt-1 resize-y ${inputCls}`} value={form.atividade_realizada} onChange={set("atividade_realizada")} disabled={closed} placeholder="Descreva o serviço executado e as etapas concluídas." />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Resultado</span>
              <select className={`mt-1 ${inputCls}`} value={form.resultado} onChange={set("resultado")} disabled={closed}>
                <option>Concluído</option><option>Parcial</option><option>Pendente</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Materiais utilizados</span>
              <input className={`mt-1 ${inputCls}`} value={form.materiais_utilizados} onChange={set("materiais_utilizados")} disabled={closed} placeholder="Materiais, peças ou insumos" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Indisponibilidade do equipamento (h)</span>
              <input type="number" min="0" step="0.1" className={`mt-1 ${inputCls}`} value={form.indisponibilidade_horas} onChange={set("indisponibilidade_horas")} disabled={closed} placeholder="Informe se houve parada" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Tempo efetivo de reparo (h)</span>
              <input type="number" min="0" step="0.1" className={`mt-1 ${inputCls}`} value={form.tempo_reparo_horas} onChange={set("tempo_reparo_horas")} disabled={closed} placeholder="Informe o tempo de reparo" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Observações</span>
            <textarea rows={3} className={`mt-1 resize-y ${inputCls}`} value={form.observacoes} onChange={set("observacoes")} disabled={closed} placeholder="Observações adicionais" />
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

        {(!closed || files.length > 0) && <div className="flex justify-end">
          <Btn type="submit" disabled={saving || (!closed && !form.atividade_realizada.trim())}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</> : closed ? "Enviar fotos" : "Salvar relatório e fotos"}</Btn>
        </div>}
        {closed && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">Esta OM está encerrada. O relatório está bloqueado; evidências podem ser anexadas.</div>}
      </form>
    </div>
  );
}
