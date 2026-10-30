"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { Notice } from "./ui";
import { ITEM_STATUSES, UNITS } from "@/lib/constants";
import { errorText } from "@/lib/errors";
import { emptyToNull, listLabel } from "@/lib/format";
import { parseDecimalBR } from "@/lib/excel-paste";
import { createItem, updateItem, type ItemInput } from "@/lib/items";
import type { ListOption } from "@/lib/reference";
import type { ItemBalance, ItemStatus, ProductionLine } from "@/lib/types";

function numberToText(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

interface Props {
  editing: ItemBalance | null;
  lists: ListOption[];
  lines: ProductionLine[];
  defaultListId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Formulário para cadastrar ou editar UM item de uma OP. */
export function ItemFormModal({ editing, lists, lines, defaultListId, onClose, onSaved }: Props) {
  const [op, setOp] = useState(editing?.op_number ?? "");
  const [listId, setListId] = useState(editing?.list_id ?? defaultListId ?? "");
  const [lineId, setLineId] = useState(editing?.production_line_id ?? "");
  const [item, setItem] = useState(editing?.item_code ?? "");
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [qty, setQty] = useState(numberToText(editing?.qty_total));
  const [unit, setUnit] = useState(editing?.unit ?? "un");
  const [equip, setEquip] = useState(editing?.equipment_name ?? "");
  const [material, setMaterial] = useState(editing?.material ?? "");
  const [thick, setThick] = useState(numberToText(editing?.thickness_mm));
  const [due, setDue] = useState(editing?.due_date ?? "");
  const [status, setStatus] = useState<ItemStatus>(editing?.status ?? "Aguardando");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!listId) return setError("Selecione a lista de produção.");
    // Peças avulsas (sem OP) são aceitas em listas do tipo Avulsos: ficam como "S/OP".
    const isAvulsos = lists.find((l) => l.id === listId)?.list_type === "Avulsos";
    const opValue = op.trim() === "" && isAvulsos ? "S/OP" : op.trim();
    if (opValue === "") return setError("Informe o número da OP (só listas Avulsos aceitam peça sem OP).");
    if (!lineId) return setError("Selecione a linha de produção.");
    if (item.trim() === "" && desc.trim() === "") return setError("Informe o código do item ou a descrição.");
    const q = parseDecimalBR(qty).value;
    if (q === null || q <= 0) return setError("A quantidade deve ser um número maior que zero.");
    let t: number | null = null;
    if (thick.trim() !== "") {
      t = parseDecimalBR(thick).value;
      if (t === null || t < 0) return setError("A espessura deve ser um número válido (zero ou mais).");
    }
    const input: ItemInput = {
      op_number: opValue,
      list_id: listId,
      production_line_id: lineId,
      item_code: emptyToNull(item),
      description: emptyToNull(desc),
      quantity: q,
      unit,
      equipment_name: emptyToNull(equip),
      material: emptyToNull(material),
      thickness_mm: t,
      due_date: emptyToNull(due),
      status,
      notes: emptyToNull(notes),
    };
    setBusy(true);
    try {
      if (editing) await updateItem(editing.id, input);
      else await createItem(input);
      onSaved(editing ? "Item atualizado." : "Item cadastrado.");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  // Ao editar, a lista atual pode estar arquivada e não aparecer nas opções.
  const listOptions =
    editing?.list_id && !lists.some((l) => l.id === editing.list_id)
      ? [...lists, { id: editing.list_id, code: editing.list_code, name: editing.list_name ?? "Lista", list_type: editing.list_type ?? "Avulsos", status: "Arquivada" as const }]
      : lists;

  return (
    <Modal
      title={editing ? "Editar item da OP" : "Novo item / peça"}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" form="item-form" disabled={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      <form id="item-form" className="form three" onSubmit={submit}>
        <div className="field">
          <label htmlFor="i-op">Número da OP {lists.find((l) => l.id === listId)?.list_type === "Avulsos" ? "(opcional em Avulsos)" : "*"}</label>
          <input id="i-op" className="input" value={op} onChange={(e) => setOp(e.target.value)} placeholder="028854" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="i-list">Lista *</label>
          <select id="i-list" className="select" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Selecione...</option>
            {listOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {listLabel(l.code, l.name)} ({l.list_type})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="i-line">Linha de produção *</label>
          <select id="i-line" className="select" value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">Selecione...</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="i-item">Código / referência da peça</label>
          <input id="i-item" className="input" value={item} onChange={(e) => setItem(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label htmlFor="i-desc">Descrição</label>
          <input id="i-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="i-qty">Quantidade total necessária *</label>
          <input id="i-qty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Ex.: 4 ou 2,5" />
        </div>
        <div className="field">
          <label htmlFor="i-unit">Unidade</label>
          <select id="i-unit" className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {(UNITS as readonly string[]).includes(unit) ? null : <option>{unit}</option>}
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="i-equip">Equipamento</label>
          <input id="i-equip" className="input" value={equip} onChange={(e) => setEquip(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="i-mat">Matéria-prima</label>
          <input id="i-mat" className="input" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex.: A36" />
        </div>
        <div className="field">
          <label htmlFor="i-thick">Espessura (mm)</label>
          <input id="i-thick" className="input" inputMode="decimal" value={thick} onChange={(e) => setThick(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="i-due">Data prevista</label>
          <input id="i-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="i-status">Status de produção</label>
          <select id="i-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
            {ITEM_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="field full">
          <label htmlFor="i-notes">Observações</label>
          <textarea id="i-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
