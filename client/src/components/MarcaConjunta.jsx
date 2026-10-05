import React from "react";

// Assinatura conjunta VLI | SIGMA·CCM: as duas marcas na mesma altura visual,
// separadas por um fio vertical, como num lockup de co-branding. Sem cartão de fundo:
// "tema" adapta as cores à paleta da tela (claro = fundo claro; escuro = menu escuro ou azul VLI).
// "xs" é a versão compacta do menu lateral (sem o subtítulo).
const SIZES = {
  xs: { vli: "h-7", gap: "gap-2.5", fio: "h-7", icone: "h-7 w-7 rounded-lg", nome: "text-[15px]", sub: null },
  sm: { vli: "h-9", gap: "gap-3.5", fio: "h-10", icone: "h-8 w-8 rounded-xl", nome: "text-lg", sub: "text-[10px]" },
  lg: { vli: "h-14", gap: "gap-6", fio: "h-14", icone: "h-11 w-11 rounded-xl", nome: "text-2xl", sub: "text-xs" },
};
const THEMES = {
  claro: { logo: "/vli-logo.png", fio: "bg-slate-300", nome: "text-slate-900", ccm: "text-indigo-600", sub: "text-slate-500", icone: "" },
  escuro: { logo: "/vli-logo-branco.png", fio: "bg-white/30", nome: "text-white", ccm: "text-indigo-200", sub: "text-white/80", icone: "ring-1 ring-white/25" },
};

export default function MarcaConjunta({ size = "lg", tema = "claro", className = "" }) {
  const s = SIZES[size];
  const t = THEMES[tema];
  return (
    <div className={`inline-flex max-w-full items-center ${s.gap} ${className}`}>
      <img src={t.logo} alt="VLI" className={`${s.vli} w-auto shrink-0`} />
      <span aria-hidden="true" className={`${s.fio} w-px shrink-0 ${t.fio}`} />
      <div className="flex min-w-0 items-center gap-2" aria-label="SIGMA·CCM, Centro de Controle da Manutenção" role="img">
        <img src="/sigma-icon.svg" alt="" className={`${s.icone} shrink-0 ${t.icone}`} />
        <div className="min-w-0 leading-none">
          <div className={`${s.nome} whitespace-nowrap font-extrabold tracking-tight ${t.nome}`}>SIGMA<span className={t.ccm}>·CCM</span></div>
          {s.sub && <div className={`${s.sub} mt-1 font-medium leading-tight ${t.sub}`}>Centro de Controle da Manutenção</div>}
        </div>
      </div>
    </div>
  );
}
