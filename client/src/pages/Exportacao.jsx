import React, { useEffect, useState } from "react";
import { AlertTriangle, Download, FileArchive, RefreshCw, ShieldCheck } from "lucide-react";
import { api, salvarArquivo } from "../api.js";
import { Btn, Card } from "../components/ui.jsx";

export default function Exportacao() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fila, setFila] = useState([]);
  const [processing, setProcessing] = useState(false);

  const loadQueue = () => api.filaSap().then(setFila).catch((cause) => setError(cause.message));
  useEffect(() => { loadQueue(); }, []);

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

  const downloadConfirmations = async () => {
    setDownloading(true);
    setError("");
    try {
      const file = await api.exportarConfirmacoesSap();
      salvarArquivo(file);
      setSuccess(`Confirmações de ${file.name} geradas com sucesso.`);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setDownloading(false);
    }
  };

  const processQueue = async () => {
    setProcessing(true);
    setError("");
    try {
      const result = await api.processarFilaSap();
      setSuccess(`${result.processados} item(ns) processado(s) na fila SAP.`);
      await loadQueue();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setProcessing(false);
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
        <Btn variant="ghost" onClick={downloadConfirmations} disabled={downloading}>
          <Download className="h-4 w-4" /> Baixar confirmações SAP (JSON/XML + PDF Base64)
        </Btn>
      </Card>
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-semibold text-slate-900">Fila de envio das OMs</h2><p className="mt-1 text-sm text-slate-500">Toda OM encerrada fica registrada para envio e reprocessamento.</p></div>
          <Btn size="sm" variant="ghost" onClick={processQueue} disabled={processing}><RefreshCw className={`h-4 w-4 ${processing ? "animate-spin" : ""}`} /> Processar fila</Btn>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400"><th className="px-3 py-2">OM</th><th className="px-3 py-2">Status SAP</th><th className="px-3 py-2">Tentativas</th><th className="px-3 py-2">Último erro</th></tr></thead>
            <tbody>{fila.map((item) => <tr key={item.id} className="border-b border-slate-50"><td className="px-3 py-2 font-mono">{item.numero_ordem}</td><td className="px-3 py-2 font-semibold">{item.status}</td><td className="px-3 py-2">{item.tentativas}</td><td className="px-3 py-2 text-xs text-rose-700">{item.ultimo_erro || "—"}</td></tr>)}</tbody>
          </table>
          {!fila.length && <p className="py-6 text-center text-sm text-slate-400">Nenhuma OM na fila de integração.</p>}
        </div>
      </Card>
    </div>
  );
}
