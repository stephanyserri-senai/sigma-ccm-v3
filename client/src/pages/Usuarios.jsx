import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../api.js";
import { Card, Badge, Btn, Modal, Spinner, inputCls } from "../components/ui.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

const PAPEIS = ["CCM", "PCM", "EXECUTANTE"];
const TODAS = "todas";
const SEM_EQUIPE = "sem-equipe";

export default function Usuarios() {
  const [lista, setLista] = useState(null);
  const [equipes, setEquipes] = useState([]);
  const [aba, setAba] = useState(TODAS);
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = () => api.usuarios().then(setLista).catch((e) => setErro(e.message));
  useEffect(() => {
    carregar();
    api.cadastros().then((catalogs) => setEquipes(catalogs.equipes)).catch((e) => setErro(e.message));
  }, []);

  if (erro && !lista) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{erro}</div>;
  if (!lista) return <Spinner />;

  const semEquipe = lista.filter((u) => !u.equipe_id).length;
  const abas = [
    { id: TODAS, label: "Todas as equipes", total: lista.length },
    ...equipes.map((equipe) => ({ id: String(equipe.id), label: equipe.nome, total: lista.filter((u) => u.equipe_id === equipe.id).length })),
    ...(semEquipe ? [{ id: SEM_EQUIPE, label: "Sem equipe", total: semEquipe }] : []),
  ];
  const abaAtiva = abas.some((item) => item.id === aba) ? aba : TODAS;
  const visiveis = lista.filter((u) => abaAtiva === TODAS || (abaAtiva === SEM_EQUIPE ? !u.equipe_id : String(u.equipe_id) === abaAtiva));

  const vincular = async (usuario, equipeId) => {
    setErro("");
    try { await api.vincularEquipeUsuario(usuario.id, Number(equipeId)); await carregar(); } catch (e) { setErro(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm text-slate-500"><ThemeIcon name="users" className="h-6 w-6" /> Contas de acesso ao portal, seus perfis e equipes.</p>
        <Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo usuário</Btn>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Equipes">
        {abas.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={abaAtiva === item.id} onClick={() => setAba(item.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${abaAtiva === item.id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {item.label} <span className="rounded-full bg-slate-100 px-1.5 text-xs font-semibold tabular-nums text-slate-500">{item.total}</span>
          </button>
        ))}
      </div>

      {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</div>}
      {semEquipe > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {semEquipe} usuário(s) ainda sem equipe. Selecione a equipe na coluna "Equipe" para regularizar.
      </div>}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2.5 font-semibold">Nome</th>
                <th className="px-5 py-2.5 font-semibold">Usuário</th>
                <th className="px-5 py-2.5 font-semibold">E-mail</th>
                <th className="px-5 py-2.5 font-semibold">Perfil</th>
                <th className="px-5 py-2.5 font-semibold">Equipe</th>
                <th className="px-5 py-2.5 font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 font-semibold text-slate-700">{u.nome}</td>
                  <td className="px-5 py-3 font-mono text-slate-600">{u.username}</td>
                  <td className="px-5 py-3 text-slate-600">{u.email || "—"}</td>
                  <td className="px-5 py-3"><Badge tone="indigo">{u.papel}</Badge></td>
                  <td className="px-5 py-2">
                    <select aria-label={`Equipe de ${u.nome}`} value={u.equipe_id || ""} onChange={(event) => vincular(u, event.target.value)}
                      className={`${inputCls} min-w-40 py-1.5 ${u.equipe_id ? "" : "border-amber-300 bg-amber-50"}`}>
                      {!u.equipe_id && <option value="" disabled>Selecione a equipe</option>}
                      {equipes.map((equipe) => <option key={equipe.id} value={equipe.id}>{equipe.nome}</option>)}
                    </select>
                  </td>
                  <td className="px-5 py-3"><Badge tone={u.ativo ? "emerald" : "slate"}>{u.ativo ? "Ativo" : "Inativo"}</Badge></td>
                </tr>
              ))}
              {!visiveis.length && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">Nenhum usuário nesta equipe.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {open && <NovoUsuario equipes={equipes} equipeInicial={abaAtiva !== TODAS && abaAtiva !== SEM_EQUIPE ? abaAtiva : ""}
        onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await carregar(); }} />}
    </div>
  );
}

function NovoUsuario({ equipes, equipeInicial, onClose, onSaved }) {
  const [f, setF] = useState({ nome: "", username: "", email: "", senha: "", papel: "EXECUTANTE", equipe_id: equipeInicial });
  const [erro, setErro] = useState("");
  const salvar = async () => {
    if (!f.nome || !f.username || !f.senha) { setErro("Nome, usuário e senha são obrigatórios."); return; }
    if (!f.equipe_id) { setErro("Selecione a equipe do usuário."); return; }
    try { await api.criarUsuario({ ...f, equipe_id: Number(f.equipe_id) }); onSaved(); } catch (e) { setErro(e.message); }
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Perfil</label>
            <select className={`mt-1 ${inputCls}`} value={f.papel} onChange={set("papel")}>
              {PAPEIS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Equipe</label>
            <select className={`mt-1 ${inputCls}`} value={f.equipe_id} onChange={set("equipe_id")}>
              <option value="">Selecione a equipe</option>
              {equipes.map((equipe) => <option key={equipe.id} value={equipe.id}>{equipe.nome}</option>)}
            </select>
          </div>
        </div>
        {!equipes.length && <p className="text-xs text-amber-700">Nenhuma equipe cadastrada. Cadastre uma equipe em Cadastros › Equipes antes de criar usuários.</p>}
        {erro && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}
      </div>
    </Modal>
  );
}
