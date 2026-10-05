import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Eraser } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Spinner, inputCls } from "./ui.jsx";

// Renderização dinâmica dos formulários a partir do modelo (mesma regra de visibilidade do servidor).
export const SIM_NAO = ["Sim", "Não"];
export const FIELD_TYPES = {
  texto: "Texto", numero: "Número", simnao: "Sim/Não", selecao: "Seleção", foto: "Foto", assinatura: "Assinatura",
};

export function visibleFields(campos, values) {
  const shown = new Set();
  return campos.filter((campo) => {
    if (campo.condicao && (!shown.has(campo.condicao.campo) || values[campo.condicao.campo] !== campo.condicao.valor)) return false;
    shown.add(campo.id);
    return true;
  });
}

export function nonConformity(campo, value) {
  if (value === undefined || value === null || value === "") return null;
  if (campo.tipo === "simnao" && campo.esperado && value !== campo.esperado) return `Esperado: ${campo.esperado}`;
  if (campo.tipo === "selecao" && campo.opcoes_nc?.includes(value)) return "Opção não conforme";
  if (campo.tipo === "numero") {
    const number = Number(value);
    if (Number.isFinite(number) && ((campo.limite_min != null && number < campo.limite_min) || (campo.limite_max != null && number > campo.limite_max))) {
      return `Fora da faixa ${campo.limite_min ?? "−∞"} a ${campo.limite_max ?? "+∞"}${campo.unidade ? ` ${campo.unidade}` : ""}`;
    }
  }
  return null;
}

export function SignaturePad({ id, onChange, disabled }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [(event.clientX - rect.left) * (canvasRef.current.width / rect.width), (event.clientY - rect.top) * (canvasRef.current.height / rect.height)];
  };
  const start = (event) => {
    if (disabled) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    drawing.current = true;
    const context = canvasRef.current.getContext("2d");
    context.lineWidth = 2.5; context.lineCap = "round"; context.strokeStyle = "#0f172a";
    context.beginPath();
    context.moveTo(...point(event));
  };
  const move = (event) => {
    if (!drawing.current) return;
    const context = canvasRef.current.getContext("2d");
    context.lineTo(...point(event));
    context.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setSigned(true);
    canvasRef.current.toBlob((blob) => onChange(blob ? new File([blob], "assinatura.png", { type: "image/png" }) : null), "image/png");
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setSigned(false);
    onChange(null);
  };

  return (
    <div>
      <canvas id={id} ref={canvasRef} width={600} height={180} aria-label="Área de assinatura"
        className={`h-36 w-full touch-none rounded-lg border bg-white ${signed ? "border-slate-300" : "border-dashed border-slate-300"} ${disabled ? "opacity-60" : "cursor-crosshair"}`}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
        <span>{signed ? "Assinado" : "Assine com o dedo, caneta ou mouse."}</span>
        <button type="button" onClick={clear} disabled={disabled || !signed} className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-40">
          <Eraser className="h-3.5 w-3.5" /> Limpar
        </button>
      </div>
    </div>
  );
}

function PhotoInput({ id, file, onChange, disabled }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="space-y-2">
      <input id={id} type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100" />
      {preview && <img src={preview} alt="Prévia da foto" className="h-32 rounded-lg border border-slate-200 object-cover" />}
    </div>
  );
}

export function FormRenderer({ campos, values, files, onValue, onFile, disabled = false }) {
  return (
    <div className="space-y-5">
      {visibleFields(campos, values).map((campo) => {
        const inputId = `campo-${campo.id}`;
        const nc = nonConformity(campo, values[campo.id]);
        const label = <>{campo.rotulo}{campo.obrigatorio && <span className="text-rose-600"> *</span>}</>;
        return (
          <div key={campo.id} className={campo.condicao ? "border-l-2 border-indigo-200 pl-3" : ""}>
            {["simnao", "selecao"].includes(campo.tipo) && (campo.tipo === "simnao" || campo.opcoes.length <= 4) ? (
              <fieldset>
                <legend className="text-sm font-semibold text-slate-700">{label}</legend>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {(campo.tipo === "simnao" ? SIM_NAO : campo.opcoes).map((option) => (
                    <button key={option} type="button" disabled={disabled} aria-pressed={values[campo.id] === option}
                      onClick={() => onValue(campo.id, values[campo.id] === option ? "" : option)}
                      className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${values[campo.id] === option ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : (
              <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700">{label}</label>
            )}
            {campo.tipo === "texto" && <textarea id={inputId} rows={2} maxLength={2000} disabled={disabled} className={`mt-1.5 resize-y ${inputCls}`} value={values[campo.id] || ""} onChange={(event) => onValue(campo.id, event.target.value)} />}
            {campo.tipo === "numero" && <div className="mt-1.5 flex items-center gap-2">
              <input id={inputId} type="number" step="any" disabled={disabled} className={`${inputCls} max-w-48 tabular-nums`} value={values[campo.id] ?? ""} onChange={(event) => onValue(campo.id, event.target.value)} />
              {campo.unidade && <span className="text-sm text-slate-500">{campo.unidade}</span>}
            </div>}
            {campo.tipo === "selecao" && campo.opcoes.length > 4 && <select id={inputId} disabled={disabled} className={`mt-1.5 ${inputCls}`} value={values[campo.id] || ""} onChange={(event) => onValue(campo.id, event.target.value)}>
              <option value="">Selecione</option>
              {campo.opcoes.map((option) => <option key={option}>{option}</option>)}
            </select>}
            {campo.tipo === "foto" && <div className="mt-1.5"><PhotoInput id={inputId} file={files[campo.id]} disabled={disabled} onChange={(file) => onFile(campo.id, file)} /></div>}
            {campo.tipo === "assinatura" && <div className="mt-1.5"><SignaturePad id={inputId} disabled={disabled} onChange={(file) => onFile(campo.id, file)} /></div>}
            {campo.ajuda && <p className="mt-1 text-xs text-slate-400">{campo.ajuda}</p>}
            {nc && <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Não conformidade: {nc}</p>}
          </div>
        );
      })}
    </div>
  );
}

// Carrega o modelo, renderiza e envia a resposta vinculada à OM e/ou ao equipamento.
export function FillForm({ modeloId, ordemId, equipamentoId, onDone, onCancel }) {
  const [model, setModel] = useState(null);
  const [values, setValues] = useState({});
  const [files, setFiles] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api.formularioModelo(modeloId).then(setModel).catch((e) => setError(e.message)); }, [modeloId]);

  if (!model) return error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : <Spinner />;

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const shown = new Set(visibleFields(model.campos, values).map((campo) => campo.id));
      const result = await api.responderFormulario(
        { modelo_id: model.id, ordem_id: ordemId || null, equipamento_id: equipamentoId || null, respostas: Object.fromEntries(Object.entries(values).filter(([key]) => shown.has(key))) },
        Object.fromEntries(Object.entries(files).filter(([key, file]) => shown.has(key) && file)),
      );
      onDone(result);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="indigo">{model.tipo}</Badge>
        <span className="text-xs text-slate-400">versão {model.versao}</span>
      </div>
      {model.descricao && <p className="text-sm text-slate-500">{model.descricao}</p>}
      <FormRenderer campos={model.campos} values={values} files={files}
        onValue={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
        onFile={(key, file) => setFiles((previous) => ({ ...previous, [key]: file }))} />
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <div className="flex justify-end gap-2">
        {onCancel && <Btn type="button" variant="ghost" onClick={onCancel}>Cancelar</Btn>}
        <Btn type="submit" disabled={saving}>{saving ? "Enviando…" : "Enviar respostas"}</Btn>
      </div>
    </form>
  );
}

// O servidor grava data e hora em UTC ("AAAA-MM-DD HH:MM:SS").
export const dateTimeBr = (value) => new Date(`${value.replace(" ", "T")}Z`).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function ResponseView({ id }) {
  const [data, setData] = useState(null);
  const [images, setImages] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const urls = [];
    api.formularioResposta(id).then(async (result) => {
      const loaded = {};
      for (const anexo of result.anexos) {
        const url = URL.createObjectURL(await api.anexoFormulario(id, anexo.id));
        urls.push(url);
        loaded[anexo.campo_id] = url;
      }
      if (active) { setData(result); setImages(loaded); }
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [id]);

  if (!data) return error ? <div role="alert" className="text-sm text-rose-700">{error}</div> : <Spinner />;
  const ncByField = new Map(data.nao_conformidades.map((item) => [item.campo, item.motivo]));
  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">
        {data.modelo_tipo} · versão {data.modelo_versao} · preenchido por <span className="font-semibold text-slate-700">{data.usuario_nome}</span> em {dateTimeBr(data.criado_em)}
        {data.ordem_numero && <> · OM {data.ordem_numero}</>}{data.equipamento && <> · {data.equipamento}</>}
      </div>
      {data.nao_conformidades.length
        ? <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" /> {data.nao_conformidades.length} não conformidade(s)</div>
        : <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Sem não conformidades</div>}
      <dl className="divide-y divide-slate-100">
        {visibleFields(data.campos, data.respostas).map((campo) => (
          <div key={campo.id} className="py-2.5">
            <dt className="text-xs font-semibold text-slate-500">{campo.rotulo}</dt>
            <dd className="mt-0.5 text-sm text-slate-800">
              {images[campo.id] ? <img src={images[campo.id]} alt={campo.rotulo} className={`rounded-lg border border-slate-200 ${campo.tipo === "assinatura" ? "h-20 bg-white" : "h-40 object-cover"}`} />
                : data.respostas[campo.id] === undefined ? <span className="text-slate-400">—</span>
                : `${data.respostas[campo.id]}${campo.unidade ? ` ${campo.unidade}` : ""}`}
              {ncByField.has(campo.id) && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {ncByField.get(campo.id)}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
