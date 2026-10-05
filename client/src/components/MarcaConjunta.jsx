import React from "react";

// Assinatura conjunta VLI | SIGMA·CCM: as duas marcas na mesma altura visual,
// separadas por um fio vertical, como num lockup de co-branding.
const SIZES = {
  sm: { vli: "h-9", gap: "gap-3.5", fio: "h-10", icone: "h-8 w-8", nome: "text-lg", sub: "text-[10px]" },
  lg: { vli: "h-14", gap: "gap-6", fio: "h-14", icone: "h-11 w-11", nome: "text-2xl", sub: "text-xs" },
};

export default function MarcaConjunta({ size = "lg", className = "" }) {
  const s = SIZES[size];
  return (
    <div className={`inline-flex max-w-full items-center ${s.gap} ${className}`}>
      <img src="/vli-logo.png" alt="VLI" className={`${s.vli} w-auto shrink-0`} />
      <span aria-hidden="true" className={`${s.fio} w-px shrink-0 bg-slate-300`} />
      <div className="flex min-w-0 items-center gap-2.5" aria-label="SIGMA·CCM, Centro de Controle da Manutenção" role="img">
        <img src="/sigma-icon.svg" alt="" className={`${s.icone} shrink-0 rounded-xl`} />
        <div className="min-w-0 leading-none">
          <div className={`${s.nome} font-extrabold tracking-tight text-slate-900`}>SIGMA<span className="text-indigo-600">·CCM</span></div>
          <div className={`${s.sub} mt-1 font-medium leading-tight text-slate-500`}>Centro de Controle da Manutenção</div>
        </div>
      </div>
    </div>
  );
}
