"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { BackLink, EmptyState, Loading, Notice, Pagination } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { parseDecimalBR } from "@/lib/excel-paste";
import { formatQty, listLabel } from "@/lib/format";
import { fetchItemsByIds } from "@/lib/items";
import { fetchLineItems, fetchProgress, setItemsDone, type LineItem, type ProgressRow } from "@/lib/progress";
import { formatMm } from "@/lib/thickness";

function ApontarContent() {
  const { canOperate } = useAuth();
  const params = useSearchParams();
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [listId, setListId] = useState(params.get("lista") ?? "");
  const [lineId, setLineId] = useState(params.get("linha") ?? "");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<LineItem[]>([]);
  const [cuts, setCuts] = useState<Map<string, number>>(new Map());
  const [total, setTotal] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchProgress().then(setProgress).catch((e) => setMsg({ kind: "error", text: errorText(e) }));
  }, []);

  const lists = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    progress.forEach((r) => m.set(r.list_id, { id: r.list_id, label: listLabel(r.list_code, r.list_name) }));
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
  }, [progress]);
  const linesOfList = useMemo(() => progress.filter((r) => r.list_id === listId).sort((a, b) => a.sort_order - b.sort_order), [progress, listId]);
  const source = linesOfList.find((l) => l.line_id === lineId)?.progress_source ?? "manual";

  const load = useCallback(async () => {
    if (!listId || !lineId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchLineItems(listId, lineId, page);
      setItems(r.rows);
      setTotal(r.total);
      setValues(Object.fromEntries(r.rows.map((i) => [i.id, String(i.qty_done).replace(".", ",")])));
      // linhas de nesting: mostra o cortado (somente leitura)
      const bal = await fetchItemsByIds(r.rows.map((i) => i.id));
      setCuts(new Map(bal.map((b) => [b.id, b.qty_cut])));
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, [listId, lineId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const changed: { id: string; qty_done: number }[] = [];
    for (const i of items) {
      const v = parseDecimalBR(values[i.id] ?? "").value;
      if (v === null || v < 0 || v > i.quantity) {
        setMsg({ kind: "error", text: `OP ${i.op_number}: informe um valor entre 0 e ${formatQty(i.quantity)}.` });
        return;
      }
      if (v !== i.qty_done) changed.push({ id: i.id, qty_done: v });
    }
    if (changed.length === 0) {
      setMsg({ kind: "success", text: "Nada foi alterado." });
      return;
    }
    setBusy(true);
    try {
      const n = await setItemsDone(changed);
      setMsg({ kind: "success", text: `${n} apontamento(s) salvo(s).` });
      await load();
      setProgress(await fetchProgress());
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="content">
      <BackLink href="/acompanhamento">Voltar para o acompanhamento</BackLink>
      <div className="heading">
        <div>
          <div className="eyebrow">PCP / Produção</div>
          <h1>Apontar produção</h1>
          <p className="subtitle">Informe quantas peças de cada OP já foram produzidas na linha.</p>
        </div>
      </div>
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <div className="toolbar">
        <div className="field" style={{ minWidth: 280 }}>
          <label htmlFor="a-list">Lista</label>
          <select id="a-list" className="select" value={listId} onChange={(e) => { setListId(e.target.value); setLineId(""); setPage(0); }}>
            <option value="">Selecione...</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 240 }}>
          <label htmlFor="a-line">Linha</label>
          <select id="a-line" className="select" value={lineId} onChange={(e) => { setLineId(e.target.value); setPage(0); }} disabled={!listId}>
            <option value="">Selecione...</option>
            {linesOfList.map((l) => <option key={l.line_id} value={l.line_id}>{l.line_name}</option>)}
          </select>
        </div>
      </div>

      {!listId || !lineId ? (
        <div className="card"><EmptyState title="Escolha a lista e a linha" /></div>
      ) : loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="card"><EmptyState title="Nenhum item nesta lista e linha" /></div>
      ) : (
        <>
          {source === "nesting" && (
            <Notice kind="info">A produção desta linha vem dos <strong>nestings</strong> (peças cortadas). Aqui é só consulta; registre as quantidades cortadas no nesting.</Notice>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>OP</th><th>Item</th><th>Matéria-prima</th><th>Espessura</th><th className="num">Necessário</th><th>{source === "nesting" ? "Cortado" : "Produzido"}</th><th className="num">Falta</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const done = source === "nesting" ? Math.min(cuts.get(i.id) ?? 0, i.quantity) : parseDecimalBR(values[i.id] ?? "").value ?? 0;
                  return (
                    <tr key={i.id}>
                      <td><strong>{i.op_number}</strong></td>
                      <td>{i.item_code ?? "—"}</td>
                      <td style={{ maxWidth: 240 }} className="muted">{i.material ?? i.description ?? "—"}</td>
                      <td className="nowrap">{formatMm(i.thickness_mm)}</td>
                      <td className="num">{formatQty(i.quantity)}</td>
                      <td style={{ minWidth: 120 }}>
                        {source === "nesting" ? (
                          formatQty(done)
                        ) : (
                          <input className="input cell-input" inputMode="decimal" value={values[i.id] ?? ""} disabled={!canOperate} onChange={(e) => setValues((v) => ({ ...v, [i.id]: e.target.value }))} aria-label={`Produzido da OP ${i.op_number}`} />
                        )}
                      </td>
                      <td className="num">{formatQty(Math.max(0, i.quantity - done))}</td>
                      <td>
                        {source === "manual" && canOperate && (
                          <button type="button" className="btn secondary small" onClick={() => setValues((v) => ({ ...v, [i.id]: String(i.quantity).replace(".", ",") }))}>Tudo</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} onPage={setPage} />
          {source === "manual" && canOperate && (
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Salvando..." : "Salvar apontamentos"}</button>
              <button className="btn secondary" onClick={() => setValues(Object.fromEntries(items.map((i) => [i.id, String(i.quantity).replace(".", ",")])))}>Marcar toda a página como produzida</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function ApontarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ApontarContent />
    </Suspense>
  );
}
