"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ItemFormModal } from "./ItemFormModal";
import { Loading, Notice, Pagination } from "./ui";
import { NESTING_CODE_REGEX } from "@/lib/constants";
import { errorText } from "@/lib/errors";
import { emptyToNull, formatQty, listLabel } from "@/lib/format";
import { parseDecimalBR } from "@/lib/excel-paste";
import { fetchItemsByIds, fetchItemsByOpCodes, searchItems } from "@/lib/items";
import { parseNestingText } from "@/lib/nesting-text";
import { fetchNesting, fetchNestingItems, fetchNextNestingCode, saveNesting, type NestingItemInput } from "@/lib/nestings";
import { fetchLaserMachines, fetchLines, fetchListOptions, type ListOption } from "@/lib/reference";
import type { ItemBalance, LaserMachine, ProductionLine } from "@/lib/types";

interface Selected {
  item: ItemBalance;
  qty: string;
  allowExcess: boolean;
}

function toText(n: number): string {
  return String(n).replace(".", ",");
}

/**
 * Formulário de nesting. Um nesting pode reunir peças de VÁRIAS listas;
 * só aparecem peças de linhas que aceitam nesting (laser).
 */
export function NestingForm({ nestingId, initialListId }: { nestingId?: string; initialListId?: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [machines, setMachines] = useState<LaserMachine[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);

  const [code, setCode] = useState("");
  const [machineId, setMachineId] = useState("");
  const [material, setMaterial] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [thick, setThick] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  const [own, setOwn] = useState<Record<string, number>>({}); // já programado NESTE nesting (edição)
  const [sel, setSel] = useState<Record<string, Selected>>({});

  // busca de peças
  const [listFilter, setListFilter] = useState(initialListId ?? "");
  const [lineFilter, setLineFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [onlyUnscheduled, setOnlyUnscheduled] = useState(true);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ItemBalance[]>([]);
  const [total, setTotal] = useState(0);
  const [pickLoading, setPickLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [avulsoModal, setAvulsoModal] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // importação do texto do PDF do nesting
  const [pdfText, setPdfText] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<{ kind: "success" | "warning" | "error"; lines: string[] } | null>(null);

  // Carga inicial
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [l, m, ln] = await Promise.all([fetchListOptions(false), fetchLaserMachines(true), fetchLines(false)]);
        if (cancelled) return;
        setLists(l);
        setMachines(m);
        setLines(ln);
        if (nestingId) {
          const [n, its] = await Promise.all([fetchNesting(nestingId), fetchNestingItems(nestingId)]);
          if (cancelled) return;
          if (!n) throw new Error("Nesting não encontrado.");
          if (n.status !== "Programado") throw new Error(`Só é possível editar nestings Programados (este está ${n.status}).`);
          setCode(n.code);
          setMachineId(n.laser_machine_id ?? "");
          setMaterial(n.material ?? "");
          setMaterialCode(n.material_code ?? "");
          setThick(n.thickness_mm !== null ? toText(n.thickness_mm) : "");
          setDate(n.programmed_at ?? "");
          setNotes(n.notes ?? "");
          const snapshots = await fetchItemsByIds(its.map((i) => i.production_order_id));
          if (cancelled) return;
          const byId = new Map(snapshots.map((s) => [s.id, s]));
          const ownMap: Record<string, number> = {};
          const selMap: Record<string, Selected> = {};
          its.forEach((i) => {
            const snap = byId.get(i.production_order_id);
            if (!snap) return;
            ownMap[i.production_order_id] = i.quantity_programmed;
            selMap[i.production_order_id] = { item: snap, qty: toText(i.quantity_programmed), allowExcess: i.allow_excess };
          });
          setOwn(ownMap);
          setSel(selMap);
        } else {
          setCode(await fetchNextNestingCode());
        }
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nestingId]);

  // busca com pequena espera
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Busca as peças disponíveis (somente linhas que aceitam nesting)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setPickLoading(true);
    searchItems({ listId: listFilter, lineId: lineFilter, status: "", search, showArchived: false, onlyNestable: true, onlyUnscheduled }, page)
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setPickLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, listFilter, lineFilter, search, onlyUnscheduled, page, refreshKey]);

  const available = useCallback((i: ItemBalance) => Math.max(0, i.qty_total - (i.qty_programmed - (own[i.id] ?? 0))), [own]);

  function add(i: ItemBalance) {
    const selectedNow = Object.values(sel);
    const base = selectedNow[0]?.item;
    const baseMaterial = (base?.material_code ?? base?.material ?? materialCode ?? material ?? "").trim().toUpperCase();
    const baseThickness = base?.thickness_mm ?? (thick.trim() ? parseDecimalBR(thick).value : null);
    const itemMaterial = (i.material_code ?? i.material ?? "").trim().toUpperCase();
    if (!itemMaterial || i.thickness_mm === null || (baseMaterial && itemMaterial !== baseMaterial) || (baseThickness !== null && i.thickness_mm !== baseThickness)) return;
    setSel((prev) => {
      if (prev[i.id]) return prev;
      const av = available(i);
      return { ...prev, [i.id]: { item: i, qty: av > 0 ? toText(av) : "", allowExcess: false } };
    });
    if (!materialCode.trim()) setMaterialCode(i.material_code ?? "");
    if (!material.trim()) setMaterial(i.material ?? "");
    if (!thick.trim() && i.thickness_mm !== null) setThick(toText(i.thickness_mm));
  }

  function remove(id: string) {
    setSel((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function patch(id: string, p: Partial<Selected>) {
    setSel((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  }

  /** Preenche código, data, chapa, máquina e peças a partir do texto copiado do PDF do nesting. */
  async function applyPdf() {
    setPdfMsg(null);
    const r = parseNestingText(pdfText);
    if (r.parts.length === 0 && !r.code) {
      setPdfMsg({ kind: "error", lines: r.warnings });
      return;
    }
    setPdfBusy(true);
    try {
      const lines: string[] = [];
      if (r.code) setCode(r.code);
      if (r.date) setDate(r.date);
      if (r.material) setMaterial(r.material);
      const guess = r.machine_guess ? machines.find((m) => m.name.toLowerCase() === r.machine_guess?.toLowerCase()) : undefined;
      if (guess) setMachineId(guess.id);
      else lines.push(`Máquina do PDF${r.machine_text ? ` (“${r.machine_text}”)` : ""} não reconhecida: selecione a máquina manualmente.`);
      const extra = [r.programmer ? `Programador: ${r.programmer}` : null, r.utilization ? `Aproveitamento ${r.utilization}%` : null, r.total_time ? `Tempo total ${r.total_time}` : null]
        .filter((x): x is string => x !== null)
        .join(" · ");
      if (extra && notes.trim() === "") setNotes(extra);

      const found = await fetchItemsByOpCodes(r.parts);
      const byKey = new Map(found.map((i) => [`${i.op_number}|${(i.item_code ?? "").toUpperCase()}`, i]));
      const toAdd: Record<string, Selected> = {};
      const missing: string[] = [];
      const blocked: string[] = [];
      let groupMaterial = materialCode.trim().toUpperCase() || material.trim().toUpperCase();
      let groupThickness = thick.trim() ? parseDecimalBR(thick).value : null;
      for (const p of r.parts) {
        const item = byKey.get(`${p.op_number}|${p.item_code.toUpperCase()}`);
        if (!item) { missing.push(`OP ${p.op_number} / ${p.item_code} (${p.equipment})`); continue; }
        if (!item.line_allows_nesting) { blocked.push(`OP ${p.op_number} / ${p.item_code} (linha ${item.line_name ?? "?"})`); continue; }
        const itemMaterial = (item.material_code ?? item.material ?? "").trim().toUpperCase();
        const itemThickness = item.thickness_mm;
        if (!itemMaterial || itemThickness === null) { blocked.push(`OP ${p.op_number} / ${p.item_code} (material ou espessura não cadastrados)`); continue; }
        if (!groupMaterial) groupMaterial = itemMaterial;
        if (groupThickness === null) groupThickness = itemThickness;
        if (itemMaterial !== groupMaterial) { blocked.push(`OP ${p.op_number} / ${p.item_code} (material diferente do grupo)`); continue; }
        if (itemThickness !== groupThickness) { blocked.push(`OP ${p.op_number} / ${p.item_code} (${formatQty(itemThickness)} mm diferente de ${formatQty(groupThickness)} mm)`); continue; }
        toAdd[item.id] = { item, qty: toText(p.quantity), allowExcess: false };
      }
      if (groupMaterial) { const first = Object.values(toAdd)[0]?.item; setMaterialCode(first?.material_code ?? groupMaterial); setMaterial(first?.material ?? material); }
      if (groupThickness !== null) setThick(toText(groupThickness));
      setSel((prev) => ({ ...prev, ...toAdd }));
      lines.unshift(`${Object.keys(toAdd).length} peça(s) adicionada(s) de ${r.parts.length} no PDF. Confira as quantidades abaixo.`);
      if (missing.length > 0) lines.push(`Não cadastradas no sistema (importe a lista correspondente e aplique de novo): ${missing.join("; ")}.`);
      if (blocked.length > 0) lines.push(`Linha não aceita nesting: ${blocked.join("; ")}.`);
      r.skipped.forEach((s) => lines.push(`Ignorada: ${s}.`));
      r.warnings.forEach((w) => lines.push(w));
      setPdfMsg({ kind: missing.length > 0 || blocked.length > 0 || !guess ? "warning" : "success", lines });
    } catch (e) {
      setPdfMsg({ kind: "error", lines: [errorText(e)] });
    } finally {
      setPdfBusy(false);
    }
  }

  const selected = Object.values(sel);
  const totalQty = selected.reduce((sum, s) => sum + (parseDecimalBR(s.qty).value ?? 0), 0);
  const nestableLines = lines.filter((l) => l.allows_nesting);
  const avulsoLists = lists.filter((l) => l.list_type === "Avulsos");
  const selectedGroup = selected[0]?.item;
  const groupMaterial = (selectedGroup?.material_code ?? selectedGroup?.material ?? materialCode ?? material ?? "").trim().toUpperCase();
  const groupThickness = selectedGroup?.thickness_mm ?? (thick.trim() ? parseDecimalBR(thick).value : null);

  function itemMatchesNestingGroup(i: ItemBalance): boolean {
    const itemMaterial = (i.material_code ?? i.material ?? "").trim().toUpperCase();
    return Boolean(itemMaterial && i.thickness_mm !== null && (!groupMaterial || itemMaterial === groupMaterial) && (groupThickness === null || i.thickness_mm === groupThickness));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!NESTING_CODE_REGEX.test(code.trim().toUpperCase())) return setError("Código inválido. Use a sequência L0001, L0002... (letra L e 4 ou mais dígitos).");
    if (!machineId) return setError("Selecione a máquina de corte.");
    let t: number | null = null;
    if (thick.trim() !== "") {
      t = parseDecimalBR(thick).value;
      if (t === null || t < 0) return setError("A espessura deve ser um número válido.");
    }
    if (selected.length > 0) {
      if (t === null) return setError("Informe a espessura. Um nesting aceita apenas peças de uma única espessura.");
      const firstMaterial = (selected[0].item.material_code ?? selected[0].item.material ?? "").trim().toUpperCase();
      if (!firstMaterial) return setError(`A OP ${selected[0].item.op_number} não possui material cadastrado.`);
      for (const s of selected) {
        const itemMaterial = (s.item.material_code ?? s.item.material ?? "").trim().toUpperCase();
        if (!itemMaterial || itemMaterial !== firstMaterial) return setError(`A OP ${s.item.op_number} possui material diferente. Um nesting não pode misturar materiais.`);
        if (s.item.thickness_mm === null || s.item.thickness_mm !== t) return setError(`A OP ${s.item.op_number} possui espessura ${formatQty(s.item.thickness_mm)} mm. Este nesting está em ${formatQty(t)} mm.`);
      }
    }
    const payload: NestingItemInput[] = [];
    for (const s of selected) {
      const q = parseDecimalBR(s.qty).value;
      const av = available(s.item);
      if (q === null || q <= 0) return setError(`Informe uma quantidade maior que zero para a OP ${s.item.op_number}.`);
      if (q > av && !s.allowExcess) {
        return setError(`A OP ${s.item.op_number} passaria do necessário (disponível: ${formatQty(av)}). Reduza a quantidade ou marque “Permitir excedente”.`);
      }
      payload.push({ production_order_id: s.item.id, quantity_programmed: q, notes: null, allow_excess: s.allowExcess && q > av });
    }
    setBusy(true);
    try {
      const id = await saveNesting({
        id: nestingId ?? null,
        code: code.trim(),
        laser_machine_id: machineId,
        material: emptyToNull(material),
        material_code: emptyToNull(materialCode || (selected[0]?.item.material_code ?? "")),
        thickness_mm: t,
        programmed_at: emptyToNull(date),
        notes: emptyToNull(notes),
        items: payload,
      });
      router.push(`/nestings/${id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (!ready) return <Loading />;

  return (
    <>
    <form onSubmit={submit} className="stack">
      {error && <Notice kind="error">{error}</Notice>}

      {!nestingId && (
        <section className="card">
          <h2 className="section-title">Preencher a partir do PDF do nesting (opcional)</h2>
          <p className="section-sub">
            Abra o PDF, selecione tudo (Ctrl+A), copie (Ctrl+C) e cole aqui. Se o nesting tiver mais de uma página, cole o texto de todas. O sistema
            preenche código, data, chapa, máquina e as peças (a coluna “Chapa” do PDF é a quantidade deste nesting).
          </p>
          <textarea className="textarea" style={{ minHeight: 90 }} value={pdfText} onChange={(e) => setPdfText(e.target.value)} aria-label="Texto copiado do PDF do nesting" />
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn secondary" onClick={() => void applyPdf()} disabled={pdfText.trim() === "" || pdfBusy}>
              {pdfBusy ? "Lendo..." : "Ler PDF e preencher"}
            </button>
          </div>
          {pdfMsg && (
            <div style={{ marginTop: 12 }}>
              <Notice kind={pdfMsg.kind} onClose={() => setPdfMsg(null)}>
                {pdfMsg.lines.map((l) => <div key={l}>{l}</div>)}
              </Notice>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="section-title">Dados do nesting</h2>
        <div className="form three" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="n-code">Código do programa * <span className="muted">(sequência L0001…)</span></label>
            <input id="n-code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="L0001" />
          </div>
          <div className="field">
            <label htmlFor="n-date">Data programada</label>
            <input id="n-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="n-mat">Material</label>
            <input id="n-mat" className="input" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex.: A36, Inox 304, A572" />
          </div>
          <div className="field">
            <label htmlFor="n-mat-code">Código do material</label>
            <input id="n-mat-code" className="input" value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} placeholder="Código MP (se houver)" />
          </div>
          <div className="field full">
            <label>Máquina de corte *</label>
            <div className="radio-cards" role="radiogroup" aria-label="Máquina de corte">
              {machines.map((m) => (
                <label key={m.id} className={machineId === m.id ? "radio-card selected" : "radio-card"}>
                  <input type="radio" name="machine" checked={machineId === m.id} onChange={() => setMachineId(m.id)} />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="n-thick">Espessura (mm){selected.length > 0 ? " — definida pelas peças" : ""}</label>
            <input id="n-thick" className="input" inputMode="decimal" value={thick} onChange={(e) => setThick(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="n-notes">Observações</label>
            <input id="n-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Peças neste nesting ({selected.length})</h2>
        <p className="section-sub">Pode misturar peças de várias listas, mas <strong>não pode misturar material nem espessura</strong>. O primeiro item selecionado define o grupo do nesting.</p>
        {selected.length > 0 && (
          <div className="notice success" style={{ marginBottom: 12 }}>
            <strong>Grupo do nesting:</strong> {materialCode || material || "material não informado"} · {groupThickness !== null ? `${formatQty(groupThickness)} mm` : "espessura não informada"}
          </div>
        )}
        {selected.length === 0 ? (
          <div className="empty">Nenhuma peça selecionada. Use a busca abaixo para adicionar (ou salve sem peças e vincule depois).</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Lista</th><th>OP</th><th>Item</th><th>Descrição</th><th className="num">Necessário</th><th className="num">Disponível</th><th>Qtd. neste nesting</th><th></th></tr>
                </thead>
                <tbody>
                  {selected.map((s) => {
                    const av = available(s.item);
                    const q = parseDecimalBR(s.qty).value;
                    const over = q !== null && q > av;
                    return (
                      <tr key={s.item.id} style={{ background: "var(--blue-50)" }}>
                        <td>{listLabel(s.item.list_code, s.item.list_name)}</td>
                        <td><strong>{s.item.op_number}</strong></td>
                        <td>{s.item.item_code ?? "—"}</td>
                        <td style={{ maxWidth: 240 }}>{s.item.description ?? "—"}</td>
                        <td className="num">{formatQty(s.item.qty_total)}</td>
                        <td className="num">{formatQty(av)}</td>
                        <td style={{ minWidth: 190 }}>
                          <input className={`input cell-input${over && !s.allowExcess ? " invalid" : ""}`} inputMode="decimal" value={s.qty} onChange={(e) => patch(s.item.id, { qty: e.target.value })} aria-label={`Quantidade da OP ${s.item.op_number}`} />
                          {over && (
                            <label className="checkbox cell-msg warn">
                              <input type="checkbox" checked={s.allowExcess} onChange={(e) => patch(s.item.id, { allowExcess: e.target.checked })} />
                              Permitir excedente (+{formatQty((q ?? 0) - av)})
                            </label>
                          )}
                        </td>
                        <td><button type="button" className="btn secondary small" onClick={() => remove(s.item.id)}>Remover</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="subtitle" style={{ marginTop: 12 }}>
              Total programado neste nesting: <strong>{formatQty(totalQty)}</strong> peça(s)
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Buscar peças</h2>
        <p className="section-sub">
          As peças são separadas por <strong>material + espessura</strong>. Depois que você selecionar a primeira peça, o sistema bloqueia automaticamente qualquer peça de outro grupo. Só aparecem peças de linhas de laser ({nestableLines.map((l) => l.name).join(", ") || "nenhuma habilitada"}).
        </p>
        <div className="toolbar">
          <div className="field grow">
            <label htmlFor="p-search">OP, código ou descrição</label>
            <input id="p-search" className="input" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="p-list">Lista</label>
            <select id="p-list" className="select" value={listFilter} onChange={(e) => { setListFilter(e.target.value); setPage(0); }}>
              <option value="">Todas</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{listLabel(l.code, l.name)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-line">Linha</label>
            <select id="p-line" className="select" value={lineFilter} onChange={(e) => { setLineFilter(e.target.value); setPage(0); }}>
              <option value="">Todas de laser</option>
              {nestableLines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <label className="checkbox" style={{ paddingBottom: 9 }}>
            <input type="checkbox" checked={onlyUnscheduled} onChange={(e) => { setOnlyUnscheduled(e.target.checked); setPage(0); }} />
            Só com saldo a programar
          </label>
          <button type="button" className="btn secondary" onClick={() => setAvulsoModal(true)} disabled={avulsoLists.length === 0} title={avulsoLists.length === 0 ? "Crie antes uma lista do tipo Avulsos" : undefined}>
            Cadastrar peça avulsa
          </button>
        </div>
        {avulsoLists.length === 0 && <p className="muted" style={{ marginBottom: 10 }}>Para peças sem OP ou fora de lista, crie uma lista do tipo <strong>Avulsos</strong> e cadastre a peça nela.</p>}
        {pickLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div className="empty">Nenhuma peça encontrada com esses filtros.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th></th><th>Lista</th><th>OP</th><th>Item</th><th>Descrição</th><th>Material</th><th>Esp.</th><th>Linha</th><th className="num">Necessário</th><th className="num" title="Já programado em outros nestings">Em outros</th><th className="num">Disponível</th></tr>
                </thead>
                <tbody>
                  {rows.map((i) => {
                    const picked = Boolean(sel[i.id]);
                    return (
                      <tr key={i.id}>
                        <td>
                          <button type="button" className="btn secondary small" disabled={picked || !itemMatchesNestingGroup(i)} onClick={() => add(i)}>
                            {picked ? "Adicionada" : itemMatchesNestingGroup(i) ? "Adicionar" : "Outro grupo"}
                          </button>
                        </td>
                        <td>{listLabel(i.list_code, i.list_name)}</td>
                        <td><strong>{i.op_number}</strong></td>
                        <td>{i.item_code ?? "—"}</td>
                        <td style={{ maxWidth: 240 }}>{i.description ?? "—"}</td>
                        <td>{i.material_code ?? i.material ?? "—"}</td>
                        <td>{i.thickness_mm !== null ? `${formatQty(i.thickness_mm)} mm` : "—"}</td>
                        <td>{i.line_name ?? "—"}</td>
                        <td className="num">{formatQty(i.qty_total)}</td>
                        <td className="num">{formatQty(i.qty_programmed - (own[i.id] ?? 0))}</td>
                        <td className="num">{formatQty(available(i))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={total} onPage={setPage} />
          </>
        )}
      </section>

      <div className="btn-row">
        <button className="btn primary" disabled={busy}>{busy ? "Salvando..." : nestingId ? "Salvar alterações" : "Salvar nesting"}</button>
        <button type="button" className="btn secondary" onClick={() => router.back()} disabled={busy}>Cancelar</button>
      </div>

    </form>

      {avulsoModal && (
        <ItemFormModal
          editing={null}
          lists={avulsoLists}
          lines={nestableLines.filter((l) => l.active)}
          defaultListId={avulsoLists[0]?.id}
          onClose={() => setAvulsoModal(false)}
          onSaved={() => {
            setAvulsoModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}
