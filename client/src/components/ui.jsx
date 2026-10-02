import React from "react";

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

export function Btn({ children, onClick, variant = "primary", disabled, size = "md", type = "button", className = "" }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed";
  const sz = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const v = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400",
    ghost: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-300",
    danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sz} ${v} ${className}`}>
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
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none";

export function Spinner({ label = "Carregando…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, className = "max-w-md" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,23,42,0.45)" }}>
      <Card className={`w-full ${className} p-6`}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </Card>
    </div>
  );
}
