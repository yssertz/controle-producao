"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { EmptyState, Loading, Notice, PageHeader } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { formatDate, formatQty, listLabel } from "@/lib/format";
import { fetchProgress, percent, type ProgressRow } from "@/lib/progress";

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
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows(await fetchProgress());
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

  return (
    <main className="content">
      <PageHeader
        eyebrow="PCP / Produção"
        title="Acompanhamento por lista e linha"
        subtitle="Percentual de peças produzidas em cada linha de cada lista. Clique em uma célula para apontar a produção."
        actions={
          <button className="btn secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> Atualizar
          </button>
        }
      />
      {error && <Notice kind="error">{error}</Notice>}

      <div className="toolbar">
        <label className="checkbox" style={{ paddingBottom: 9 }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Só listas em andamento (ocultar as 100%)
        </label>
      </div>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Nada para acompanhar ainda">Importe uma lista em “OPs e peças → Colar do Excel”: os itens com linha de produção aparecem aqui.</EmptyState>
        </div>
      ) : lists.length === 0 ? (
        <div className="card">
          <EmptyState title="Todas as listas estão 100%">Desmarque o filtro para ver as concluídas.</EmptyState>
        </div>
      ) : (
        <>
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
          <p className="muted" style={{ marginTop: 10 }}>
            Percentual = peças produzidas ÷ peças necessárias da linha. Linhas de laser “puras” (6KW, 12KW, 40KW) contam as peças <strong>cortadas nos nestings</strong>; as demais
            (GEKA, guilhotina, serra, usinagem, dobra…) contam o que for <strong>apontado</strong>. O total da lista é ponderado pela quantidade de peças.
          </p>
        </>
      )}
    </main>
  );
}
