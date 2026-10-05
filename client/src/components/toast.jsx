import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

// Confirmações rápidas (toast) após criar, editar, excluir e demais ações.
const ToastContext = createContext(null);
const DURATION = { success: 4500, info: 6000, error: 8000 };
const STYLE = {
  success: { Icon: CheckCircle2, box: "border-emerald-200 bg-white", icon: "text-emerald-600" },
  info: { Icon: Info, box: "border-amber-200 bg-white", icon: "text-amber-600" },
  error: { Icon: AlertTriangle, box: "border-rose-200 bg-white", icon: "text-rose-600" },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const sequence = useRef(0);
  const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const show = useCallback((tipo, mensagem, { action } = {}) => {
    if (!mensagem) return;
    const id = (sequence.current += 1);
    setToasts((list) => [...list.slice(-3), { id, tipo, mensagem, action }]);
    setTimeout(() => dismiss(id), DURATION[tipo]);
  }, [dismiss]);
  const api = useMemo(() => ({
    success: (mensagem, options) => show("success", mensagem, options),
    info: (mensagem, options) => show("info", mensagem, options),
    error: (mensagem, options) => show("error", mensagem, options),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end">
        {toasts.map((toast) => {
          const style = STYLE[toast.tipo];
          return (
            <div key={toast.id} role={toast.tipo === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3 text-sm text-slate-800 shadow-lg ${style.box}`}>
              <style.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.icon}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p>{toast.mensagem}</p>
                {toast.action && <button type="button" onClick={() => { toast.action.onClick(); dismiss(toast.id); }}
                  className="mt-1 font-semibold text-indigo-700 underline hover:text-indigo-900">{toast.action.label}</button>}
              </div>
              <button type="button" onClick={() => dismiss(toast.id)} aria-label="Fechar aviso" className="rounded-md p-0.5 text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// Atalho para telas que mostravam faixas de aviso: a mensagem vira toast
// (avisos de modo offline, que começam com "Sem conexão", saem como informação).
export function useNoticeToast() {
  const toast = useToast();
  return useCallback((mensagem) => {
    if (!mensagem) return;
    if (/^Sem conexão/.test(mensagem)) toast.info(mensagem); else toast.success(mensagem);
  }, [toast]);
}
