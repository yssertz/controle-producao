"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ClipboardCheck, Search } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { EmptyState, Notice, StatusPill } from "@/components/ui";
import { QrOpScanner } from "@/components/OpTracking";
import { errorText } from "@/lib/errors";
import { parseDecimalBR } from "@/lib/excel-paste";
import { formatQty, listLabel } from "@/lib/format";
import { fetchItemsByOpNumber } from "@/lib/delivery";
import { fetchItem } from "@/lib/items";
import { fetchItemProcessSteps, setProcessStepsDone, type ItemProcessStep } from "@/lib/progress";
import type { ItemBalance } from "@/lib/types";

export function OpBajaTracking() {
  const { canOperate } = useAuth();
  const [opNumber, setOpNumber] = useState("");
  const [matches, setMatches] = useState<ItemBalance[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [steps, setSteps] = useState<ItemProcessStep[]>([]);
  const [progressSource, setProgressSource] = useState<"nesting" | "manual">("manual");
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  const selected = useMemo(() => matches.find((item) => item.id === selectedId) ?? null, [matches, selectedId]);

  const selectItem = useCallback(async (item: ItemBalance) => {
    setLoading(true);
    setSelectedId(item.id);
    setNotice(null);
    try {
      if (!item.production_line_id) throw new Error("Esta OP ainda não tem uma linha de produção atribuída.");
      const progress = await fetchItemProcessSteps(item.id, item.production_line_id);
      setProgressSource(progress.progressSource);
      setSteps(progress.steps);
      setValues(Object.fromEntries(progress.steps.map((step) => [
        step.step_id,
        String(step.status === "Não se aplica" ? item.qty_total : step.quantity_completed).replace(".", ","),
      ])));
    } catch (e) {
      setNotice({ kind: "error", text: errorText(e) });
      setSteps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const scan = useCallback(async (code: string) => {
    setLoading(true);
    setOpNumber(code);
    setMatches([]);
    setSelectedId("");
    setSteps([]);
    setNotice(null);
    try {
      const found = await fetchItemsByOpNumber(code);
      setMatches(found);
      if (!found.length) {
        setNotice({ kind: "info", text: `Não encontrei uma OP ativa com o número ${code}. Confira o código e tente novamente.` });
        return false;
      }
      if (found.length === 1) await selectItem(found[0]);
      return true;
    } catch (e) {
      setNotice({ kind: "error", text: errorText(e) });
      return false;
    } finally {
      setLoading(false);
    }
  }, [selectItem]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !canOperate) return;
    const changed: { step_id: string; quantity_completed: number }[] = [];
    for (const step of steps) {
      if (step.status === "Não se aplica") continue;
      const quantity = parseDecimalBR(values[step.step_id] ?? "").value;
      if (quantity === null || quantity < 0 || quantity > selected.qty_total) {
        setNotice({ kind: "error", text: `${step.process_name}: informe de 0 a ${formatQty(selected.qty_total)} ${selected.unit}.` });
        return;
      }
      if (quantity !== step.quantity_completed) changed.push({ step_id: step.step_id, quantity_completed: quantity });
    }
    if (!changed.length) {
      setNotice({ kind: "info", text: "Não há alterações para salvar." });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const updated = await setProcessStepsDone(changed);
      const [freshItem, progress] = await Promise.all([
        fetchItem(selected.id),
        fetchItemProcessSteps(selected.id, selected.production_line_id!),
      ]);
      if (freshItem) setMatches((current) => current.map((item) => item.id === freshItem.id ? freshItem : item));
      setSteps(progress.steps);
      setProgressSource(progress.progressSource);
      setValues(Object.fromEntries(progress.steps.map((step) => [
        step.step_id,
        String(step.status === "Não se aplica" ? selected.qty_total : step.quantity_completed).replace(".", ","),
      ])));
      setNotice({ kind: "success", text: `${updated} processo(s) atualizado(s). O status da OP acompanha o avanço da fabricação.` });
    } catch (e) {
      setNotice({ kind: "error", text: errorText(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2 className="section-title">Como registrar a baixa</h2>
        <ol className="muted" style={{ margin: "8px 0 14px", paddingLeft: 22, lineHeight: 1.8 }}>
          <li>Leia o QR code da OP ou digite o número, com ou sem pontos.</li>
          <li>Escolha a peça e informe quanto foi concluído em cada processo.</li>
          <li>Confira os valores e salve a baixa.</li>
        </ol>
        <QrOpScanner onScan={scan} />
      </section>

      {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Notice>}

      {matches.length > 1 && !selected && (
        <section className="card">
          <h2 className="section-title">Selecione a peça da OP {opNumber}</h2>
          <p className="section-sub">A OP tem mais de uma peça ou lista. Selecione a peça que será apontada.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Peça</th><th>Lista</th><th>Linha</th><th className="num">Necessário</th><th></th></tr></thead>
              <tbody>{matches.map((item) => (
                <tr key={item.id}>
                  <td>{item.item_code ?? item.description ?? "Peça"}</td>
                  <td>{item.list_name ? listLabel(item.list_code, item.list_name) : "—"}</td>
                  <td>{item.line_name ?? "—"}</td>
                  <td className="num">{formatQty(item.qty_total)} {item.unit}</td>
                  <td><button type="button" className="btn primary small" onClick={() => void selectItem(item)}><Search size={13} /> Selecionar</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {loading && <section className="card">Carregando processos da OP...</section>}

      {selected && !loading && (
        <section className="card">
          <div className="heading" style={{ marginBottom: 12 }}>
            <div>
              <div className="eyebrow">OP {selected.op_number}</div>
              <h2 className="section-title">{selected.item_code ?? selected.description ?? "Peça"}</h2>
              <p className="section-sub" style={{ marginBottom: 0 }}>
                {selected.list_name ? listLabel(selected.list_code, selected.list_name) : "Sem lista"} · {selected.line_name ?? "Sem linha"} · Necessário {formatQty(selected.qty_total)} {selected.unit}
              </p>
            </div>
            <StatusPill status={selected.status} />
          </div>

          {progressSource === "nesting" ? (
            <Notice kind="info">Esta OP é fabricada pelo nesting. O corte passa a “Fabricado” quando o nesting for concluído; depois registre a entrega integral na aba Baixa de entrega.</Notice>
          ) : steps.length === 0 ? (
            <EmptyState title="A linha ainda não tem processos configurados">Peça ao administrador para revisar o roteiro em Setores e linhas.</EmptyState>
          ) : (
            <form onSubmit={(e) => void save(e)}>
              <p className="section-sub">A quantidade é independente em cada etapa. Ao concluir todos os processos, a OP fica “Fabricada”; use a aba Baixa de entrega para marcar a OP como entregue.</p>
              {!canOperate && <Notice kind="info">Seu perfil pode consultar, mas não salvar baixas.</Notice>}
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Processo</th><th className="num">Necessário</th><th>Concluído</th><th className="num">Falta</th><th></th></tr></thead>
                  <tbody>{steps.map((step) => {
                    const done = step.status === "Não se aplica" ? selected.qty_total : parseDecimalBR(values[step.step_id] ?? "").value ?? 0;
                    return <tr key={step.step_id}>
                      <td>{step.process_name}</td>
                      <td className="num">{formatQty(selected.qty_total)} {selected.unit}</td>
                      <td style={{ minWidth: 150 }}>
                        <input className="input cell-input" inputMode="decimal" value={values[step.step_id] ?? ""}
                          disabled={!canOperate || step.status === "Não se aplica"}
                          onChange={(ev) => setValues((current) => ({ ...current, [step.step_id]: ev.target.value }))}
                          aria-label={`${step.process_name} concluído na OP ${selected.op_number}`} />
                      </td>
                      <td className="num">{formatQty(Math.max(0, selected.qty_total - done))}</td>
                      <td>{canOperate && step.status !== "Não se aplica" && <button type="button" className="btn secondary small" onClick={() => setValues((current) => ({ ...current, [step.step_id]: String(selected.qty_total).replace(".", ",") }))}><Check size={13} /> Tudo</button>}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              {canOperate && <div className="btn-row" style={{ marginTop: 14 }}>
                <button className="btn primary" type="submit" disabled={saving}><ClipboardCheck size={14} /> {saving ? "Salvando..." : "Salvar baixa da OP"}</button>
                <button type="button" className="btn secondary" onClick={() => setValues(Object.fromEntries(steps.map((step) => [step.step_id, String(selected.qty_total).replace(".", ",")]))) }>Marcar todos concluídos</button>
              </div>}
            </form>
          )}
        </section>
      )}
    </div>
  );
}
