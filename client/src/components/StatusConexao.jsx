import React, { useState } from "react";
import { AlertTriangle, CloudUpload, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { descartarPendencia, sincronizar, tentarNovamente } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useOnline, usePendencias } from "../offline/fila.js";
import { Badge, Btn, Modal } from "./ui.jsx";

const dateTimeBr = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Indicador de conexão e da fila de registros feitos sem conexão.
export default function StatusConexao() {
  const { user } = useAuth();
  const online = useOnline();
  const pendencias = usePendencias(user.id);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const errors = pendencias.filter((item) => item.status === "erro").length;
  const pending = pendencias.length;

  const sync = async (action = sincronizar) => {
    setSyncing(true);
    try { await action(); } finally { setSyncing(false); }
  };
  const label = `${online ? "Online" : "Offline"}${pending ? ` · ${pending} pendência(s) de sincronização` : ""}${errors ? `, ${errors} com erro` : ""}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} title={label}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${online ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>
        {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{online ? "Online" : "Offline"}</span>
        {pending > 0 && <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10px] text-white ${errors ? "bg-rose-600" : "bg-indigo-600"}`}>
          <CloudUpload className="h-3 w-3" /> {pending}
        </span>}
      </button>

      {open && <Modal title="Sincronização" subtitle={online ? "Conectado ao servidor." : "Sem conexão: os registros ficam guardados neste aparelho."} onClose={() => setOpen(false)} className="max-w-lg">
        <div className="space-y-4">
          {pending === 0
            ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Nenhuma pendência. Tudo sincronizado.</p>
            : <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {pendencias.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold text-slate-800">{item.descricao}</div>
                    <div className="text-xs text-slate-500">Registrado em {dateTimeBr(item.meta?.momento || item.criado_em)}</div>
                    {item.status === "erro" && <div className="mt-1 flex items-start gap-1 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {item.erro}</div>}
                  </div>
                  {item.status === "erro"
                    ? <div className="flex shrink-0 gap-1">
                      <Btn size="sm" variant="ghost" disabled={!online || syncing} onClick={() => sync(() => tentarNovamente(item.id))}>Tentar de novo</Btn>
                      <button type="button" aria-label={`Descartar ${item.descricao}`} title="Descartar"
                        onClick={() => window.confirm("Descartar este registro? Ele não será enviado ao servidor.") && descartarPendencia(item.id)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    : <Badge tone="indigo">Aguardando</Badge>}
                </li>
              ))}
            </ul>}
          <p className="text-xs text-slate-400">A sincronização acontece sozinha ao reconectar. Registros recusados pelo servidor (por exemplo, OM já encerrada) ficam marcados para você revisar.</p>
          <div className="flex justify-end">
            <Btn disabled={!online || syncing || !pending} onClick={() => sync()}><RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Sincronizando…" : "Sincronizar agora"}</Btn>
          </div>
        </div>
      </Modal>}
    </>
  );
}
