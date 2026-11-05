"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { BackLink, EmptyState, Loading, Notice, Pagination } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { parseDecimalBR } from "@/lib/excel-paste";
import { formatQty, listLabel } from "@/lib/format";
import { fetchItemsByIds } from "@/lib/items";
import { fetchLineProcesses, fetchProcessItems, fetchProgress, setProcessStepsDone, type LineItem, type ProcessOption, type ProgressRow } from "@/lib/progress";
import { formatMm } from "@/lib/thickness";

function ApontarContent() {
  const { canOperate } = useAuth();
  const params = useSearchParams();
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [listId, setListId] = useState(params.get("lista") ?? "");
  const [lineId, setLineId] = useState(params.get("linha") ?? "");
  const [processId, setProcessId] = useState("");
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
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

  useEffect(() => {
    if (!lineId) { setProcesses([]); setProcessId(""); return; }
    fetchLineProcesses(lineId).then((options) => {
      setProcesses(options);
      setProcessId((current) => options.some((p) => p.id === current) ? current : options[0]?.id ?? "");
    }).catch((e) => setMsg({ kind: "error", text: errorText(e) }));
  }, [lineId]);

  const load = useCallback(async () => {
    if (!listId || !lineId || !processId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchProcessItems(listId, lineId, processId, page);
      setItems(r.rows);
      setTotal(r.total);
      setValues(Object.fromEntries(r.rows.map((i) => [i.step_id, String(i.qty_done).replace(".", ",")])));
      // linhas de nesting: mostra o cortado (somente leitura)
      const bal = await fetchItemsByIds(r.rows.map((i) => i.id));
      setCuts(new Map(bal.map((b) => [b.id, b.qty_cut])));
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, [listId, lineId, processId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const changed: { step_id: string; quantity_completed: number }[] = [];
    for (const i of items) {
      const stepId = (i as LineItem & { step_id: string }).step_id;
      const v = parseDecimalBR(values[stepId] ?? "").value;
      if (v === null || v < 0 || v > i.quantity) {
        setMsg({ kind: "error", text: `OP ${i.op_number}: informe um valor entre 0 e ${formatQty(i.quantity)}.` });
        return;
      }
      if (v !== i.qty_done) changed.push({ step_id: stepId, quantity_completed: v });
    }
    if (changed.length === 0) {
      setMsg({ kind: "success", text: "Nada foi alterado." });
      return;
    }
    setBusy(true);
    try {
      const n = await setProcessStepsDone(changed);
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
          <p className="subtitle">Informe a quantidade concluída em cada processo. Cada etapa possui seu próprio saldo.</p>
        </div>
      </div>
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <div className="card process-selection"><div className="toolbar">
        <div className="field" style={{ minWidth: 280 }}>
          <label htmlFor="a-list">Lista</label>
          <select id="a-list" className="select" value={listId} onChange={(e) => { setListId(e.target.value); setLineId(""); setPage(0); }}>
            <option value="">Selecione...</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 240 }}>
          <label htmlFor="a-line">Linha</label>
          <select id="a-line" className="select" value={lineId} onChange={(e) => { setLineId(e.target.value); setProcessId(""); setPage(0); }} disabled={!listId}>
            <option value="">Selecione...</option>
            {linesOfList.map((l) => <option key={l.line_id} value={l.line_id}>{l.line_name}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="a-process">Processo</label>
          <select id="a-process" className="select" value={processId} onChange={(e) => { setProcessId(e.target.value); setPage(0); }} disabled={!lineId || !processes.length}>
            <option value="">Selecione...</option>
            {processes.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}
          </select>
        </div>
      </div>
      </div>

      {!listId || !lineId || !processId ? (
        <div className="card"><EmptyState title="Escolha a lista, a linha e o processo" /></div>
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
                  const stepId = (i as LineItem & { step_id: string }).step_id;
                  const done = source === "nesting" ? Math.min(cuts.get(i.id) ?? 0, i.quantity) : parseDecimalBR(values[stepId] ?? "").value ?? 0;
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
                          <input className="input cell-input" inputMode="decimal" value={values[stepId] ?? ""} disabled={!canOperate} onChange={(e) => setValues((v) => ({ ...v, [stepId]: e.target.value }))} aria-label={`${processes.find((p) => p.id === processId)?.name ?? "Processo"} produzido da OP ${i.op_number}`} />
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
          {canOperate && (
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Salvando..." : "Salvar apontamentos"}</button>
              <button className="btn secondary" onClick={() => setValues(Object.fromEntries(items.map((i) => [(i as LineItem & { step_id: string }).step_id, String(i.quantity).replace(".", ",")])))}>Marcar toda a página como produzida</button>
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
