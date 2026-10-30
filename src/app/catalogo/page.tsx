"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Notice, PageHeader } from "@/components/ui";
import { fetchCatalogCount, importCatalog, searchCatalog, type CatalogHit } from "@/lib/catalog";
import { errorText } from "@/lib/errors";
import { parseCatalog, type CatalogParse } from "@/lib/excel-paste";
import { fetchErpCodes, fetchLines } from "@/lib/reference";
import type { ErpLineCode, ProductionLine } from "@/lib/types";

export default function CatalogoPage() {
  const { canPlan } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [erp, setErp] = useState<ErpLineCode[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<CatalogHit[] | null>(null);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<CatalogParse | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);

  const loadBase = useCallback(async () => {
    try {
      const [c, e, l] = await Promise.all([fetchCatalogCount(), fetchErpCodes(), fetchLines(false)]);
      setCount(c);
      setErp(e);
      setLines(l);
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  function lineOf(code: number | null): string {
    if (code === null) return "—";
    const e = erp.find((x) => x.code === code);
    if (!e) return `Código ${code} (desconhecido)`;
    const l = lines.find((x) => x.id === e.line_id);
    return l ? `${l.name} (ERP ${code})` : `Sem linha controlada (ERP ${code} · ${e.description})`;
  }

  async function search() {
    try {
      setHits(await searchCatalog(term));
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setText(await file.text());
    setParsed(null);
  }

  async function runImport() {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await importCatalog(parsed.rows, (done, total) => setProgress({ done, total }));
      const unknown = r.unknown_line_codes.length > 0 ? ` Códigos de linha do ERP sem cadastro (esses itens ficam sem linha): ${r.unknown_line_codes.join(", ")}.` : "";
      setMsg({ kind: r.unknown_line_codes.length > 0 ? "warning" : "success", text: `${r.processed} item(ns) gravado(s) no catálogo.${unknown}` });
      setParsed(null);
      setText("");
      await loadBase();
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <main className="content">
      <PageHeader
        eyebrow="PCP / Cadastros"
        title="Catálogo de itens"
        subtitle="Define em qual linha de produção cada item é fabricado. A colagem de OPs usa este catálogo para descobrir a linha."
      />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <div className="stack">
        <section className="card">
          <h2 className="section-title">Consultar item</h2>
          <p className="section-sub">{count === null ? "Carregando..." : `${count.toLocaleString("pt-BR")} itens no catálogo.`}</p>
          <div className="btn-row">
            <input className="input" style={{ maxWidth: 360 }} value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="Código ou parte da descrição" aria-label="Buscar item" />
            <button className="btn primary" onClick={() => void search()} disabled={term.trim() === ""}>Buscar</button>
          </div>
          {hits && (
            hits.length === 0 ? <p className="muted" style={{ marginTop: 10 }}>Nenhum item encontrado.</p> : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Item</th><th>Descrição</th><th>Linha</th></tr></thead>
                  <tbody>{hits.map((h) => <tr key={h.item_code}><td><strong>{h.item_code}</strong></td><td>{h.description ?? "—"}</td><td>{lineOf(h.erp_line_code)}</td></tr>)}</tbody>
                </table>
              </div>
            )
          )}
        </section>

        {canPlan ? (
          <section className="card">
            <h2 className="section-title">Importar / atualizar catálogo</h2>
            <p className="section-sub">
              Colunas, na ordem da aba <strong>MAQUINA</strong>: <strong>Cód. Linha | Linha de Produção | Item | Descrição</strong>. Cole as células copiadas do Excel
              ou escolha um arquivo .csv/.tsv/.txt. Itens já existentes são atualizados. O arquivo <code>supabase/seed/catalogo_itens.tsv</code> do projeto traz o catálogo atual da planilha Roll-On.
            </p>
            <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Arquivo do catálogo" />
            <textarea className="textarea" style={{ marginTop: 10 }} value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} placeholder={"310\tROD. GEKA\t1128028\tCH. GUIA LATERAL INT."} aria-label="Dados do catálogo" />
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn secondary" onClick={() => setParsed(parseCatalog(text))} disabled={text.trim() === "" || busy}>Analisar</button>
              <button className="btn primary" onClick={() => void runImport()} disabled={!parsed || parsed.rows.length === 0 || busy}>
                {busy ? (progress ? `Importando ${progress.done} / ${progress.total}...` : "Importando...") : `Importar ${parsed ? parsed.rows.length.toLocaleString("pt-BR") : ""} item(ns)`}
              </button>
            </div>
            {parsed && (
              <div style={{ marginTop: 12 }}>
                <Notice kind={parsed.errors.length > 0 ? "warning" : "info"}>
                  {parsed.rows.length.toLocaleString("pt-BR")} linha(s) válida(s){parsed.headerSkipped ? " (cabeçalho ignorado)" : ""}; {parsed.errors.length} com erro (não serão importadas).
                  {parsed.errors.slice(0, 5).map((e) => <div key={e.line}>Linha {e.line}: {e.message}</div>)}
                </Notice>
              </div>
            )}
          </section>
        ) : (
          <Notice kind="info">Seu perfil não permite importar o catálogo.</Notice>
        )}
      </div>
    </main>
  );
}
