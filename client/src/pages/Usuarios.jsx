import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../api.js";
import { Card, Badge, Btn, Modal, Spinner, inputCls } from "../components/ui.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

const PAPEIS = ["CCM", "PCM", "EXECUTANTE"];

export default function Usuarios() {
  const [lista, setLista] = useState(null);
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = () => api.usuarios().then(setLista).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  if (erro) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{erro}</div>;
  if (!lista) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm text-slate-500"><ThemeIcon name="users" className="h-6 w-6" /> Contas de acesso ao portal e seus perfis.</p>
        <Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo usuário</Btn>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2.5 font-semibold">Nome</th>
              <th className="px-5 py-2.5 font-semibold">Usuário</th>
              <th className="px-5 py-2.5 font-semibold">E-mail</th>
              <th className="px-5 py-2.5 font-semibold">Perfil</th>
              <th className="px-5 py-2.5 font-semibold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 font-semibold text-slate-700">{u.nome}</td>
                <td className="px-5 py-3 font-mono text-slate-600">{u.username}</td>
                <td className="px-5 py-3 text-slate-600">{u.email || "—"}</td>
                <td className="px-5 py-3"><Badge tone="indigo">{u.papel}</Badge></td>
                <td className="px-5 py-3"><Badge tone={u.ativo ? "emerald" : "slate"}>{u.ativo ? "Ativo" : "Inativo"}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {open && <NovoUsuario onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await carregar(); }} />}
    </div>
  );
}

function NovoUsuario({ onClose, onSaved }) {
  const [f, setF] = useState({ nome: "", username: "", email: "", senha: "", papel: "EXECUTANTE" });
  const [erro, setErro] = useState("");
  const salvar = async () => {
    if (!f.nome || !f.username || !f.senha) { setErro("Nome, usuário e senha são obrigatórios."); return; }
    try { await api.criarUsuario(f); onSaved(); } catch (e) { setErro(e.message); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Novo usuário" subtitle="Crie uma conta de acesso ao portal." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn onClick={salvar}>Criar usuário</Btn></>}>
      <div className="space-y-4">
        <div><label className="text-xs font-semibold text-slate-500">Nome</label><input className={`mt-1 ${inputCls}`} value={f.nome} onChange={set("nome")} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-semibold text-slate-500">Usuário</label><input className={`mt-1 ${inputCls}`} value={f.username} onChange={set("username")} /></div>
          <div><label className="text-xs font-semibold text-slate-500">Senha</label><input type="password" className={`mt-1 ${inputCls}`} value={f.senha} onChange={set("senha")} /></div>
        </div>
        <div><label className="text-xs font-semibold text-slate-500">E-mail</label><input className={`mt-1 ${inputCls}`} value={f.email} onChange={set("email")} /></div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Perfil</label>
          <select className={`mt-1 ${inputCls}`} value={f.papel} onChange={set("papel")}>
            {PAPEIS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        {erro && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
      </div>
    </Modal>
  );
}
