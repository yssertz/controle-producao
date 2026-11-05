"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { DeleteItemsDialog } from "@/components/DeleteDialogs";
import { ItemFormModal } from "@/components/ItemFormModal";
import { BackLink, EmptyState, Loading, Notice, ProgressBar, StatusPill } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { formatDate, formatQty, listLabel } from "@/lib/format";
import { fetchItem, fetchItemNestings } from "@/lib/items";
import { fetchLines, fetchListOptions, type ListOption } from "@/lib/reference";
import type { ItemBalance, ItemNestingRow, ProductionLine } from "@/lib/types";

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { canPlan } = useAuth();
  const router = useRouter();
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [item, setItem] = useState<ItemBalance | null>(null);
  const [links, setLinks] = useState<ItemNestingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<{ lists: ListOption[]; lines: ProductionLine[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [i, l] = await Promise.all([fetchItem(id), fetchItemNestings(id)]);
      setItem(i);
      setLinks(l);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openEdit() {
    try {
      const [lists, lines] = await Promise.all([fetchListOptions(false), fetchLines(false)]);
      setEdit({ lists, lines });
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (loading && !item) {
    return (
      <main className="content">
        <Loading />
      </main>
    );
  }

  const pct = item && item.qty_total > 0 ? (item.qty_cut / item.qty_total) * 100 : 0;
  const excess = item ? Math.max(item.qty_excess_programmed, item.qty_excess_cut) : 0;

  return (
    <main className="content">
      <BackLink href="/ops">Voltar para OPs e peças</BackLink>
      {error && <Notice kind="error">{error}</Notice>}
      {!item && !error && <Notice kind="warning">Item não encontrado.</Notice>}
      {item && (
        <>
          <div className="heading">
            <div>
              <div className="eyebrow">OP {item.op_number}</div>
              <h1>{item.item_code ?? item.description ?? "Item"}</h1>
              <p className="subtitle">
                {item.description ?? ""} <StatusPill status={item.status} />
                {item.archived_at && <> <span className="pill gray">Arquivado</span></>}
              </p>
            </div>
            {canPlan && (
              <div className="heading-actions">
                <button className="btn secondary" onClick={() => void openEdit()}>
                  <Pencil size={14} /> Editar
                </button>
                <button className="btn danger-outline" onClick={() => setDeleteIds([item.id])}>
                  <Trash2 size={14} /> Excluir
                </button>
              </div>
            )}
          </div>

          <section className="card">
            <div className="kv">
              <div><div className="kv-label">Lista</div><div className="kv-value">{item.list_id ? <Link className="link" href={`/listas/${item.list_id}`}>{listLabel(item.list_code, item.list_name)}</Link> : "—"}</div></div>
              <div><div className="kv-label">Linha de produção</div><div className="kv-value">{item.line_name ?? "—"}</div></div>
              <div><div className="kv-label">Equipamento</div><div className="kv-value">{item.equipment_name ?? "—"}</div></div>
              <div><div className="kv-label">Matéria-prima</div><div className="kv-value">{item.material ?? "—"}{item.material_code ? ` (${item.material_code})` : ""}{item.thickness_mm ? ` · ${formatQty(item.thickness_mm)} mm` : ""}</div></div>
              {item.material_qty !== null && <div><div className="kv-label">Qtde de matéria-prima</div><div className="kv-value">{formatQty(item.material_qty)} {item.material_unit ?? ""}</div></div>}
              {item.invoice_number && <div><div className="kv-label">Nota fiscal</div><div className="kv-value">{item.invoice_number}</div></div>}
              <div><div className="kv-label">Data prevista</div><div className="kv-value">{formatDate(item.due_date)}</div></div>
              <div><div className="kv-label">Cadastrado em</div><div className="kv-value">{formatDate(item.created_at)}</div></div>
            </div>
            {item.notes && <p className="subtitle" style={{ marginTop: 14 }}>{item.notes}</p>}
          </section>

          <section className="card section-gap">
            <h2 className="section-title">Baixa da OP</h2>
            <p className="section-sub">As baixas por processo ficam na aba dedicada para facilitar o apontamento da equipe.</p>
            <Link className="btn primary" href="/baixa-ops">Abrir baixa de OPs</Link>
          </section>

          {item.line_allows_nesting && <>
          <section className="card section-gap">
            <h2 className="section-title">Saldo do corte a laser</h2>
            <p className="section-sub">Cada peça é contada uma só vez, mesmo que a OP esteja em vários nestings. Nestings cancelados não contam.</p>
            {excess > 0 && (
              <Notice kind="warning">
                Atenção: há <strong>{formatQty(excess)} {item.unit}</strong> acima do necessário. O excedente só entra com autorização explícita ao programar o nesting.
              </Notice>
            )}
            <div className="balance">
              <div className="balance-box"><div className="muted">Necessário</div><div className="v">{formatQty(item.qty_total)} <span className="muted">{item.unit}</span></div></div>
              <div className="balance-box"><div className="muted">Programado em nestings</div><div className="v">{formatQty(item.qty_programmed)}</div></div>
              <div className="balance-box"><div className="muted">Efetivamente cortado</div><div className="v">{formatQty(item.qty_cut)}</div></div>
              <div className="balance-box"><div className="muted">Pendente de programar</div><div className="v">{formatQty(item.qty_unscheduled)}</div></div>
              <div className={item.qty_pending_cut > 0 ? "balance-box" : "balance-box"}><div className="muted">Pendente de corte</div><div className="v">{formatQty(item.qty_pending_cut)}</div></div>
            </div>
            <div style={{ marginTop: 14, maxWidth: 360 }}>
              <div className="muted" style={{ marginBottom: 4 }}>{Math.min(100, Math.round(pct))}% cortado</div>
              <ProgressBar value={pct} tone={pct >= 100 ? "green" : "blue"} />
            </div>
          </section>

          <section className="card section-gap">
            <h2 className="section-title">Nestings desta OP ({links.length})</h2>
            {links.length === 0 ? (
              <EmptyState title="Esta OP ainda não está em nenhum nesting">
                {item.list_id && canPlan ? <Link className="btn primary" href={`/nestings/novo?lista=${item.list_id}`}>Criar nesting para a lista</Link> : null}
              </EmptyState>
            ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr><th>Nesting</th><th>Máquina</th><th>Data programada</th><th className="num">Programado</th><th className="num">Cortado</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {links.map((l) => (
                      <tr key={l.id}>
                        <td>{l.nestings ? <Link className="link" href={`/nestings/${l.nestings.id}`}>{l.nestings.code}</Link> : "—"}</td>
                        <td>{l.nestings?.laser_machines?.name ?? "—"}</td>
                        <td>{formatDate(l.nestings?.programmed_at)}</td>
                        <td className="num">{formatQty(l.quantity_programmed)}{l.allow_excess && <> <span className="pill amber">excedente</span></>}</td>
                        <td className="num">{formatQty(l.quantity_cut)}</td>
                        <td>{l.nestings && <StatusPill status={l.nestings.status} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          </>}

          {deleteIds && (
            <DeleteItemsDialog ids={deleteIds} onClose={() => setDeleteIds(null)} onDone={() => router.push("/ops")} />
          )}

          {edit && (
            <ItemFormModal
              editing={item}
              lists={edit.lists}
              lines={edit.lines.filter((l) => l.active || l.id === item.production_line_id)}
              onClose={() => setEdit(null)}
              onSaved={() => {
                setEdit(null);
                void load();
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
