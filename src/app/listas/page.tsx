"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { DeleteListDialog } from "@/components/DeleteDialogs";
import { ConfirmModal, Modal } from "@/components/Modal";
import { EmptyState, Loading, Notice, PageHeader, StatusPill } from "@/components/ui";
import { LIST_STATUSES, LIST_TYPES } from "@/lib/constants";
import { errorText } from "@/lib/errors";
import { formatDate, formatQty, listLabel, todayISO } from "@/lib/format";
import { createList, fetchListSummaries, setListStatus, updateList, type ListInput } from "@/lib/lists";
import type { ListStatus, ListSummary, ListType } from "@/lib/types";

type Message = { kind: "success" | "error"; text: string } | null;

function ListFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: ListSummary | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [code, setCode] = useState(editing?.code ?? "");
  const [delivery, setDelivery] = useState(editing?.delivery_date ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<ListType>(editing?.list_type ?? LIST_TYPES[0]);
  const [date, setDate] = useState(editing?.reference_date ?? todayISO());
  const [status, setStatus] = useState<ListStatus>(editing?.status ?? "Planejada");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === "") {
      setError("Informe o nome ou código da lista.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input: ListInput = { code, delivery_date: delivery, name, list_type: type, reference_date: date, status, notes };
      if (editing) await updateList(editing.id, input);
      else await createList(input);
      onSaved(editing ? "Lista atualizada." : "Lista criada com sucesso.");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? "Editar lista" : "Nova lista de produção"}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" form="list-form" disabled={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      <form id="list-form" className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="l-code">Número da lista</label>
          <input id="l-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: 08" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="l-name">Nome (equipamento) *</label>
          <input id="l-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Conteiner" />
        </div>
        <div className="field">
          <label htmlFor="l-delivery">Data de entrega</label>
          <input id="l-delivery" className="input" type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="l-type">Tipo *</label>
          <select id="l-type" className="select" value={type} onChange={(e) => setType(e.target.value as ListType)}>
            {LIST_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="l-date">Data de referência</label>
          <input id="l-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {editing && (
          <div className="field">
            <label htmlFor="l-status">Status</label>
            <select id="l-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ListStatus)}>
              {LIST_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field full">
          <label htmlFor="l-notes">Observações</label>
          <textarea id="l-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {type === "Leniors" && (
          <div className="full">
            <Notice kind="info">
              Leniors: as peças são produzidas aqui e seguem para a empresa vizinha (exceto dobra e acabamento). O fluxo específico
              será configurado na Fase 6; por enquanto a lista funciona como as demais.
            </Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}

export default function ListasPage() {
  const { canPlan } = useAuth();
  const [rows, setRows] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Message>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ativas");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ editing: ListSummary | null } | null>(null);
  const [archiving, setArchiving] = useState<ListSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchListSummaries());
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter && r.list_type !== typeFilter) return false;
      if (statusFilter === "ativas" ? r.status === "Arquivada" : statusFilter !== "todas" && r.status !== statusFilter) return false;
      if (term && !r.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, typeFilter, statusFilter, search]);

  async function toggleArchive(list: ListSummary) {
    setBusy(true);
    try {
      await setListStatus(list.id, list.status === "Arquivada" ? "Planejada" : "Arquivada");
      setMsg({ kind: "success", text: list.status === "Arquivada" ? "Lista restaurada." : "Lista arquivada. Os dados continuam salvos." });
      setArchiving(null);
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
      setArchiving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="content">
      <PageHeader
        eyebrow="PCP / Cadastros"
        title="Listas de produção"
        subtitle="Rodoviário, Ambiental, Pós-vendas, Avulsos e Leniors. Cada OP e cada nesting pertence a uma lista."
        actions={
          <>
            <button className="btn secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} /> Atualizar
            </button>
            {canPlan && (
              <button className="btn primary" onClick={() => setModal({ editing: null })}>
                <Plus size={14} /> Nova lista
              </button>
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
          <label htmlFor="f-search">Buscar pelo nome</label>
          <input id="f-search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Digite parte do nome da lista" />
        </div>
        <div className="field">
          <label htmlFor="f-type">Tipo</label>
          <select id="f-type" className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Todos</option>
            {LIST_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ativas">Ativas (sem arquivadas)</option>
            <option value="todas">Todas</option>
            {LIST_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="card">
          {rows.length === 0 ? (
            <EmptyState title="Nenhuma lista cadastrada ainda">
              {canPlan ? "Clique em “Nova lista” para criar a primeira. Depois cadastre as OPs e peças dentro dela." : "Peça a alguém do PCP para cadastrar as listas."}
            </EmptyState>
          ) : (
            <EmptyState title="Nenhuma lista encontrada com esses filtros" />
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lista</th>
                <th>Tipo</th>
                <th>Entrega</th>
                <th>Criada em</th>
                <th className="num">Itens</th>
                <th className="num">Qtd. total</th>
                <th className="num">Nestings</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link className="link" href={`/listas/${l.id}`}>
                      {listLabel(l.code, l.name)}
                    </Link>
                    {l.notes && <div className="muted">{l.notes}</div>}
                  </td>
                  <td>{l.list_type}</td>
                  <td>{formatDate(l.delivery_date)}</td>
                  <td>{formatDate(l.created_at)}</td>
                  <td className="num">{l.items_count}</td>
                  <td className="num">{formatQty(l.qty_total)}</td>
                  <td className="num">{l.nestings_count}</td>
                  <td>
                    <StatusPill status={l.status} />
                  </td>
                  <td>
                    <div className="btn-row">
                      <Link className="btn secondary small" href={`/listas/${l.id}`}>
                        Abrir
                      </Link>
                      {canPlan && (
                        <>
                          <button className="btn secondary small" onClick={() => setModal({ editing: l })}>
                            <Pencil size={12} /> Editar
                          </button>
                          <button className="btn secondary small" onClick={() => setArchiving(l)}>
                            {l.status === "Arquivada" ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                            {l.status === "Arquivada" ? "Restaurar" : "Arquivar"}
                          </button>
                          <button className="btn danger-outline small" onClick={() => setDeletingId(l.id)}>
                            <Trash2 size={12} /> Excluir
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ListFormModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={(text) => {
            setModal(null);
            setMsg({ kind: "success", text });
            void load();
          }}
        />
      )}

      {deletingId && (
        <DeleteListDialog
          listId={deletingId}
          onClose={() => setDeletingId(null)}
          onDone={(text) => {
            setDeletingId(null);
            setMsg({ kind: "success", text });
            void load();
          }}
        />
      )}

      {archiving && (
        <ConfirmModal
          title={archiving.status === "Arquivada" ? "Restaurar lista" : "Arquivar lista"}
          message={
            archiving.status === "Arquivada" ? (
              <>A lista <strong>{listLabel(archiving.code, archiving.name)}</strong> voltará a aparecer como Planejada.</>
            ) : (
              <>
                A lista <strong>{listLabel(archiving.code, archiving.name)}</strong> sai das listas ativas e não aceita novos itens nem nestings. Nenhum dado é apagado e
                você pode restaurá-la depois.
              </>
            )
          }
          confirmLabel={archiving.status === "Arquivada" ? "Restaurar" : "Arquivar"}
          busy={busy}
          onConfirm={() => void toggleArchive(archiving)}
          onCancel={() => setArchiving(null)}
        />
      )}
    </main>
  );
}
