"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, RefreshCw, SlidersHorizontal } from "lucide-react";
import { ITEM_STATUSES, NESTING_STATUSES } from "@/lib/constants";
import { EMPTY_DASHBOARD_FILTERS, fetchDashboard, hasActiveFilters, type DashboardFilters } from "@/lib/dashboard";
import { errorText } from "@/lib/errors";
import { formatQty, listLabel } from "@/lib/format";
import { fetchLaserMachines, fetchLines, fetchListOptions, type ListOption } from "@/lib/reference";
import type { DashboardSummary, LaserMachine, ProductionLine } from "@/lib/types";
import { EmptyState, Loading, Notice, PageHeader, ProgressBar } from "@/components/ui";

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{formatQty(value)}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_DASHBOARD_FILTERS);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [machines, setMachines] = useState<LaserMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    Promise.all([fetchListOptions(true), fetchLines(false), fetchLaserMachines(false)])
      .then(([l, ln, m]) => {
        setLists(l);
        setLines(ln);
        setMachines(m);
      })
      .catch((e) => setError(errorText(e)));
  }, []);


  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchDashboard(filters));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<DashboardFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = hasActiveFilters(filters);
  const nothingAtAll =
    data !== null &&
    !filtered &&
    data.lists_total === 0 &&
    data.items.total === 0 &&
    data.nestings.programmed + data.nestings.in_production + data.nestings.done_period + data.nestings.cancelled === 0;

  return (
    <main className="content dashboard">
      <PageHeader
        eyebrow="Painel de controle"
        title="Visão geral da produção"
        subtitle="Acompanhe listas, produção e corte a laser em um só lugar."
        actions={
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}>
              <SlidersHorizontal size={14} /> Filtros{filtered ? " (ativos)" : ""} <ChevronDown size={14} />
            </button>
            <button className="btn secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>
        }
      />

      {filtersOpen && <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="field">
            <label htmlFor="d-from">Período: de</label>
            <input id="d-from" className="input" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="d-to">até</label>
            <input id="d-to" className="input" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="d-list">Lista</label>
            <select id="d-list" className="select" value={filters.listId} onChange={(e) => set({ listId: e.target.value })}>
              <option value="">Todas</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{listLabel(l.code, l.name)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-line">Linha de produção</label>
            <select id="d-line" className="select" value={filters.lineId} onChange={(e) => set({ lineId: e.target.value })}>
              <option value="">Todas</option>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-istatus">Status do item</label>
            <select id="d-istatus" className="select" value={filters.itemStatus} onChange={(e) => set({ itemStatus: e.target.value })}>
              <option value="">Todos</option>
              {ITEM_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-nstatus">Status do nesting</label>
            <select id="d-nstatus" className="select" value={filters.nestingStatus} onChange={(e) => set({ nestingStatus: e.target.value })}>
              <option value="">Todos</option>
              {NESTING_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-machine">Máquina laser</label>
            <select id="d-machine" className="select" value={filters.machineId} onChange={(e) => set({ machineId: e.target.value })}>
              <option value="">Todas</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {filtered && (
            <button className="btn secondary" onClick={() => setFilters(EMPTY_DASHBOARD_FILTERS)}>Limpar filtros</button>
          )}
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Período: data de criação (nestings concluídos usam a data de conclusão). Status do item e linha afetam os indicadores de itens; status do nesting e máquina afetam os de laser.
        </p>
      </div>}

      {error && <Notice kind="error">{error}</Notice>}

      {loading && !data ? (
        <Loading />
      ) : data && nothingAtAll ? (
        <div className="card">
          <EmptyState title="O banco ainda está vazio">
            Comece cadastrando os dados reais da fábrica:
            <div className="steps">
              <div className="step"><b>1.</b> Crie uma <Link className="link" href="/listas">lista de produção</Link>.</div>
              <div className="step"><b>2.</b> Cadastre OPs e peças ou <Link className="link" href="/ops/colar">cole do Excel</Link>.</div>
              <div className="step"><b>3.</b> Crie um <Link className="link" href="/nestings/novo">nesting</Link> e acompanhe o corte.</div>
            </div>
          </EmptyState>
        </div>
      ) : data ? (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <h2 className="section-title" style={{ margin: "4px 0 10px" }}>Listas e itens</h2>
          <div className="grid stats">
            <Stat label="Listas cadastradas" value={data.lists_total} />
            <Stat label="OPs em aberto" value={data.items.ops_open} hint={`${formatQty(data.items.open)} item(ns) em aberto`} />
            <Stat label="OPs aguardando produção" value={data.items.ops_waiting} hint={`${formatQty(data.items.waiting)} item(ns) aguardando`} />
            <Stat label="Itens cadastrados" value={data.items.total} />
          </div>
          <div className="grid stats">
            <Stat label="Itens em produção" value={data.items.in_production} hint={data.items.partial > 0 ? `+ ${formatQty(data.items.partial)} parcial(is)` : undefined} />
            <Stat label="Itens concluídos" value={data.items.done} />
            <Stat label="Itens bloqueados" value={data.items.blocked} />
            <Stat label="Itens parciais" value={data.items.partial} />
          </div>

          <h2 className="section-title" style={{ margin: "8px 0 10px" }}>Corte a laser</h2>
          <div className="grid stats">
            <Stat label="Nestings programados" value={data.nestings.programmed} />
            <Stat label="Nestings em produção" value={data.nestings.in_production} />
            <Stat label="Nestings concluídos no período" value={data.nestings.done_period} />
            <Stat label="Nestings cancelados" value={data.nestings.cancelled} />
          </div>
          <div className="grid stats" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <Stat label="Peças programadas para laser" value={data.nestings.pieces_programmed} hint="Nesting concluído conta só o que foi cortado" />
            <Stat label="Peças efetivamente cortadas" value={data.nestings.pieces_cut} hint="Nestings em produção e concluídos" />
          </div>

          <div className="grid two">
            <section className="card">
              <h2 className="section-title">Itens por linha de produção</h2>
              {data.items_by_line.length === 0 ? (
                <div className="empty">Sem itens para os filtros atuais.</div>
              ) : (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table>
                    <thead><tr><th>Linha</th><th className="num">Itens</th><th className="num">Concluídos</th><th style={{ width: 130 }}>Andamento</th></tr></thead>
                    <tbody>
                      {data.items_by_line.map((l) => (
                        <tr key={l.line}>
                          <td>{l.line}</td>
                          <td className="num">{l.total}</td>
                          <td className="num">{l.done}</td>
                          <td><ProgressBar value={l.total ? (l.done / l.total) * 100 : 0} tone="green" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="card">
              <h2 className="section-title">Nestings por máquina laser</h2>
              {data.nestings_by_machine.length === 0 ? (
                <div className="empty">Sem nestings para os filtros atuais.</div>
              ) : (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table>
                    <thead><tr><th>Máquina</th><th className="num">Programados</th><th className="num">Em produção</th><th className="num">Concluídos</th><th className="num">Peças prog.</th><th className="num">Peças cortadas</th></tr></thead>
                    <tbody>
                      {data.nestings_by_machine.map((m) => (
                        <tr key={m.machine}>
                          <td>{m.machine}</td>
                          <td className="num">{m.programmed}</td>
                          <td className="num">{m.in_production}</td>
                          <td className="num">{m.done}</td>
                          <td className="num">{formatQty(m.pieces_programmed)}</td>
                          <td className="num">{formatQty(m.pieces_cut)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </main>
  );
}
