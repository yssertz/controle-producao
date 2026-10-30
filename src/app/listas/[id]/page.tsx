"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { BackLink, EmptyState, Loading, Notice, Pagination, StatusPill } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { formatDate, formatQty, listLabel } from "@/lib/format";
import { searchItems } from "@/lib/items";
import { fetchListSummary } from "@/lib/lists";
import { searchNestings } from "@/lib/nestings";
import type { ItemBalance, ListSummary, NestingSummary } from "@/lib/types";

export default function ListaDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { canPlan } = useAuth();
  const [list, setList] = useState<ListSummary | null>(null);
  const [items, setItems] = useState<ItemBalance[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [nestings, setNestings] = useState<NestingSummary[]>([]);
  const [nestingsTotal, setNestingsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [l, it, ne] = await Promise.all([
        fetchListSummary(id),
        searchItems({ listId: id, lineId: "", status: "", search: "", showArchived: false }, page),
        searchNestings({ listId: id, machineId: "", status: "", search: "" }, 0),
      ]);
      setList(l);
      setItems(it.rows);
      setItemsTotal(it.total);
      setNestings(ne.rows);
      setNestingsTotal(ne.total);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [id, page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !list) {
    return (
      <main className="content">
        <Loading />
      </main>
    );
  }

  return (
    <main className="content">
      <BackLink href="/listas">Voltar para as listas</BackLink>
      {error && <Notice kind="error">{error}</Notice>}
      {!list && !error && <Notice kind="warning">Lista não encontrada.</Notice>}
      {list && (
        <>
          <div className="heading">
            <div>
              <div className="eyebrow">Lista de produção · {list.list_type}</div>
              <h1>{listLabel(list.code, list.name)}</h1>
              <p className="subtitle">
                Criada em {formatDate(list.created_at)}
                {list.delivery_date ? ` · entrega ${formatDate(list.delivery_date)}` : ""} · <StatusPill status={list.status} />
              </p>
              {list.notes && <p className="subtitle" style={{ marginTop: 8 }}>{list.notes}</p>}
            </div>
            {canPlan && list.status !== "Arquivada" && (
              <div className="heading-actions">
                <Link className="btn secondary" href={`/ops/colar?lista=${list.id}`}>
                  Colar do Excel
                </Link>
                <Link className="btn primary" href={`/nestings/novo?lista=${list.id}`}>
                  <Plus size={14} /> Novo nesting
                </Link>
              </div>
            )}
          </div>

          <section className="card">
            <h2 className="section-title">Itens e peças da lista ({itemsTotal})</h2>
            <p className="section-sub">
              Quantidade total {formatQty(list.qty_total)} ·{" "}
              <Link className="link" href={`/ops?lista=${list.id}`}>
                abrir em OPs e peças (com filtros)
              </Link>
            </p>
            {items.length === 0 ? (
              <EmptyState title="Esta lista ainda não tem itens">Cadastre uma OP em “OPs e peças” ou cole linhas do Excel.</EmptyState>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>OP</th>
                        <th>Item</th>
                        <th>Descrição</th>
                        <th>Linha</th>
                        <th className="num">Qtd.</th>
                        <th className="num">Cortado</th>
                        <th className="num">Pendente de corte</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => (
                        <tr key={i.id}>
                          <td>
                            <Link className="link" href={`/ops/${i.id}`}>
                              {i.op_number}
                            </Link>
                          </td>
                          <td>{i.item_code ?? "—"}</td>
                          <td>{i.description ?? "—"}</td>
                          <td>{i.line_name ?? "—"}</td>
                          <td className="num">{formatQty(i.qty_total)}</td>
                          <td className="num">{formatQty(i.qty_cut)}</td>
                          <td className="num">{formatQty(i.qty_pending_cut)}</td>
                          <td>
                            <StatusPill status={i.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} total={itemsTotal} onPage={setPage} />
              </>
            )}
          </section>

          <section className="card section-gap">
            <h2 className="section-title">Nestings da lista ({nestingsTotal})</h2>
            {nestings.length === 0 ? (
              <EmptyState title="Nenhum nesting nesta lista" />
            ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Máquina</th>
                      <th>Material</th>
                      <th className="num">OPs</th>
                      <th className="num">Programado</th>
                      <th className="num">Cortado</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nestings.map((n) => (
                      <tr key={n.id}>
                        <td>
                          <Link className="link" href={`/nestings/${n.id}`}>
                            {n.code}
                          </Link>
                        </td>
                        <td>{n.machine_name ?? "—"}</td>
                        <td>
                          {n.material ?? "—"}
                          {n.thickness_mm ? ` · ${formatQty(n.thickness_mm)} mm` : ""}
                        </td>
                        <td className="num">{n.items_count}</td>
                        <td className="num">{formatQty(n.qty_programmed)}</td>
                        <td className="num">{formatQty(n.qty_cut)}</td>
                        <td>
                          <StatusPill status={n.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
