import React, { useEffect, useState } from "react";
import { Search, Plus, ArrowRight } from "lucide-react";
import { api } from "../api.js";
import { Card, Badge, Btn, Modal, Spinner, statusTone, inputCls } from "../components/ui.jsx";

export default function Notas() {
  const [notas, setNotas] = useState(null);
  const [equip, setEquip] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = () => api.notas().then(setNotas).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); api.cadastros().then((c) => setEquip(c.equipamentos)).catch(() => {}); }, []);

  const converter = async (id) => {
    try { await api.converterNota(id); await carregar(); } catch (e) { setErro(e.message); }
  };

  if (erro) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{erro}</div>;
  if (!notas) return <Spinner />;

  const list = notas.filter((n) => `${n.numero} ${n.equipamento || ""} ${n.descricao}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nota…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none" />
        </div>
        <Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova nota</Btn>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2.5 font-semibold">Nº</th>
              <th className="px-5 py-2.5 font-semibold">Equipamento</th>
              <th className="px-5 py-2.5 font-semibold">Descrição</th>
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
                <td className="px-5 py-3"><Badge tone={statusTone(n.status)}>{n.status}</Badge></td>
                <td className="px-5 py-3 text-right">
                  {n.status === "Aberta"
                    ? <Btn size="sm" variant="ghost" onClick={() => converter(n.id)}>Converter em OM <ArrowRight className="h-3.5 w-3.5" /></Btn>
                    : <span className="text-xs text-slate-400">gerou OM</span>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">Nenhuma nota encontrada.</td></tr>}
          </tbody>
        </table>
      </Card>

      {open && <NovaNota equip={equip} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await carregar(); }} />}
    </div>
  );
}

function NovaNota({ equip, onClose, onSaved }) {
  const [f, setF] = useState({ equipamento_id: equip[0]?.id || "", tipo: "Corretiva", descricao: "" });
  const [erro, setErro] = useState("");
  const salvar = async () => {
    if (!f.descricao.trim()) { setErro("Informe a descrição."); return; }
    try { await api.criarNota({ ...f, equipamento_id: Number(f.equipamento_id) || null }); onSaved(); }
    catch (e) { setErro(e.message); }
  };
  return (
    <Modal title="Nova nota" subtitle="Registre uma condição fora do normal." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn onClick={salvar}>Abrir nota</Btn></>}>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-500">Equipamento</label>
          <select className={`mt-1 ${inputCls}`} value={f.equipamento_id} onChange={(e) => setF({ ...f, equipamento_id: e.target.value })}>
            {equip.map((x) => <option key={x.id} value={x.id}>{x.tag}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Tipo</label>
          <select className={`mt-1 ${inputCls}`} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            {["Corretiva", "Inspeção", "Preventiva"].map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Descrição</label>
          <textarea rows={3} className={`mt-1 resize-none ${inputCls}`} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Descreva a condição observada…" />
        </div>
        {erro && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
      </div>
    </Modal>
  );
}
