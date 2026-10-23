import React, { useEffect, useState } from "react";
import { Search, Plus, ArrowRight, FileText } from "lucide-react";
import { api } from "../api.js";
import { Card, Badge, Btn, EmptyState, ErrorState, Modal, Spinner, dataBr, statusTone, inputCls } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";

// Mensagem do que o sistema fez com a nota: OM, prioridade, executante e dia.
export const resumoOm = (numeroNota, ordem) => {
  const base = `Nota ${numeroNota} gerou a OM ${ordem.numero} (${ordem.prioridade_label || "sem prioridade"})`;
  if (!ordem.executante) return `${base}. Nenhum executante disponível: o PCM/CCM foi avisado para distribuir.`;
  const reclass = ordem.reclassificadas?.length ? ` ${ordem.reclassificadas.length} OM(s) de menor prioridade foram reprogramadas.` : "";
  return `${base}, enviada a ${ordem.executante.nome} para ${dataBr(ordem.data_programada)}${ordem.fora_do_prazo ? " (sem agenda dentro do prazo)" : ""}.${reclass}`;
};

export default function Notas() {
  const toast = useToast();
  const [notas, setNotas] = useState(null);
  const [equip, setEquip] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [gerando, setGerando] = useState(null);
  const [erro, setErro] = useState("");

  const carregar = () => api.notas().then(setNotas).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); api.cadastros().then((c) => setEquip(c.equipamentos)).catch(() => {}); }, []);

  // Notas abertas antes do fluxo automático.
  const gerarOm = async (nota) => {
    setGerando(nota.id);
    try {
      toast.success(resumoOm(nota.numero, await api.gerarOmNota(nota.id)));
      await carregar();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGerando(null);
    }
  };

  if (erro && !notas) return <ErrorState message={erro} />;
  if (!notas) return <Spinner />;

  const list = notas.filter((n) => `${n.numero} ${n.equipamento || ""} ${n.descricao} ${n.ordem_numero || ""} ${n.executante || ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <label htmlFor="busca-notas" className="sr-only">Buscar nota</label>
          <input id="busca-notas" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, equipamento, OM ou executante…" className={`${inputCls} bg-white pl-9`} />
        </div>
        <Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova nota</Btn>
      </div>
      <p className="text-sm text-slate-500">Ao abrir a nota, o sistema já gera a OM com a prioridade, programa no plano semanal e envia ao executante da equipe responsável pelo ativo para aceite.</p>

      <Card>
        {notas.length === 0
          ? <EmptyState title="Nenhuma nota registrada." icon={FileText} action={<Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova nota</Btn>}>
            Registre uma condição fora do normal; a OM é gerada automaticamente.
          </EmptyState>
          : <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-semibold">Nota</th>
                  <th className="px-5 py-2.5 font-semibold">Equipamento</th>
                  <th className="px-5 py-2.5 font-semibold">Descrição</th>
                  <th className="px-5 py-2.5 font-semibold">Prioridade</th>
                  <th className="px-5 py-2.5 font-semibold">OM</th>
                  <th className="px-5 py-2.5 font-semibold">Executante</th>
                </tr>
              </thead>
              <tbody>
                {list.map((n) => (
                  <tr key={n.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 font-mono font-semibold text-slate-700">{n.numero}</td>
                    <td className="px-5 py-3 font-mono text-slate-600">{n.equipamento || "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{n.descricao}</td>
                    <td className="px-5 py-3">{n.prioridade_label ? <span className="font-semibold text-slate-700">{n.prioridade_label}</span> : <span className="text-xs text-slate-400">—</span>}</td>
                    <td className="px-5 py-3">
                      {n.ordem_numero
                        ? <div><div className="font-mono font-semibold text-slate-700">{n.ordem_numero}</div><Badge tone={statusTone(n.ordem_status)}>{n.ordem_status}</Badge></div>
                        : n.status === "Aberta"
                          ? <Btn size="sm" variant="ghost" disabled={gerando === n.id} onClick={() => gerarOm(n)}>{gerando === n.id ? "Gerando…" : <>Gerar OM <ArrowRight className="h-3.5 w-3.5" /></>}</Btn>
                          : <Badge tone={statusTone(n.status)}>{n.status}</Badge>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{n.executante ? <div>{n.executante}<div className="text-xs text-slate-400">{dataBr(n.ordem_data_programada) || ""}</div></div> : "—"}</td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">Nenhuma nota corresponde à busca “{q}”.</td></tr>}
              </tbody>
            </table>
          </div>}
      </Card>

      {open && <NovaNota equip={equip} onClose={() => setOpen(false)}
        onSaved={async (nota) => { setOpen(false); toast.success(resumoOm(nota.numero, nota.ordem)); await carregar(); }} />}
    </div>
  );
}

// Abertura de nota (também usada pelo executante no Início): só o essencial.
export function NovaNota({ equip, onClose, onSaved }) {
  const [f, setF] = useState({ equipamento_id: "", descricao: "", risco_iminente: false });
  const [erro, setErro] = useState("");
  const [saving, setSaving] = useState(false);
  const salvar = async (event) => {
    event.preventDefault();
    if (!f.descricao.trim()) { setErro("Descreva o problema."); return; }
    setSaving(true);
    try { await onSaved(await api.criarNota({ ...f, equipamento_id: Number(f.equipamento_id) || null })); }
    catch (e) { setErro(e.message); setSaving(false); }
  };
  return (
    <Modal title="Nova nota" subtitle="A OM é gerada, priorizada e enviada a um executante automaticamente." onClose={onClose}>
      <form onSubmit={salvar} className="space-y-4">
        <div>
          <label htmlFor="nota-equipamento" className="text-xs font-semibold text-slate-500">Equipamento</label>
          <select id="nota-equipamento" required className={`mt-1 ${inputCls}`} value={f.equipamento_id} onChange={(e) => setF({ ...f, equipamento_id: e.target.value })}>
            <option value="">Selecione…</option>
            {equip.map((x) => <option key={x.id} value={x.id}>{x.tag} · {x.descricao}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nota-descricao" className="text-xs font-semibold text-slate-500">O que está acontecendo?</label>
          <textarea id="nota-descricao" rows={3} required className={`mt-1 resize-none ${inputCls}`} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: ruído e aquecimento no mancal do motor." />
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={f.risco_iminente} onChange={(e) => setF({ ...f, risco_iminente: e.target.checked })} />
          <span><span className="font-semibold">O equipamento parou ou há risco à segurança?</span><br /><span className="text-xs text-slate-500">Marque para atendimento imediato. Sem marcar, a prioridade vem da criticidade do equipamento.</span></span>
        </label>
        {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Gerando OM…" : "Abrir nota"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
