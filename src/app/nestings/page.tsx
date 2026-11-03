"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { DeleteNestingDialog } from "@/components/DeleteDialogs";
import { EmptyState, Loading, Notice, PageHeader, Pagination, StatusPill } from "@/components/ui";
import { NESTING_STATUSES } from "@/lib/constants";
import { errorText } from "@/lib/errors";
import { formatDate, formatQty, listLabel } from "@/lib/format";
import { searchNestings, type NestingFilters } from "@/lib/nestings";
import { fetchLaserMachines, fetchListOptions, type ListOption } from "@/lib/reference";
import type { LaserMachine, NestingSummary } from "@/lib/types";

function NestingsContent() {
  const { canPlan } = useAuth();
  const params = useSearchParams();
  const [filters, setFilters] = useState<NestingFilters>({ listId: params.get("lista") ?? "", machineId: "", status: "", search: "" });
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<NestingSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [machines, setMachines] = useState<LaserMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchListOptions(true), fetchLaserMachines(false)])
      .then(([l, m]) => {
        setLists(l);
        setMachines(m);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await searchNestings(filters, page);
      if (res.rows.length === 0 && page > 0) {
        setPage(page - 1); // a página ficou vazia (ex.: após excluir)
        return;
      }
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeFilter(patch: Partial<NestingFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }

  return (
    <main className="content">
      <PageHeader
        eyebrow="Chão de fábrica / Laser"
        title="Nestings"
        subtitle="Programas de corte (Laser 6KW, 12KW, 40KW ou Bobina). Um nesting pode reunir peças de várias listas."
        actions={
          <>
            <button className="btn secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} /> Atualizar
            </button>
            {canPlan && (
              <Link className="btn primary" href={filters.listId ? `/nestings/novo?lista=${filters.listId}` : "/nestings/novo"}>
                <Plus size={14} /> Novo nesting
              </Link>
            )}
          </>
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
      {success && <Notice kind="success" onClose={() => setSuccess("")}>{success}</Notice>}

      <div className="toolbar">
        <div className="field grow">
          <label htmlFor="n-search">Código do nesting</label>
          <input id="n-search" className="input" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Ex.: L2446" />
        </div>
        <div className="field">
          <label htmlFor="n-list">Lista</label>
          <select id="n-list" className="select" value={filters.listId} onChange={(e) => changeFilter({ listId: e.target.value })}>
            <option value="">Todas</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{listLabel(l.code, l.name)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="n-machine">Máquina</label>
          <select id="n-machine" className="select" value={filters.machineId} onChange={(e) => changeFilter({ machineId: e.target.value })}>
            <option value="">Todas</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="n-status">Status</label>
          <select id="n-status" className="select" value={filters.status} onChange={(e) => changeFilter({ status: e.target.value })}>
            <option value="">Todos</option>
            {NESTING_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Nenhum nesting encontrado">
            {canPlan ? "Crie o primeiro nesting escolhendo uma lista que já tenha OPs cadastradas." : "Ajuste os filtros ou aguarde o PCP programar os cortes."}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Listas</th>
                  <th>Máquina</th>
                  <th>Material</th>
                  <th>Data programada</th>
                  <th className="num">OPs</th>
                  <th className="num">Programado</th>
                  <th className="num">Cortado</th>
                  <th>Status</th>
                  {canPlan && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id}>
                    <td><Link className="link" href={`/nestings/${n.id}`}>{n.code}</Link></td>
                    <td style={{ maxWidth: 260 }}>{n.list_names ?? <span className="muted">sem OPs</span>}</td>
                    <td>{n.machine_name ?? <span className="pill red">Sem máquina</span>}</td>
                    <td>{n.material ?? "—"}{n.thickness_mm ? ` · ${formatQty(n.thickness_mm)} mm` : ""}</td>
                    <td>{formatDate(n.programmed_at)}</td>
                    <td className="num">{n.items_count}</td>
                    <td className="num">{formatQty(n.qty_programmed)}</td>
                    <td className="num">{formatQty(n.qty_cut)}</td>
                    <td><StatusPill status={n.status} /></td>
                    {canPlan && (
                      <td>
                        <button className="btn danger-outline small" onClick={() => setDeletingId(n.id)}>
                          <Trash2 size={12} /> Excluir
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} onPage={setPage} />
        </>
      )}
      {deletingId && (
        <DeleteNestingDialog
          nestingId={deletingId}
          onClose={() => setDeletingId(null)}
          onDone={(text) => {
            setDeletingId(null);
            setSuccess(text);
            void load();
          }}
        />
      )}
    </main>
  );
}

export default function NestingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NestingsContent />
    </Suspense>
  );
}
