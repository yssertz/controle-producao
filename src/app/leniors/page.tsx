"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { EmptyState, Loading, Notice, PageHeader, ProgressBar } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { formatQty, listLabel } from "@/lib/format";
import { setItemInvoice } from "@/lib/items";
import { fetchLeniorsItems, isFinished, nextState, setLeniorsStep, STEP_NAMES, type LeniorsItem, type StepState } from "@/lib/leniors";
import { fetchListOptions, type ListOption } from "@/lib/reference";

const STATE_CLASS: Record<StepState, string> = { Aguardando: "gray", Concluída: "green", "Não se aplica": "blue" };

export default function LeniorsPage() {
  const { canOperate } = useAuth();
  const [lists, setLists] = useState<ListOption[]>([]);
  const [listId, setListId] = useState("");
  const [items, setItems] = useState<LeniorsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchListOptions(false)
      .then((l) => {
        const leniors = l.filter((x) => x.list_type === "Leniors");
        setLists(leniors);
        if (leniors.length === 1) setListId(leniors[0].id);
      })
      .catch((e) => setMsg({ kind: "error", text: errorText(e) }));
  }, []);

  const load = useCallback(async () => {
    if (!listId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      setItems(await fetchLeniorsItems(listId));
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, [listId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const ops = new Map<string, boolean>();
    items.forEach((i) => ops.set(i.op_number, (ops.get(i.op_number) ?? true) && isFinished(i)));
    const total = ops.size;
    const done = [...ops.values()].filter(Boolean).length;
    return { total, done, pct: total > 0 ? (done / total) * 100 : 0 };
  }, [items]);

  async function cycle(item: LeniorsItem, idx: 0 | 1 | 2) {
    const state = nextState(item.steps[idx]);
    try {
      await setLeniorsStep(item.id, (idx + 1) as 1 | 2 | 3, state);
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== item.id) return i;
          const steps = [...i.steps] as LeniorsItem["steps"];
          steps[idx] = state;
          return { ...i, steps };
        }),
      );
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
      await load();
    }
  }

  async function saveInvoice(item: LeniorsItem, value: string) {
    if ((item.invoice_number ?? "") === value.trim()) return;
    try {
      await setItemInvoice([item.id], value);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, invoice_number: value.trim() || null } : i)));
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
      await load();
    }
  }

  return (
    <main className="content">
      <PageHeader
        eyebrow="Produção / Leniors"
        title="Acompanhamento Leniors"
        subtitle="Corte, dobra, acabamento e nota fiscal de cada OP enviada à filial. Clique em uma etapa para alternar: Aguardando → Concluída → Não se aplica."
      />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <div className="toolbar">
        <div className="field" style={{ minWidth: 280 }}>
          <label htmlFor="l-list">Lista Leniors</label>
          <select id="l-list" className="select" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Selecione...</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{listLabel(l.code, l.name)}</option>)}
          </select>
        </div>
      </div>

      {lists.length === 0 ? (
        <div className="card"><EmptyState title="Nenhuma lista do tipo Leniors">Crie uma lista do tipo Leniors em “Listas de produção” e cadastre os itens nela.</EmptyState></div>
      ) : !listId ? (
        <div className="card"><EmptyState title="Selecione uma lista Leniors" /></div>
      ) : loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="card"><EmptyState title="Esta lista ainda não tem itens" /></div>
      ) : (
        <>
          <div className="grid stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div className="card"><div className="stat-label">Total de ordens de produção</div><div className="stat-value">{summary.total}</div></div>
            <div className="card"><div className="stat-label">Ordens finalizadas</div><div className="stat-value">{summary.done}</div></div>
            <div className="card">
              <div className="stat-label">Andamento</div>
              <div className="stat-value">{summary.pct.toFixed(2).replace(".", ",")}%</div>
              <ProgressBar value={summary.pct} tone="green" />
            </div>
          </div>
          <p className="muted" style={{ marginBottom: 10 }}>Ordem finalizada = Corte, Dobra e Acabamento em “Concluída” ou “Não se aplica”.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Peça</th><th>Descrição</th><th className="num">Quant.</th><th>O.P.</th>{STEP_NAMES.map((s) => <th key={s}>{s}</th>)}<th>Nota fiscal</th></tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} style={isFinished(i) ? { background: "var(--green-100)" } : undefined}>
                    <td><strong>{i.item_code ?? "—"}</strong></td>
                    <td style={{ maxWidth: 240 }}>{i.description ?? "—"}</td>
                    <td className="num">{formatQty(i.quantity)}</td>
                    <td>{i.op_number}</td>
                    {([0, 1, 2] as const).map((k) => (
                      <td key={k}>
                        <button
                          className={`pill ${STATE_CLASS[i.steps[k]]}`}
                          style={{ border: 0, cursor: canOperate ? "pointer" : "default", minWidth: 96, padding: "6px 10px" }}
                          disabled={!canOperate}
                          onClick={() => void cycle(i, k)}
                          aria-label={`${STEP_NAMES[k]} da OP ${i.op_number}: ${i.steps[k]}`}
                        >
                          {i.steps[k]}
                        </button>
                      </td>
                    ))}
                    <td>
                      <input
                        className="input cell-input"
                        style={{ width: 100 }}
                        defaultValue={i.invoice_number ?? ""}
                        disabled={!canOperate}
                        onBlur={(e) => void saveInvoice(i, e.target.value)}
                        aria-label={`Nota fiscal da OP ${i.op_number}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
