"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Ban, CheckCircle2, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { DeleteNestingDialog } from "@/components/DeleteDialogs";
import { ConfirmModal, Modal, ReasonModal } from "@/components/Modal";
import { BackLink, Loading, Notice, StatusPill } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { formatDate, formatDateTime, formatQty, listLabel } from "@/lib/format";
import { parseDecimalBR } from "@/lib/excel-paste";
import {
  cancelNesting,
  completeNesting,
  fetchNesting,
  fetchNestingHistory,
  fetchNestingItems,
  fetchProfileNames,
  recordNestingCut,
  reopenNesting,
  startNesting,
  type CutInput,
} from "@/lib/nestings";
import type { NestingHistoryRow, NestingItemRow, NestingSummary } from "@/lib/types";

type Message = { kind: "success" | "error"; text: string } | null;
type Action = "start" | "cancel" | "reopen" | "record" | "complete" | null;

/** Janela para registrar quantidades (nesting Em produção) ou conferir e concluir. */
function CutModal({
  mode,
  nesting,
  items,
  onClose,
  onDone,
}: {
  mode: "record" | "complete";
  nesting: NestingSummary;
  items: NestingItemRow[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, String(i.quantity_cut).replace(".", ",")])),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const parsed = items.map((i) => {
    const v = parseDecimalBR(values[i.id] ?? "").value;
    const invalid = v === null || v < 0 || v > i.quantity_programmed;
    return { item: i, value: v, invalid };
  });
  const anyInvalid = parsed.some((p) => p.invalid);
  const totalCut = parsed.reduce((s, p) => s + (p.value ?? 0), 0);
  const totalProg = items.reduce((s, i) => s + i.quantity_programmed, 0);

  async function submit() {
    setError("");
    if (anyInvalid) return setError("Corrija as quantidades destacadas: use zero ou mais, sem ultrapassar o programado.");
    if (mode === "complete" && !confirmed) return setError("Marque a confirmação de que conferiu as quantidades.");
    const payload: CutInput[] = parsed.map((p) => ({
      nesting_item_id: p.item.id,
      quantity_cut: p.value as number,
    }));
    setBusy(true);
    try {
      if (mode === "complete") {
        await completeNesting(nesting.id, payload, note);
        onDone("Nesting concluído. Quantidades cortadas registradas.");
      } else {
        await recordNestingCut(nesting.id, payload);
        onDone("Quantidades cortadas registradas.");
      }
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={mode === "complete" ? `Conferir e concluir ${nesting.code}` : `Registrar quantidades cortadas · ${nesting.code}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose} disabled={busy}>Voltar</button>
          <button className={mode === "complete" ? "btn success" : "btn primary"} onClick={() => void submit()} disabled={busy}>
            {busy ? "Salvando..." : mode === "complete" ? "Concluir nesting" : "Salvar quantidades"}
          </button>
        </>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      {mode === "complete" && (
        <Notice kind="info">
          Informe quantas peças foram <strong>realmente cortadas</strong> de cada OP. O sistema não presume que tudo o que foi programado foi cortado.
        </Notice>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>OP</th><th>Equipamento / item</th><th>Descrição</th><th className="num">Programado</th><th>Cortado</th><th className="num">Diferença</th></tr>
          </thead>
          <tbody>
            {parsed.map(({ item, value, invalid }) => {
              const po = item.production_orders;
              const diff = value === null ? null : item.quantity_programmed - value;
              return (
                <tr key={item.id}>
                  <td><strong>{po?.op_number ?? item.op_number}</strong></td>
                  <td>{po?.item_code ?? item.equipment_name ?? "—"}</td>
                  <td>{po?.description ?? item.description ?? "—"}</td>
                  <td className="num">{formatQty(item.quantity_programmed)}</td>
                  <td style={{ minWidth: 130 }}>
                    <input
                      className={`input cell-input${invalid ? " invalid" : ""}`}
                      inputMode="decimal"
                      value={values[item.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [item.id]: e.target.value }))}
                      aria-label={`Quantidade cortada da OP ${po?.op_number ?? item.op_number}`}
                    />
                  </td>
                  <td className="num">{diff === null || invalid ? "—" : diff > 0 ? <span className="pill amber">faltam {formatQty(diff)}</span> : <span className="pill green">completo</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          className="btn secondary small"
          onClick={() => setValues(Object.fromEntries(items.map((i) => [i.id, String(i.quantity_programmed).replace(".", ",")])))}
        >
          Preencher tudo com o programado
        </button>
        <span className="subtitle">Total cortado: <strong>{formatQty(totalCut)}</strong> de {formatQty(totalProg)} programado(s)</span>
      </div>
      {mode === "complete" && (
        <div style={{ marginTop: 14 }} className="stack">
          {totalCut === 0 && <Notice kind="warning">Nenhuma peça cortada foi informada. Confirme apenas se o nesting realmente não produziu peças.</Notice>}
          <div className="field">
            <label htmlFor="c-note">Observação da conclusão (opcional)</label>
            <input id="c-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Conferi as quantidades efetivamente cortadas de cada OP.
          </label>
        </div>
      )}
    </Modal>
  );
}

function describeDetails(h: NestingHistoryRow): string[] {
  const d = h.details;
  if (!d) return [];
  const list = (key: string): Record<string, unknown>[] => (Array.isArray(d[key]) ? (d[key] as Record<string, unknown>[]) : []);
  const n = (v: unknown) => formatQty(typeof v === "number" ? v : Number(v));
  if (h.event_type === "Quantidades registradas") return list("alteracoes").map((a) => `OP ${a.op}: ${n(a.antes)} → ${n(a.depois)}`);
  if (h.event_type === "Concluído") return list("itens").map((a) => `OP ${a.op}: cortado ${n(a.cortado)} de ${n(a.programado)}`);
  if (h.event_type === "Reaberto") return list("quantidades_antes").map((a) => `OP ${a.op}: cortado ${n(a.cortado)} de ${n(a.programado)} (antes de reabrir)`);
  return [];
}

export default function NestingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { canPlan, canOperate } = useAuth();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [nesting, setNesting] = useState<NestingSummary | null>(null);
  const [items, setItems] = useState<NestingItemRow[]>([]);
  const [history, setHistory] = useState<NestingHistoryRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Message>(null);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [n, it, h, nm] = await Promise.all([fetchNesting(id), fetchNestingItems(id), fetchNestingHistory(id), fetchProfileNames()]);
      setNesting(n);
      setItems(it);
      setHistory(h);
      setNames(nm);
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>, okText: string) {
    setBusy(true);
    try {
      await fn();
      setMsg({ kind: "success", text: okText });
      setAction(null);
      await load();
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
      setAction(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="content"><Loading /></main>;

  const totalProg = items.reduce((s, i) => s + i.quantity_programmed, 0);
  const totalCut = items.reduce((s, i) => s + i.quantity_cut, 0);

  return (
    <main className="content">
      <BackLink href="/nestings">Voltar para os nestings</BackLink>
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {!nesting ? (
        <Notice kind="warning">Nesting não encontrado.</Notice>
      ) : (
        <>
          <div className="heading">
            <div>
              <div className="eyebrow">Nesting · {nesting.machine_name ?? "sem máquina"}</div>
              <h1>{nesting.code}</h1>
              <p className="subtitle"><StatusPill status={nesting.status} /></p>
            </div>
            <div className="heading-actions">
              {nesting.status === "Programado" && canPlan && (
                <Link className="btn secondary" href={`/nestings/${nesting.id}/editar`}><Pencil size={14} /> Editar</Link>
              )}
              {nesting.status === "Programado" && canOperate && (
                <button className="btn primary" onClick={() => setAction("start")} disabled={items.length === 0} title={items.length === 0 ? "Adicione peças antes de iniciar" : undefined}>
                  <Play size={14} /> Iniciar corte
                </button>
              )}
              {nesting.status === "Em produção" && canOperate && (
                <>
                  <button className="btn secondary" onClick={() => setAction("record")}>Registrar quantidades</button>
                  <button className="btn success" onClick={() => setAction("complete")}><CheckCircle2 size={14} /> Concluir</button>
                </>
              )}
              {nesting.status === "Concluído" && canPlan && (
                <button className="btn secondary" onClick={() => setAction("reopen")}><RotateCcw size={14} /> Reabrir</button>
              )}
              {(nesting.status === "Programado" || nesting.status === "Em produção") && canPlan && (
                <button className="btn danger-outline" onClick={() => setAction("cancel")}><Ban size={14} /> Cancelar</button>
              )}
              {canPlan && (
                <button className="btn danger-outline" onClick={() => setDeleting(true)}><Trash2 size={14} /> Excluir</button>
              )}
            </div>
          </div>

          {nesting.status === "Cancelado" && <Notice kind="error">Nesting cancelado. As quantidades dele não contam como produção. O histórico foi preservado.</Notice>}

          <section className="card">
            <div className="kv">
              <div><div className="kv-label">Listas</div><div className="kv-value">{nesting.list_names ?? "—"}</div></div>
              <div><div className="kv-label">Máquina</div><div className="kv-value">{nesting.machine_name ?? "—"}</div></div>
              <div><div className="kv-label">Matéria-prima</div><div className="kv-value">{nesting.material ?? "—"}{nesting.thickness_mm ? ` · ${formatQty(nesting.thickness_mm)} mm` : ""}</div></div>
              <div><div className="kv-label">Data programada</div><div className="kv-value">{formatDate(nesting.programmed_at)}</div></div>
              <div><div className="kv-label">Criado em</div><div className="kv-value">{formatDate(nesting.created_at)}</div></div>
              <div><div className="kv-label">Início da produção</div><div className="kv-value">{formatDateTime(nesting.started_at)}</div></div>
              <div><div className="kv-label">Conclusão</div><div className="kv-value">{formatDateTime(nesting.completed_at)}</div></div>
            </div>
            {nesting.notes && <p className="subtitle" style={{ marginTop: 14 }}>{nesting.notes}</p>}
          </section>

          <section className="card section-gap">
            <h2 className="section-title">Peças neste nesting ({items.length})</h2>
            <p className="section-sub">Programado: {formatQty(totalProg)} · Cortado: {formatQty(totalCut)}</p>
            {items.length === 0 ? (
              <div className="empty">Nenhuma peça vinculada. {nesting.status === "Programado" && canPlan ? "Use “Editar” para vincular OPs da lista." : ""}</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>OP</th><th>Item</th><th>Descrição</th><th>Lista</th><th className="num">Necessário (OP)</th><th className="num">Programado aqui</th><th className="num">Cortado</th><th className="num">Falta neste nesting</th></tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.production_order_id ? <Link className="link" href={`/ops/${i.production_order_id}`}>{i.production_orders?.op_number}</Link> : <strong>{i.op_number}</strong>}</td>
                        <td>{i.production_orders?.item_code ?? i.equipment_name ?? "—"}</td>
                        <td>{i.production_orders?.description ?? i.description ?? "—"}</td>
                        <td>{i.production_orders?.production_lists ? listLabel(i.production_orders.production_lists.code, i.production_orders.production_lists.name) : i.production_order_id ? "—" : "Avulsa"}</td>
                        <td className="num">{formatQty(i.production_orders?.quantity)}</td>
                        <td className="num">{formatQty(i.quantity_programmed)}{i.allow_excess && <> <span className="pill amber">excedente</span></>}</td>
                        <td className="num">{formatQty(i.quantity_cut)}</td>
                        <td className="num">{formatQty(i.quantity_programmed - i.quantity_cut)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card section-gap">
            <h2 className="section-title">Histórico</h2>
            {history.length === 0 ? (
              <div className="empty">Sem registros.</div>
            ) : (
              <ul className="timeline" style={{ marginTop: 10 }}>
                {history.map((h) => (
                  <li key={h.id}>
                    <div className="t-title">{h.event_type}{h.from_status && h.to_status && h.from_status !== h.to_status ? ` · ${h.from_status} → ${h.to_status}` : ""}</div>
                    <div className="t-meta">{formatDateTime(h.created_at)} · {h.created_by ? names.get(h.created_by) ?? "Usuário" : "Sistema"}</div>
                    {h.note && <div className="t-note">Motivo/obs.: {h.note}</div>}
                    {describeDetails(h).map((line) => <div key={line} className="t-note">{line}</div>)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {deleting && (
            <DeleteNestingDialog nestingId={nesting.id} onClose={() => setDeleting(false)} onDone={() => router.push("/nestings")} />
          )}
          {action === "start" && (
            <ConfirmModal title="Iniciar corte" message={<>O nesting <strong>{nesting.code}</strong> passará para <strong>Em produção</strong>. Depois disso as peças e quantidades programadas não poderão mais ser alteradas.</>} confirmLabel="Iniciar corte" busy={busy} onConfirm={() => void run(() => startNesting(nesting.id), "Corte iniciado.")} onCancel={() => setAction(null)} />
          )}
          {action === "cancel" && (
            <ReasonModal danger title="Cancelar nesting" description={<>O nesting <strong>{nesting.code}</strong> será cancelado. Nada é apagado e as quantidades dele não contam como produção. {nesting.status === "Em produção" && "Só é possível cancelar se nenhuma peça cortada tiver sido registrada."}</>} label="Motivo do cancelamento" confirmLabel="Cancelar nesting" busy={busy} onConfirm={(r) => void run(() => cancelNesting(nesting.id, r), "Nesting cancelado.")} onCancel={() => setAction(null)} />
          )}
          {action === "reopen" && (
            <ReasonModal title="Reabrir nesting concluído" description={<>O nesting <strong>{nesting.code}</strong> voltará para <strong>Em produção</strong> para correção das quantidades. A reabertura e o motivo ficam registrados no histórico.</>} label="Motivo da reabertura" confirmLabel="Reabrir" busy={busy} onConfirm={(r) => void run(() => reopenNesting(nesting.id, r), "Nesting reaberto. Corrija as quantidades e conclua novamente.")} onCancel={() => setAction(null)} />
          )}
          {(action === "record" || action === "complete") && (
            <CutModal
              mode={action}
              nesting={nesting}
              items={items}
              onClose={() => setAction(null)}
              onDone={(text) => {
                setAction(null);
                setMsg({ kind: "success", text });
                void load();
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
