"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { DeliveryTracking, OpProductionLookup, ScrapTracking } from "@/components/OpTracking";
import { EmptyState, Loading, Notice, PageHeader, ProgressBar } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { formatDate, formatQty, listLabel } from "@/lib/format";
import { fetchProcessLineProgress, fetchProgress, percent, type ProgressRow } from "@/lib/progress";
import { aggregateLineProcesses, processKey, totalProcessProgress } from "@/lib/production-dashboard";

function cellClass(p: number | null): string {
  if (p === null) return "pill gray";
  if (p >= 100) return "pill green";
  if (p <= 0) return "pill red";
  return "pill amber";
}

function fmtPct(p: number | null): string {
  return p === null ? "—" : `${Math.round(p)}%`;
}

export default function AcompanhamentoPage() {
  const [tab, setTab] = useState<"producao" | "entrega" | "refugo">("producao");
  const [productionTab, setProductionTab] = useState<"processos" | "laser" | "listas">("processos");
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [processRowsRaw, setProcessRowsRaw] = useState<Awaited<ReturnType<typeof fetchProcessLineProgress>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [progress, processes] = await Promise.all([fetchProgress(), fetchProcessLineProgress()]);
      setRows(progress);
      setProcessRowsRaw(processes);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const { lists, lines } = useMemo(() => {
    const byList = new Map<string, { id: string; code: string | null; name: string; delivery: string | null; done: number; total: number }>();
    const byLine = new Map<string, { id: string; name: string; sort: number }>();
    for (const r of rows) {
      const l = byList.get(r.list_id) ?? { id: r.list_id, code: r.list_code, name: r.list_name, delivery: r.delivery_date, done: 0, total: 0 };
      l.done += r.qty_done;
      l.total += r.qty_total;
      byList.set(r.list_id, l);
      byLine.set(r.line_id, { id: r.line_id, name: r.line_name, sort: r.sort_order });
    }
    let listArr = [...byList.values()].sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", "pt-BR", { numeric: true }) || a.name.localeCompare(b.name));
    if (onlyOpen) listArr = listArr.filter((l) => (percent(l.done, l.total) ?? 0) < 100);
    return { lists: listArr, lines: [...byLine.values()].sort((a, b) => a.sort - b.sort) };
  }, [rows, onlyOpen]);

  const cell = useMemo(() => new Map(rows.map((r) => [`${r.list_id}|${r.line_id}`, r])), [rows]);
  const processRows = useMemo(() => aggregateLineProcesses(processRowsRaw), [processRowsRaw]);
  const laserRows = useMemo(() => processRows.filter((row) => processKey(row.line_name).includes("laser")), [processRows]);
  const visibleProcessRows = productionTab === "laser" ? laserRows : processRows;
  const fabrication = useMemo(() => totalProcessProgress(processRows, "Fabricação"), [processRows]);
  const folding = useMemo(() => totalProcessProgress(processRows, "Dobra"), [processRows]);

  return (
    <main className="content">
      <PageHeader
        eyebrow="PCP / Produção"
        title="Acompanhamento"
        subtitle={tab === "producao" ? "Acompanhe as etapas da produção e consulte uma OP pelo QR code." : tab === "entrega" ? "Registre a entrega integral da OP depois da conferência do abastecedor." : "Registre refugos por peça e processo; a reposição é obrigatória."}
        actions={
          tab === "producao" ? <button className="btn secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> Atualizar
          </button> : undefined
        }
      />
      {error && <Notice kind="error">{error}</Notice>}

      <div className="btn-row" role="tablist" aria-label="Tipo de acompanhamento" style={{ marginBottom: 16 }}>
        {([
          ["producao", "Produção"],
          ["entrega", "Entrega"],
          ["refugo", "Refugo"],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value}
            className={tab === value ? "pill blue" : "pill gray"}
            style={{ border: 0, cursor: "pointer", fontSize: 13, padding: "7px 14px" }}
            onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "entrega" && <DeliveryTracking />}
      {tab === "refugo" && <ScrapTracking />}

      {tab === "producao" && <>
      <OpProductionLookup />
      <div className="btn-row" role="tablist" aria-label="Painel de produção" style={{ margin: "14px 0" }}>
        {([ ["processos", "Processos"], ["laser", "Laser"], ["listas", "Por lista"] ] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={productionTab === value}
            className={productionTab === value ? "pill blue" : "pill gray"}
            style={{ border: 0, cursor: "pointer", fontSize: 13, padding: "7px 14px" }}
            onClick={() => setProductionTab(value)}>{label}</button>
        ))}
      </div>

      {productionTab !== "listas" && <div className="toolbar">
        <label className="checkbox" style={{ paddingBottom: 9 }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Ocultar processos 100% concluídos
        </label>
      </div>}

      {loading ? (
        <Loading />
      ) : productionTab === "listas" && rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Nada para acompanhar ainda">Importe uma lista em “OPs e peças → Colar do Excel”: os itens com linha de produção aparecem aqui.</EmptyState>
        </div>
      ) : productionTab === "listas" && lists.length === 0 ? (
        <div className="card">
          <EmptyState title="Todas as listas estão 100%">Desmarque o filtro para ver as concluídas.</EmptyState>
        </div>
      ) : productionTab !== "listas" && visibleProcessRows.length === 0 ? (
        <div className="card"><EmptyState title={productionTab === "laser" ? "Nenhum processo laser encontrado" : "Nenhum processo encontrado"} /></div>
      ) : productionTab !== "listas" ? (
        <>
          {productionTab === "processos" && <div className="grid two" style={{ marginBottom: 14 }}>
            {([["Fabricação", fabrication], ["Dobra", folding]] as const).map(([label, total]) => (
              <section className="card" key={label}>
                <div className="eyebrow">Gargalo · {label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                  <strong style={{ fontSize: 26 }}>{fmtPct(percent(total.qty_done, total.qty_total))}</strong>
                  <span className="muted">{formatQty(total.qty_done)} de {formatQty(total.qty_total)} peças-processo</span>
                </div>
                <ProgressBar value={percent(total.qty_done, total.qty_total) ?? 0} tone={(percent(total.qty_done, total.qty_total) ?? 0) >= 100 ? "green" : "blue"} />
                <div className="muted" style={{ marginTop: 6 }}>{total.items} etapas de OP · {formatQty(Math.max(0, total.qty_total - total.qty_done))} pendentes</div>
              </section>
            ))}
          </div>}
          {productionTab === "laser" && <section className="card" style={{ marginBottom: 14 }}>
            <h2 className="section-title">Acompanhamento exclusivo das linhas laser</h2>
            <p className="section-sub">Corte conta como fabricado quando o nesting é concluído. Em linhas laser compostas, cada processo segue sua própria baixa. Entregue só aparece após a baixa integral da OP.</p>
          </section>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Linha</th><th>Processo</th><th className="num">OPs</th><th className="num">Necessário</th><th className="num">Fabricado</th><th className="num">Entregue</th><th className="num">Pendente</th><th>Avanço</th></tr></thead>
              <tbody>
                {visibleProcessRows.filter((r) => !onlyOpen || r.qty_done < r.qty_total).map((r) => {
                  const p = percent(r.qty_done, r.qty_total);
                  return <tr key={`${r.line_name}|${processKey(r.process_name)}`}>
                    <td><strong>{r.line_name}</strong></td><td>{r.process_name}</td>
                    <td className="num">{r.items}</td><td className="num">{formatQty(r.qty_total)}</td>
                    <td className="num">{formatQty(r.qty_done)}</td><td className="num">{formatQty(r.qty_delivered)}</td>
                    <td className="num">{formatQty(Math.max(0, r.qty_total - r.qty_done))}</td>
                    <td><span className={cellClass(p)}>{fmtPct(p)}</span></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>Os totais somam o volume de cada etapa (peças-processo), para comparar filas e identificar gargalos. Dobra agrega todas as linhas; Fabricação agrega os demais processos.</p>
        </>
      ) : (
        <>
          <div className="toolbar">
            <label className="checkbox" style={{ paddingBottom: 9 }}>
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              Só listas em andamento (ocultar as 100%)
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: "var(--table-head)" }}>Linha</th>
                  {lists.map((l) => (
                    <th key={l.id} style={{ textAlign: "center", minWidth: 120 }}>
                      <Link className="link" href={`/listas/${l.id}`}>{listLabel(l.code, l.name)}</Link>
                      <div className="muted" style={{ textTransform: "none", fontWeight: 400 }}>entrega {formatDate(l.delivery)}</div>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: "var(--table-head)" }}>TOTAL</th>
                  {lists.map((l) => {
                    const p = percent(l.done, l.total);
                    return (
                      <th key={l.id} style={{ textAlign: "center" }}>
                        <span className={cellClass(p)}>{fmtPct(p)}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {lines.map((ln) => (
                  <tr key={ln.id}>
                    <td style={{ position: "sticky", left: 0, background: "var(--surface)", fontWeight: 600 }}>{ln.name}</td>
                    {lists.map((l) => {
                      const c = cell.get(`${l.id}|${ln.id}`);
                      if (!c) return <td key={l.id} style={{ textAlign: "center" }} className="muted">—</td>;
                      const p = percent(c.qty_done, c.qty_total);
                      return (
                        <td key={l.id} style={{ textAlign: "center" }}>
                          <Link href={`/acompanhamento/apontar?lista=${l.id}&linha=${ln.id}`} title={`${formatQty(c.qty_done)} de ${formatQty(c.qty_total)} peças · ${c.items} item(ns)${c.progress_source === "nesting" ? " · vem dos nestings" : ""}`}>
                            <span className={cellClass(p)}>{fmtPct(p)}</span>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>Percentual por lista/linha segue o acompanhamento legado da produção. Use as abas Processos e Laser para o volume por etapa e a separação entre fabricação e entrega.</p>
        </>
      )}
      </>}
    </main>
  );
}
