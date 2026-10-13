import React, { useEffect, useState } from "react";
import { Search, Plus, ArrowRight, FileText, ShieldAlert } from "lucide-react";
import { api } from "../api.js";
import { Card, Badge, Btn, EmptyState, ErrorState, Modal, Spinner, statusTone, inputCls } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";

export default function Notas() {
  const toast = useToast();
  const [notas, setNotas] = useState(null);
  const [equip, setEquip] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [converting, setConverting] = useState(null);
  const [classifying, setClassifying] = useState(null);
  const [erro, setErro] = useState("");

  const carregar = () => api.notas().then(setNotas).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); api.cadastros().then((c) => setEquip(c.equipamentos)).catch(() => {}); }, []);

  const converter = async (nota) => {
    setConverting(nota.id);
    try {
      const ordem = await api.converterNota(nota.id);
      toast.success(`Nota ${nota.numero} convertida na OM ${ordem.numero}.`);
      await carregar();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setConverting(null);
    }
  };

  if (erro && !notas) return <ErrorState message={erro} />;
  if (!notas) return <Spinner />;

  const list = notas.filter((n) => `${n.numero} ${n.equipamento || ""} ${n.descricao}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <label htmlFor="busca-notas" className="sr-only">Buscar nota</label>
          <input id="busca-notas" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, equipamento ou descrição…" className={`${inputCls} bg-white pl-9`} />
        </div>
        <Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova nota</Btn>
      </div>

      <Card>
        {notas.length === 0
          ? <EmptyState title="Nenhuma nota registrada." icon={FileText} action={<Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova nota</Btn>}>
            Registre uma condição fora do normal; depois ela pode ser convertida em OM.
          </EmptyState>
          : <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-semibold">Nº</th>
                  <th className="px-5 py-2.5 font-semibold">Equipamento</th>
                  <th className="px-5 py-2.5 font-semibold">Descrição</th>
                  <th className="px-5 py-2.5 font-semibold">Criticidade / prioridade</th>
                  <th className="px-5 py-2.5 font-semibold">Status</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {list.map((n) => (
                  <tr key={n.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 font-mono font-semibold text-slate-700">{n.numero}</td>
                    <td className="px-5 py-3 font-mono text-slate-600">{n.equipamento || "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{n.descricao}</td>
                    <td className="px-5 py-3">
                      {n.prioridade
                        ? <div><div className="font-semibold text-slate-700">{n.prioridade_label || n.prioridade}</div><div className="text-xs text-slate-500">Criticidade {n.criticidade} · {n.prazo_dias == null ? "parada programada" : `${n.prazo_dias} dias`}</div></div>
                        : n.priorizacao_pendente ? <Badge tone="amber">Priorização pendente</Badge> : <span className="text-xs text-slate-400">Registro anterior</span>}
                    </td>
                    <td className="px-5 py-3"><Badge tone={statusTone(n.status)}>{n.status}</Badge></td>
                    <td className="px-5 py-3 text-right">
                      {n.status === "Aberta" ? <div className="flex justify-end gap-1">
                        {n.priorizacao_pendente && <Btn size="sm" variant="ghost" onClick={() => setClassifying(n)}><ShieldAlert className="h-3.5 w-3.5" /> Priorizar</Btn>}
                        {n.prioridade === "IMEDIATO" && !n.paralisacao_confirmada_em && <Btn size="sm" variant="ghost" onClick={async () => {
                          try {
                            await api.confirmarParalisacaoNota(n.id);
                            toast.success("Confirmação da paralisação registrada.");
                            await carregar();
                          } catch (e) { toast.error(e.message); }
                        }}>Confirmar paralisação</Btn>}
                        <Btn size="sm" variant="ghost" disabled={converting === n.id || n.priorizacao_pendente || (n.prioridade === "IMEDIATO" && !n.paralisacao_confirmada_em)} onClick={() => converter(n)}>{converting === n.id ? "Convertendo…" : <>Converter em OM <ArrowRight className="h-3.5 w-3.5" /></>}</Btn>
                      </div> : <span className="text-xs text-slate-400">OM gerada</span>}
                    </td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">Nenhuma nota corresponde à busca “{q}”.</td></tr>}
              </tbody>
            </table>
          </div>}
      </Card>

      {open && <NovaNota equip={equip} onClose={() => setOpen(false)}
        onSaved={async (nota) => { setOpen(false); toast.success(`Nota ${nota.numero} aberta.`); await carregar(); }} />}
      {classifying && <PriorizarNota nota={classifying} onClose={() => setClassifying(null)}
        onSaved={async () => { setClassifying(null); toast.success("Criticidade e prioridade salvas."); await carregar(); }} />}
    </div>
  );
}

const CRITERIOS = [
  ["afeta_seguranca_ambiente", "Afeta segurança pessoal, processo ou meio ambiente?"],
  ["afeta_custos", "Afeta os custos?"],
  ["afeta_producao_qualidade", "Afeta produção ou qualidade?"],
  ["possui_reserva", "Existe equipamento reserva disponível?"],
  ["risco_iminente", "O problema já ocorreu ou há risco iminente?"],
  ["equipamento_monitorado", "O equipamento é monitorado?"],
  ["recursos_disponiveis", "Os recursos necessários estão disponíveis?"],
  ["necessita_parada_programada", "O serviço depende de parada programada?"],
];

function PriorizarNota({ nota, onClose, onSaved }) {
  const [criterios, setCriterios] = useState(Object.fromEntries(CRITERIOS.map(([key]) => [key, typeof nota[key] === "boolean" ? String(nota[key]) : ""])));
  const [periodicidade, setPeriodicidade] = useState(nota.periodicidade_parada || "");
  const [preview, setPreview] = useState(null);
  const [erro, setErro] = useState("");
  const [saving, setSaving] = useState(false);
  const paradaNecessaria = criterios.recursos_disponiveis === "false" && criterios.necessita_parada_programada === "true";

  const salvar = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErro("");
    const payload = Object.fromEntries(Object.entries(criterios).map(([key, value]) => [key, value === "true"]));
    if (Object.values(criterios).some((value) => value === "")) {
      setErro("Responda todos os critérios para calcular a prioridade.");
      setSaving(false);
      return;
    }
    try {
      const result = await api.priorizarNota(nota.id, { ...payload, periodicidade_parada: periodicidade || null });
      setPreview(result);
      if (result.prioridade !== "IMEDIATO") await onSaved();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Classificar nota ${nota.numero}`} subtitle="Criticidade e prioridade são calculadas pelo fluxo de decisão." onClose={onClose} className="max-w-2xl">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CRITERIOS.map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-xs font-semibold text-slate-600">{label}</span>
              <select required className={`mt-1 ${inputCls}`} value={criterios[key]} onChange={(event) => setCriterios((current) => ({ ...current, [key]: event.target.value }))}>
                <option value="">Selecione…</option><option value="true">Sim</option><option value="false">Não</option>
              </select>
            </label>
          ))}
        </div>
        {paradaNecessaria && <label className="block">
          <span className="text-xs font-semibold text-slate-600">Periodicidade da parada programada</span>
          <select required className={`mt-1 ${inputCls}`} value={periodicidade} onChange={(event) => setPeriodicidade(event.target.value)}>
            <option value="">Selecione…</option><option>Trimestral</option><option>Semestral</option><option>Anual</option>
          </select>
        </label>}
        {preview && <div className={`rounded-lg border p-3 text-sm ${preview.prioridade === "IMEDIATO" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-indigo-200 bg-indigo-50 text-indigo-800"}`}>
          Criticidade <strong>{preview.criticidade}</strong> · prioridade <strong>{preview.prioridade_label}</strong>.
          {preview.prioridade === "IMEDIATO" && <p className="mt-1">Antes de converter a nota, confirme que os demais trabalhos em andamento foram paralisados.</p>}
        </div>}
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Fechar</Btn>
          {preview?.prioridade === "IMEDIATO" && <Btn type="button" onClick={onSaved}>Concluir classificação</Btn>}
          {!preview && <Btn type="submit" disabled={saving}>{saving ? "Calculando…" : "Calcular e salvar"}</Btn>}
        </div>
      </form>
    </Modal>
  );
}

function NovaNota({ equip, onClose, onSaved }) {
  const [f, setF] = useState({ equipamento_id: equip[0]?.id || "", tipo: "Corretiva", descricao: "" });
  const [erro, setErro] = useState("");
  const [saving, setSaving] = useState(false);
  const salvar = async (event) => {
    event.preventDefault();
    if (!f.descricao.trim()) { setErro("Informe a descrição."); return; }
    setSaving(true);
    try { onSaved(await api.criarNota({ ...f, equipamento_id: Number(f.equipamento_id) || null })); }
    catch (e) { setErro(e.message); setSaving(false); }
  };
  return (
    <Modal title="Nova nota" subtitle="Registre uma condição fora do normal." onClose={onClose}>
      <form onSubmit={salvar} className="space-y-4">
        <div>
          <label htmlFor="nota-equipamento" className="text-xs font-semibold text-slate-500">Equipamento</label>
          <select id="nota-equipamento" className={`mt-1 ${inputCls}`} value={f.equipamento_id} onChange={(e) => setF({ ...f, equipamento_id: e.target.value })}>
            {equip.map((x) => <option key={x.id} value={x.id}>{x.tag} · {x.descricao}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nota-tipo" className="text-xs font-semibold text-slate-500">Tipo</label>
          <select id="nota-tipo" className={`mt-1 ${inputCls}`} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            {["Corretiva", "Inspeção", "Preventiva"].map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nota-descricao" className="text-xs font-semibold text-slate-500">Descrição</label>
          <textarea id="nota-descricao" rows={3} required className={`mt-1 resize-none ${inputCls}`} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Descreva a condição observada…" />
        </div>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Abrindo…" : "Abrir nota"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
