"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, ClipboardCheck, ClipboardPaste, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { DeleteItemsDialog } from "@/components/DeleteDialogs";
import { ItemFormModal } from "@/components/ItemFormModal";
import { ConfirmModal } from "@/components/Modal";
import { EmptyState, Loading, Notice, PageHeader, Pagination, StatusPill } from "@/components/ui";
import { ITEM_FILTER_STATUSES } from "@/lib/constants";
import { errorText } from "@/lib/errors";
import { formatDate, formatQty, listLabel } from "@/lib/format";
import { fetchThicknesses, recalcThickness, searchItems, setItemArchived, type ItemFilters, type ThicknessOption } from "@/lib/items";
import { formatMm } from "@/lib/thickness";
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
    thickness: "",
    nestingEligibility: "laser",
  });
  const [thicknesses, setThicknesses] = useState<ThicknessOption[]>([]);
  const [calcBusy, setCalcBusy] = useState(false);
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
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);

  // Listas e linhas para os filtros e formulários
  useEffect(() => {
    Promise.all([fetchListOptions(true), fetchLines(false)])
      .then(([l, ln]) => {
        setLists(l);
        setLines(ln);
      })
      .catch((err) => setMsg({ kind: "error", text: errorText(err) }));
  }, []);

  const loadThicknesses = useCallback(() => {
    fetchThicknesses({ onlyNestable: false, onlyPending: false })
      .then(setThicknesses)
      .catch((err) => setMsg({ kind: "error", text: errorText(err) }));
  }, []);

  useEffect(() => {
    loadThicknesses();
  }, [loadThicknesses]);

  async function calcThickness() {
    setCalcBusy(true);
    try {
      const r = await recalcThickness();
      setMsg({
        kind: "success",
        text: `${r.updated} item(ns) com espessura calculada.${r.unresolved > 0 ? ` ${r.unresolved} item(ns) não puderam ser interpretados (ex.: tubo, barra redonda, descrição sem medida).` : ""}`,
      });
      loadThicknesses();
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setCalcBusy(false);
    }
  }

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
      if (res.rows.length === 0 && page > 0) {
        setPage(page - 1); // a página ficou vazia (ex.: após excluir): volta uma página
        return;
      }
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
    setSelected(new Set());
  }

  function goPage(p: number) {
    setPage(p);
    setSelected(new Set());
  }

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const isLaser = filters.nestingEligibility === "laser";

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
        subtitle={isLaser
          ? "Peças das linhas habilitadas para nesting. Acompanhe a programação e o corte a laser."
          : "Peças das demais linhas de produção. O fluxo delas não utiliza nesting a laser."}
        actions={
          <>
            <button className="btn secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} /> Atualizar
            </button>
            {canPlan && selected.size > 0 && (
              <button className="btn danger-outline" onClick={() => setDeleteIds([...selected])}>
                <Trash2 size={14} /> Excluir selecionados ({selected.size})
              </button>
            )}
            {canPlan && (
              <>
                <Link className="btn secondary" href="/baixa-ops">
                  <ClipboardCheck size={14} /> Baixa de OPs
                </Link>
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

      <div className="btn-row" role="tablist" aria-label="Grupo de peças" style={{ marginBottom: 14 }}>
        <button
          type="button"
          role="tab"
          aria-selected={isLaser}
          className={isLaser ? "pill blue" : "pill gray"}
          style={{ border: 0, cursor: "pointer", fontSize: 13, padding: "7px 14px" }}
          onClick={() => changeFilter({ nestingEligibility: "laser" })}
        >
          Laser
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isLaser}
          className={!isLaser ? "pill blue" : "pill gray"}
          style={{ border: 0, cursor: "pointer", fontSize: 13, padding: "7px 14px" }}
          onClick={() => changeFilter({ nestingEligibility: "other" })}
        >
          Demais peças
        </button>
      </div>

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
            {ITEM_FILTER_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-thick">Espessura</label>
          <select id="f-thick" className="select" value={filters.thickness ?? ""} onChange={(e) => changeFilter({ thickness: e.target.value })}>
            <option value="">Todas</option>
            {thicknesses
              .filter((t) => t.thickness_mm !== null)
              .map((t) => (
                <option key={t.thickness_mm} value={String(Number(t.thickness_mm))}>
                  {formatMm(Number(t.thickness_mm))} ({t.items})
                </option>
              ))}
            {thicknesses.some((t) => t.thickness_mm === null) && <option value="none">Sem espessura definida</option>}
          </select>
        </div>
        {canPlan && (
          <button className="btn secondary" onClick={() => void calcThickness()} disabled={calcBusy} title="Calcula a espessura (mm) dos itens que ainda não têm, a partir da descrição da matéria-prima">
            {calcBusy ? "Calculando..." : "Calcular espessuras"}
          </button>
        )}
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
                  {canPlan && (
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                        aria-label="Selecionar todos desta página"
                        style={{ width: 16, height: 16 }}
                      />
                    </th>
                  )}
                  <th>OP</th>
                  <th>Item</th>
                  <th>Matéria-prima</th>
                  <th>Espessura</th>
                  <th>Lista</th>
                  <th>Linha</th>
                  <th className="num">Qtd.</th>
                  {isLaser && <>
                    <th className="num" title="Programado em nestings (um nesting concluído conta só o que foi cortado)">Programado</th>
                    <th className="num">Cortado</th>
                    <th className="num">Pendente de corte</th>
                  </>}
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const excess = r.qty_excess_programmed > 0 || r.qty_excess_cut > 0;
                  return (
                    <tr key={r.id}>
                      {canPlan && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            onChange={(e) => toggleOne(r.id, e.target.checked)}
                            aria-label={`Selecionar OP ${r.op_number}`}
                            style={{ width: 16, height: 16 }}
                          />
                        </td>
                      )}
                      <td>
                        <Link className="link" href={`/ops/${r.id}`}>
                          {r.op_number}
                        </Link>
                      </td>
                      <td>{r.item_code ?? "—"}</td>
                      <td style={{ maxWidth: 260 }} className="muted">{r.material ?? r.description ?? "—"}</td>
                      <td className="nowrap">{formatMm(r.thickness_mm)}</td>
                      <td>{r.list_name ? listLabel(r.list_code, r.list_name) : <span className="pill red">Sem lista</span>}</td>
                      <td>{r.line_name ?? <span className="pill red">Sem linha</span>}</td>
                      <td className="num">
                        {formatQty(r.qty_total)} <span className="muted">{r.unit}</span>
                      </td>
                      {isLaser && <>
                        <td className="num">
                          {formatQty(r.qty_programmed)}
                          {excess && <div><span className="pill amber" title="Programado acima do necessário (excedente autorizado)">excedente</span></div>}
                        </td>
                        <td className="num">{formatQty(r.qty_cut)}</td>
                        <td className="num">{formatQty(r.qty_pending_cut)}</td>
                      </>}
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
                              <button className="btn danger-outline small" onClick={() => setDeleteIds([r.id])}>
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
          <Pagination page={page} total={total} onPage={goPage} />
        </>
      )}

      {modal && (
        <ItemFormModal
          editing={modal.editing}
          lists={activeLists}
          lines={lines.filter((l) =>
            (l.active || l.id === modal.editing?.production_line_id) &&
            (modal.editing !== null || l.allows_nesting === isLaser),
          )}
          defaultListId={filters.listId}
          onClose={() => setModal(null)}
          onSaved={(text) => {
            setModal(null);
            setMsg({ kind: "success", text });
            void load();
          }}
        />
      )}

      {deleteIds && (
        <DeleteItemsDialog
          ids={deleteIds}
          onClose={() => setDeleteIds(null)}
          onDone={(text) => {
            setDeleteIds(null);
            setSelected(new Set());
            setMsg({ kind: "success", text });
            void load();
          }}
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
