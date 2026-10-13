import React, { useState } from "react";
import { AlertTriangle, Download, FileArchive, ShieldCheck } from "lucide-react";
import { api, salvarArquivo } from "../api.js";
import { Btn, Card } from "../components/ui.jsx";

export default function Exportacao() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const download = async () => {
    setDownloading(true);
    setError("");
    setSuccess("");
    try {
      const file = await api.exportacaoSap();
      salvarArquivo(file);
      setSuccess(`Pacote ${file.name} gerado com sucesso.`);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-5">
      <p className="text-sm text-slate-500">
        Gere um pacote com o histórico operacional do SIGMA·CCM e indicadores para conferência e preparação da carga no SAP.
      </p>
      <Card className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 p-3 text-indigo-700"><FileArchive className="h-6 w-6" /></div>
          <div>
            <h2 className="font-semibold text-slate-900">Pacote ZIP de arquivos CSV</h2>
            <p className="mt-1 text-sm text-slate-500">Um CSV separado por entidade, em UTF-8, com separador ponto e vírgula.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Dados operacionais</h3>
            <p className="mt-1 text-sm text-slate-500">Equipes, ativos, notas, OMs, execução, apontamentos, relatórios, planejamento, formulários, inspeções, permissões, notificações e auditoria.</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">KPIs e metas</h3>
            <p className="mt-1 text-sm text-slate-500">Resumo, evolução dos últimos 12 meses e detalhamento por equipe, área e equipamento.</p>
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>O pacote não contém senhas ou hashes, arquivos de fotos/assinaturas nem detalhes de ausências e atestados.</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Os CSVs são uma exportação genérica, não um layout de importação SAP. Para carga direta, a equipe SAP deverá fornecer e validar o template e o mapeamento dos campos.</p>
        </div>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
        <Btn onClick={download} disabled={downloading}>
          <Download className="h-4 w-4" /> {downloading ? "Gerando pacote…" : "Baixar pacote para SAP"}
        </Btn>
      </Card>
    </div>
  );
}
