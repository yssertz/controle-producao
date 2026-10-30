"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, ClipboardPaste, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { ItemFormModal } from "@/components/ItemFormModal";
import { ConfirmModal } from "@/components/Modal";
import { EmptyState, Loading, Notice, PageHeader, Pagination, StatusPill } from "@/components/ui";
import { ITEM_STATUSES } from "@/lib/constants";
import { errorText } from "@/lib/errors";
import { formatDate, formatQty, listLabel } from "@/lib/format";
import { deleteItem, searchItems, setItemArchived, type ItemFilters } from "@/lib/items";
import { fetchLines, fetchListOptions, type ListOption } from "@/lib/reference";
import type { ItemBalance, ProductionLine } from "@/lib/types";

type Message = { kind: "success" | "error"; text: string } | null;

function OpsContent() {
  const { canPlan } = useAuth();
  const params = useSearchParams();
  const [filters, setFilters] = useState<ItemFilters>({
    listId: params.get("lista") ?? "",
    lineId: "",
    status: "",
    search: "",
    showArchived: false,
  });
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ItemBalance[]>([]);
  const [total, setTotal] = useState(0);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Message>(null);
  const [modal, setModal] = useState<{ editing: ItemBalance | null } | null>(null);
  const [archiving, setArchiving] = useState<ItemBalance | null>(null);
  const [deleting, setDeleting] = useState<ItemBalance | null>(null);
  const [busy, setBusy] = useState(false);

  // Listas e linhas para os filtros e formulários
  useEffect(() => {
    Promise.all([fetchListOptions(true), fetchLines(false)])
      .then(([l, ln]) => {
        setLists(l);
        setLines(ln);
      })
      .catch((err) => setMsg({ kind: "error", text: errorText(err) }));
  }, []);

  // Busca com pequena espera, para não consultar a cada letra digitada
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await searchItems(filters, page);
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeFilter(patch: Partial<ItemFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }

  async function removeItem(item: ItemBalance) {
    setBusy(true);
    try {
      await deleteItem(item.id);
      setMsg({ kind: "success", text: `OP ${item.op_number} excluída definitivamente.` });
      setDeleting(null);
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(item: ItemBalance) {
    setBusy(true);
    try {
      await setItemArchived(item.id, item.archived_at === null);
      setMsg({ kind: "success", text: item.archived_at ? "Item restaurado." : "Item arquivado. O histórico foi preservado." });
      setArchiving(null);
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
      setArchiving(null);
    } finally {
      setBusy(false);
    }
  }

  const activeLists = lists.filter((l) => l.status !== "Arquivada");

  return (
    <main className="content">
      <PageHeader
        eyebrow="PCP / Planejamento"
        title="OPs e peças"
        subtitle="Cada linha é um item de uma OP. Uma OP pode ter vários itens. O saldo de corte vem dos nestings."
        actions={
          <>
            <button className="btn secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} /> Atualizar
            </button>
            {canPlan && (
              <>
                <Link className="btn secondary" href={filters.listId ? `/ops/colar?lista=${filters.listId}` : "/ops/colar"}>
                  <ClipboardPaste size={14} /> Colar do Excel
                </Link>
                <button className="btn primary" onClick={() => setModal({ editing: null })}>
                  <Plus size={14} /> Novo item
                </button>
              </>
            )}
          </>
        }
      />

      {msg && (
        <Notice kind={msg.kind} onClose={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}

      <div className="toolbar">
        <div className="field grow">
          <label htmlFor="f-search">Buscar (OP, item ou descrição)</label>
          <input id="f-search" className="input" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Ex.: 028854" />
        </div>
        <div className="field">
          <label htmlFor="f-list">Lista</label>
          <select id="f-list" className="select" value={filters.listId} onChange={(e) => changeFilter({ listId: e.target.value })}>
            <option value="">Todas</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {listLabel(l.code, l.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-line">Linha</label>
          <select id="f-line" className="select" value={filters.lineId} onChange={(e) => changeFilter({ lineId: e.target.value })}>
            <option value="">Todas</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" className="select" value={filters.status} onChange={(e) => changeFilter({ status: e.target.value })}>
            <option value="">Todos</option>
            {ITEM_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <label className="checkbox" style={{ paddingBottom: 9 }}>
          <input type="checkbox" checked={filters.showArchived} onChange={(e) => changeFilter({ showArchived: e.target.checked })} />
          Somente arquivados
        </label>
      </div>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Nenhum item encontrado">
            {canPlan
              ? "Cadastre um item manualmente ou cole linhas copiadas do Excel. Antes, crie ao menos uma lista em “Listas de produção”."
              : "Ajuste os filtros ou peça ao PCP para cadastrar os itens."}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>OP</th>
                  <th>Item</th>
                  <th>Descrição</th>
                  <th>Lista</th>
                  <th>Linha</th>
                  <th className="num">Qtd.</th>
                  <th className="num" title="Programado em nestings (um nesting concluído conta só o que foi cortado)">Programado</th>
                  <th className="num">Cortado</th>
                  <th className="num">Pendente de corte</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const excess = r.qty_excess_programmed > 0 || r.qty_excess_cut > 0;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link className="link" href={`/ops/${r.id}`}>
                          {r.op_number}
                        </Link>
                      </td>
                      <td>{r.item_code ?? "—"}</td>
                      <td style={{ maxWidth: 280 }}>{r.description ?? "—"}</td>
                      <td>{r.list_name ? listLabel(r.list_code, r.list_name) : <span className="pill red">Sem lista</span>}</td>
                      <td>{r.line_name ?? <span className="pill red">Sem linha</span>}</td>
                      <td className="num">
                        {formatQty(r.qty_total)} <span className="muted">{r.unit}</span>
                      </td>
                      <td className="num">
                        {formatQty(r.qty_programmed)}
                        {excess && <div><span className="pill amber" title="Programado acima do necessário (excedente autorizado)">excedente</span></div>}
                      </td>
                      <td className="num">{formatQty(r.qty_cut)}</td>
                      <td className="num">{formatQty(r.qty_pending_cut)}</td>
                      <td>
                        <StatusPill status={r.status} />
                        {r.due_date && <div className="muted">prev. {formatDate(r.due_date)}</div>}
                      </td>
                      <td>
                        <div className="btn-row">
                          <Link className="btn secondary small" href={`/ops/${r.id}`}>
                            Detalhes
                          </Link>
                          {canPlan && (
                            <>
                              <button className="btn secondary small" onClick={() => setModal({ editing: r })}>
                                <Pencil size={12} /> Editar
                              </button>
                              <button className="btn secondary small" onClick={() => setArchiving(r)}>
                                {r.archived_at ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                                {r.archived_at ? "Restaurar" : "Arquivar"}
                              </button>
                              <button className="btn danger-outline small" onClick={() => setDeleting(r)}>
                                <Trash2 size={12} /> Excluir
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} onPage={setPage} />
        </>
      )}

      {modal && (
        <ItemFormModal
          editing={modal.editing}
          lists={activeLists}
          lines={lines.filter((l) => l.active || l.id === modal.editing?.production_line_id)}
          defaultListId={filters.listId}
          onClose={() => setModal(null)}
          onSaved={(text) => {
            setModal(null);
            setMsg({ kind: "success", text });
            void load();
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Excluir OP definitivamente"
          message={<>A OP <strong>{deleting.op_number}</strong> será apagada permanentemente, junto com seus dados de acompanhamento. Se ela estiver vinculada a algum nesting, a exclusão será bloqueada para preservar o histórico do corte.</>}
          confirmLabel="Excluir definitivamente"
          danger
          busy={busy}
          onConfirm={() => void removeItem(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {archiving && (
        <ConfirmModal
          title={archiving.archived_at ? "Restaurar item" : "Arquivar item"}
          message={
            archiving.archived_at ? (
              <>O item da OP <strong>{archiving.op_number}</strong> voltará para as listas.</>
            ) : (
              <>
                O item da OP <strong>{archiving.op_number}</strong> sai das consultas normais, mas o histórico de nestings é preservado.
                Você pode restaurá-lo depois.
              </>
            )
          }
          confirmLabel={archiving.archived_at ? "Restaurar" : "Arquivar"}
          busy={busy}
          onConfirm={() => void toggleArchive(archiving)}
          onCancel={() => setArchiving(null)}
        />
      )}
    </main>
  );
}

export default function OpsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OpsContent />
    </Suspense>
  );
}
