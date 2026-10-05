import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Card, Spinner, inputCls } from "../components/ui.jsx";

const SIZES = [25, 50, 100];
const EMPTY = { usuario_id: "", acao: "", de: "", ate: "" };
// A trilha grava em UTC ("AAAA-MM-DD HH:MM:SS"); exibe no horário local.
const dateTimeBr = (value) => new Date(`${value.replace(" ", "T")}Z`).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
const ACCENTS = {
  apropriacao: "apropriação", alocacao: "alocação", disponivel: "disponível", evidencias: "evidências", execucao: "execução",
  exigencia: "exigência", formulario: "formulário", inspecao: "inspeção", intercorrencia: "intercorrência", notificacao: "notificação",
  ocorrencia: "ocorrência", parametro: "parâmetro", permissao: "permissão", relatorio: "relatório", sinalizacao: "sinalização", usuario: "usuário",
};
const actionLabel = (acao) => acao.split("_").map((word) => ACCENTS[word] || word).join(" ").replace(/^\S/, (letter) => letter.toUpperCase());

export default function Auditoria() {
  const [filters, setFilters] = useState(EMPTY);
  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanho] = useState(SIZES[0]);
  const [options, setOptions] = useState({ usuarios: [], acoes: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { api.auditoriaFiltros().then(setOptions).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = Object.fromEntries(Object.entries({ ...filters, pagina, tamanho }).filter(([, value]) => value !== ""));
    api.auditoria(query)
      .then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, pagina, tamanho]);

  const setFilter = (key) => (event) => { setFilters((previous) => ({ ...previous, [key]: event.target.value })); setPagina(1); };
  const filtered = Object.values(filters).some(Boolean);
  const first = data && data.total ? (data.pagina - 1) * data.tamanho + 1 : 0;
  const last = data ? Math.min(data.total, data.pagina * data.tamanho) : 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">Registro de quem fez o quê e quando no portal. Somente leitura; visível apenas ao perfil CCM.</p>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_10rem_auto] lg:items-end">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Usuário</span>
            <select className={`mt-1 ${inputCls}`} value={filters.usuario_id} onChange={setFilter("usuario_id")}>
              <option value="">Todos os usuários</option>
              {options.usuarios.map((user) => <option key={user.id} value={user.id}>{user.nome} · {user.username} ({user.papel})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Ação</span>
            <select className={`mt-1 ${inputCls}`} value={filters.acao} onChange={setFilter("acao")}>
              <option value="">Todas as ações</option>
              {options.acoes.map((item) => <option key={item.acao} value={item.acao}>{actionLabel(item.acao)} ({item.total})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">De</span>
            <input type="date" max={filters.ate || undefined} className={`mt-1 ${inputCls}`} value={filters.de} onChange={setFilter("de")} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Até</span>
            <input type="date" min={filters.de || undefined} className={`mt-1 ${inputCls}`} value={filters.ate} onChange={setFilter("ate")} />
          </label>
          <Btn variant="ghost" disabled={!filtered} onClick={() => { setFilters(EMPTY); setPagina(1); }}><X className="h-4 w-4" /> Limpar</Btn>
        </div>
      </Card>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <Card>
        {!data ? <Spinner /> : <>
          <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-semibold">Quando</th>
                  <th className="px-5 py-3 font-semibold">Quem</th>
                  <th className="px-5 py-3 font-semibold">O quê</th>
                  <th className="px-5 py-3 font-semibold">Registro</th>
                  <th className="px-5 py-3 font-semibold">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {data.itens.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50 align-top last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums text-slate-600">{dateTimeBr(item.data_hora)}</td>
                    <td className="px-5 py-3">
                      {item.usuario_nome
                        ? <><div className="font-semibold text-slate-800">{item.usuario_nome}</div><div className="text-xs text-slate-400">{item.username} · {item.papel}</div></>
                        : <span className="text-slate-400">Sistema</span>}
                    </td>
                    <td className="px-5 py-3"><Badge tone="indigo">{actionLabel(item.acao)}</Badge></td>
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-slate-500">{item.entidade ? `${item.entidade}${item.entidade_id ? ` #${item.entidade_id}` : ""}` : "—"}</td>
                    <td className="max-w-md break-words px-5 py-3 text-slate-600">{item.detalhe || "—"}</td>
                  </tr>
                ))}
                {!data.itens.length && <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">Nenhum registro para os filtros escolhidos.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
            <span className="tabular-nums">{data.total ? `Mostrando ${first}–${last} de ${data.total}` : "0 registros"}</span>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                Por página
                <select className={`${inputCls} w-auto py-1`} value={tamanho} onChange={(event) => { setTamanho(Number(event.target.value)); setPagina(1); }}>
                  {SIZES.map((size) => <option key={size}>{size}</option>)}
                </select>
              </label>
              <Btn size="sm" variant="ghost" disabled={loading || data.pagina <= 1} onClick={() => setPagina(data.pagina - 1)}><ChevronLeft className="h-4 w-4" /><span className="sr-only">Página anterior</span></Btn>
              <span className="tabular-nums text-xs">Página {data.pagina} de {data.paginas}</span>
              <Btn size="sm" variant="ghost" disabled={loading || data.pagina >= data.paginas} onClick={() => setPagina(data.pagina + 1)}><ChevronRight className="h-4 w-4" /><span className="sr-only">Próxima página</span></Btn>
            </div>
          </div>
        </>}
      </Card>
    </div>
  );
}
