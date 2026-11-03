"use client";

import { useEffect, useState } from "react";
import { ConfirmModal, Modal } from "./Modal";
import { Loading, Notice } from "./ui";
import {
  deleteItems,
  deleteList,
  deleteNesting,
  fetchItemsDeleteInfo,
  fetchListDeleteInfo,
  fetchNestingDeleteInfo,
  type ItemsDeleteInfo,
  type ListDeleteInfo,
  type NestingDeleteInfo,
} from "@/lib/deletion";
import { errorText } from "@/lib/errors";
import { formatQty } from "@/lib/format";

/** Janela só de aviso, para quando a exclusão não é permitida. */
function BlockedModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <button className="btn secondary" onClick={onClose}>
          Entendi
        </button>
      }
    >
      {children}
    </Modal>
  );
}

function LoadingModal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <Loading label="Verificando dependências..." />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ITENS (OPs)
// ---------------------------------------------------------------------------
export function DeleteItemsDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const [info, setInfo] = useState<ItemsDeleteInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchItemsDeleteInfo(ids)
      .then((r) => {
        if (!cancelled) setInfo(r);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [ids]);

  if (error) {
    return (
      <BlockedModal title="Excluir item" onClose={onClose}>
        <Notice kind="error">{error}</Notice>
      </BlockedModal>
    );
  }
  if (!info) return <LoadingModal title="Excluir item" onClose={onClose} />;

  const blockedList = (
    <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
      {info.blocked.map((b) => (
        <li key={b.id}>
          <strong>OP {b.op_number}</strong> / {b.item_code ?? "sem código"}: {b.reason}
        </li>
      ))}
      {info.total - info.deletable > info.blocked.length && <li>…e outros.</li>}
    </ul>
  );

  if (info.deletable === 0) {
    return (
      <BlockedModal title="Não é possível excluir" onClose={onClose}>
        <p style={{ marginTop: 0 }}>Nenhum dos itens selecionados pode ser excluído, porque há registros que dependem deles:</p>
        {blockedList}
        <p className="muted" style={{ marginTop: 12 }}>
          Remova o item dos nestings Programados (editando o nesting) ou, se houver produção registrada, mantenha o registro. Você também pode arquivar o item.
        </p>
      </BlockedModal>
    );
  }

  async function confirm() {
    setBusy(true);
    try {
      const r = await deleteItems(ids);
      onDone(
        `${r.deleted} item(ns) excluído(s) definitivamente.` +
          (r.blocked.length > 0 ? ` ${r.blocked.length} item(ns) foram mantidos por terem dependências.` : ""),
      );
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <ConfirmModal
      danger
      title={info.deletable === 1 ? "Excluir item definitivamente" : `Excluir ${info.deletable} itens definitivamente`}
      confirmLabel={`Excluir ${info.deletable} item(ns)`}
      busy={busy}
      typeToConfirm={info.deletable >= 10 ? "EXCLUIR" : undefined}
      onConfirm={() => void confirm()}
      onCancel={onClose}
      message={
        <>
          <p style={{ marginTop: 0 }}>
            Serão <strong>apagados do banco</strong> (não é possível desfazer):
          </p>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {info.sample.map((s) => (
              <li key={s}>{s}</li>
            ))}
            {info.deletable > info.sample.length && <li>…e mais {info.deletable - info.sample.length}.</li>}
          </ul>
          {info.blocked.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Notice kind="warning">
                <strong>{info.total - info.deletable} item(ns) serão mantidos</strong> por terem dependências:
                {blockedList}
              </Notice>
            </div>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>
            A exclusão fica registrada no log de exclusões.
          </p>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// LISTAS
// ---------------------------------------------------------------------------
export function DeleteListDialog({ listId, onClose, onDone }: { listId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [info, setInfo] = useState<ListDeleteInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchListDeleteInfo(listId)
      .then((r) => {
        if (!cancelled) setInfo(r);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [listId]);

  if (error) {
    return (
      <BlockedModal title="Excluir lista" onClose={onClose}>
        <Notice kind="error">{error}</Notice>
      </BlockedModal>
    );
  }
  if (!info) return <LoadingModal title="Excluir lista" onClose={onClose} />;

  const label = info.code ? `${info.code} - ${info.name}` : info.name;

  if (info.legacy_nestings > 0) {
    return (
      <BlockedModal title="Não é possível excluir a lista" onClose={onClose}>
        A lista <strong>{label}</strong> está ligada a {info.legacy_nestings} nesting(s) antigo(s) do protótipo e não pode ser excluída.
      </BlockedModal>
    );
  }

  if (info.blocked_count > 0) {
    return (
      <BlockedModal title="Não é possível excluir a lista" onClose={onClose}>
        <p style={{ marginTop: 0 }}>
          A lista <strong>{label}</strong> tem {info.items} item(ns), e <strong>{info.blocked_count}</strong> deles têm dependências (nesting, produção ou nota fiscal):
        </p>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {info.blocked_sample.map((b) => (
            <li key={`${b.op_number}-${b.item_code}`}>
              <strong>OP {b.op_number}</strong> / {b.item_code ?? "sem código"}: {b.reason}
            </li>
          ))}
          {info.blocked_count > info.blocked_sample.length && <li>…e outros.</li>}
        </ul>
        <p className="muted" style={{ marginTop: 12 }}>
          Nada foi alterado. Se a lista não for mais usada, você pode <strong>arquivá-la</strong> em vez de excluir.
        </p>
      </BlockedModal>
    );
  }

  async function confirm() {
    setBusy(true);
    try {
      const r = await deleteList(listId, info !== null && info.items > 0);
      onDone(`Lista “${label}” excluída${r.deleted_items > 0 ? ` junto com ${r.deleted_items} item(ns)` : ""}.`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <ConfirmModal
      danger
      title="Excluir lista definitivamente"
      confirmLabel={info.items > 0 ? `Excluir lista e ${info.items} item(ns)` : "Excluir lista"}
      busy={busy}
      typeToConfirm={info.items > 0 ? info.name : undefined}
      onConfirm={() => void confirm()}
      onCancel={onClose}
      message={
        <>
          <p style={{ marginTop: 0 }}>
            A lista <strong>{label}</strong> será <strong>apagada do banco</strong> e não poderá ser recuperada.
          </p>
          {info.items > 0 ? (
            <Notice kind="warning">
              Isso também exclui os <strong>{info.items} item(ns)</strong> dela (quantidade total {formatQty(info.qty_total)}). Nenhum deles está em nesting nem tem produção registrada.
            </Notice>
          ) : (
            <p>A lista não tem itens.</p>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>
            A exclusão fica registrada no log de exclusões.
          </p>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// NESTINGS
// ---------------------------------------------------------------------------
export function DeleteNestingDialog({ nestingId, onClose, onDone }: { nestingId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [info, setInfo] = useState<NestingDeleteInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchNestingDeleteInfo(nestingId)
      .then((r) => {
        if (!cancelled) setInfo(r);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [nestingId]);

  if (error) {
    return (
      <BlockedModal title="Excluir nesting" onClose={onClose}>
        <Notice kind="error">{error}</Notice>
      </BlockedModal>
    );
  }
  if (!info) return <LoadingModal title="Excluir nesting" onClose={onClose} />;

  if (!info.safe && !info.is_admin) {
    return (
      <BlockedModal title="Não é possível excluir o nesting" onClose={onClose}>
        <p style={{ marginTop: 0 }}>
          O nesting <strong>{info.code}</strong> está <strong>{info.status}</strong>
          {info.cut_total > 0 ? ` e tem ${formatQty(info.cut_total)} peça(s) cortada(s) registrada(s)` : ""}. Nestings com produção só podem ser excluídos por um <strong>administrador</strong>.
        </p>
        <p className="muted">Se for só um planejamento errado e ainda não houve corte, use <strong>Cancelar</strong>.</p>
      </BlockedModal>
    );
  }

  async function confirm() {
    setBusy(true);
    try {
      await deleteNesting(nestingId, info !== null && !info.safe);
      onDone(`Nesting ${info?.code} excluído.`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <ConfirmModal
      danger
      title="Excluir nesting definitivamente"
      confirmLabel="Excluir nesting"
      busy={busy}
      typeToConfirm={info.safe ? undefined : info.code}
      onConfirm={() => void confirm()}
      onCancel={onClose}
      message={
        <>
          <p style={{ marginTop: 0 }}>
            O nesting <strong>{info.code}</strong> ({info.status}) será <strong>apagado do banco</strong>, junto com seus {info.items} vínculo(s) com OPs
            {info.lists ? ` (listas: ${info.lists})` : ""} e {info.events} registro(s) de histórico.
          </p>
          {!info.safe && (
            <Notice kind="warning">
              Este nesting já teve produção{info.cut_total > 0 ? `: ${formatQty(info.cut_total)} peça(s) cortada(s)` : ""}. Ao excluí-lo, essas quantidades <strong>deixam de contar</strong> no saldo das OPs.
            </Notice>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>
            As OPs e listas não são afetadas, apenas o saldo é recalculado. A exclusão fica registrada no log de exclusões.
          </p>
        </>
      }
    />
  );
}
