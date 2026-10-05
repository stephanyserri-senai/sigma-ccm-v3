import React, { useEffect, useId, useRef } from "react";
import { AlertTriangle, Inbox, RefreshCw, X } from "lucide-react";

export const Eyebrow = ({ children }) => (
  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</div>
);

const TONES = {
  slate: "bg-slate-100 text-slate-600",
  indigo: "bg-indigo-50 text-indigo-700",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-700",
};
export function Badge({ children, tone = "slate" }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone] || TONES.slate}`}>{children}</span>;
}
export const statusTone = (s) =>
  ({
    Aberta: "amber", Programada: "indigo", "Distribuída": "indigo", "Em execução": "indigo",
    Encerrada: "emerald", "Em OM": "emerald", Nova: "amber", Aceita: "emerald",
    Rejeitada: "slate", Cancelada: "slate",
  }[s] || "slate");

// Datas ISO (AAAA-MM-DD) em formato brasileiro; valores antigos em outro formato são mantidos.
export const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
export const dataBr = (value) => (isIsoDate(value) ? value.split("-").reverse().join("/") : value || "");

export const Card = ({ children, className = "", title }) => (
  <div title={title} className={`rounded-2xl border border-slate-200 bg-white ${className}`}>{children}</div>
);

export function Btn({ children, onClick, variant = "primary", disabled, size = "md", type = "button", className = "", ...rest }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";
  const sz = size === "sm" ? "min-h-8 px-3 py-1.5 text-xs" : "min-h-10 px-4 py-2 text-sm";
  const v = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400",
    ghost: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-300",
    danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:text-rose-300",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sz} ${v} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:bg-slate-50 disabled:text-slate-500";

// Estado de carregamento padrão.
export function Spinner({ label = "Carregando…" }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-hidden="true" />
      {label}
    </div>
  );
}

// Estado vazio padrão: o que aconteceu e, quando houver, o próximo passo.
export function EmptyState({ title, children, action, icon: Icon = Inbox, className = "" }) {
  return (
    <div className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      <Icon className="h-8 w-8 text-slate-300" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Erro ao carregar uma tela, com opção de tentar de novo.
export function ErrorState({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
        <div>
          <p className="font-semibold">Não foi possível carregar esta tela.</p>
          <p className="mt-0.5">{message || "Tente novamente em instantes."}</p>
        </div>
      </div>
      <Btn variant="ghost" size="sm" onClick={onRetry || (() => window.location.reload())}><RefreshCw className="h-3.5 w-3.5" /> Tentar novamente</Btn>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Diálogo acessível: Esc fecha, o foco entra no diálogo, fica preso nele e volta ao elemento de origem.
export function Modal({ title, subtitle, onClose, children, footer, className = "max-w-md" }) {
  const titleId = useId();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector(`[autofocus], ${FOCUSABLE}`);
    (first || node)?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); closeRef.current?.(); return; }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-2 sm:items-center sm:p-4" style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl focus:outline-none sm:max-h-[calc(100dvh-2rem)] sm:p-6 ${className}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={titleId} className="text-lg font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
