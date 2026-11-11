"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loading, Notice, Pagination } from "./ui";
import { NESTING_CODE_REGEX } from "@/lib/constants";
import { errorText } from "@/lib/errors";
import { emptyToNull, formatQty, listLabel } from "@/lib/format";
import { parseDecimalBR } from "@/lib/excel-paste";
import { fetchItemsByIds, fetchItemsByOpCodes, fetchPickerDiagnostics, fetchThicknesses, searchItems, type ThicknessOption } from "@/lib/items";
import { pdfToText } from "@/lib/pdf-text";
import { formatMm } from "@/lib/thickness";
import { parseNestingText } from "@/lib/nesting-text";
import { fetchNesting, fetchNestingItems, fetchNextNestingCode, saveNesting, type NestingItemInput } from "@/lib/nestings";
import { fetchLaserMachines, fetchLines, fetchListOptions, type ListOption } from "@/lib/reference";
import type { ItemBalance, LaserMachine, ProductionLine } from "@/lib/types";
import { SHEET_MATERIAL_TYPES, classifyProductionMaterial, isMaterialCompatible, type SheetMaterialType } from "@/lib/sheet-materials";

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
  const [sheetMaterialType, setSheetMaterialType] = useState<SheetMaterialType | "">("");
  const [thick, setThick] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  const [own, setOwn] = useState<Record<string, number>>({}); // já programado NESTE nesting (edição)
  const [sel, setSel] = useState<Record<string, Selected>>({});
  const [manualItems, setManualItems] = useState<Array<{ op_number: string; equipment_name: string; description: string; material: string; thickness_mm: string; quantity: string }>>([]);
  const [manualDraft, setManualDraft] = useState({ op_number: "", equipment_name: "", description: "", material: "", thickness_mm: "", quantity: "1" });

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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // importação do texto do PDF do nesting
  const [pdfText, setPdfText] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [thicknessOptions, setThicknessOptions] = useState<ThicknessOption[]>([]);
  const [diag, setDiag] = useState("");
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
          setSheetMaterialType((n.sheet_material_type ?? "") as SheetMaterialType | "");
          setThick(n.thickness_mm !== null ? String(Number(n.thickness_mm)) : "");
          setDate(n.programmed_at ?? "");
          setNotes(n.notes ?? "");
          const manual = its.filter((i) => !i.production_order_id);
          setManualItems(manual.map((i) => ({ op_number: i.op_number ?? "", equipment_name: i.equipment_name ?? "", description: i.description ?? "", material: i.material ?? "", thickness_mm: String(i.thickness_mm ?? ""), quantity: toText(i.quantity_programmed) })));
          const snapshots = await fetchItemsByIds(its.filter((i) => i.production_order_id).map((i) => i.production_order_id!));
          if (cancelled) return;
          const byId = new Map(snapshots.map((s) => [s.id, s]));
          const ownMap: Record<string, number> = {};
          const selMap: Record<string, Selected> = {};
          its.forEach((i) => {
            if (!i.production_order_id) return;
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

  // Espessuras que existem entre as peças de laser com saldo a programar
  useEffect(() => {
    if (!ready) return;
    fetchThicknesses({ onlyNestable: true, onlyPending: true })
      .then(setThicknessOptions)
      .catch((e) => setError(errorText(e)));
  }, [ready, refreshKey]);

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
    searchItems({ listId: listFilter, lineId: lineFilter, status: "", search, showArchived: false, onlyNestable: true, onlyUnscheduled, thickness: thick }, page)
      .then(async (r) => {
        if (cancelled) return;
        setRows(r.rows);
        setTotal(r.total);
        setDiag(r.rows.length === 0 ? await fetchPickerDiagnostics() : "");
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
  }, [ready, listFilter, lineFilter, search, onlyUnscheduled, thick, page, refreshKey]);

  const available = useCallback((i: ItemBalance) => Math.max(0, i.qty_total - (i.qty_programmed - (own[i.id] ?? 0))), [own]);

  function add(i: ItemBalance) {
    setSel((prev) => {
      if (prev[i.id]) return prev;
      const av = available(i);
      return { ...prev, [i.id]: { item: i, qty: av > 0 ? toText(av) : "", allowExcess: false } };
    });
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
  async function applyPdf(text: string = pdfText) {
    setPdfMsg(null);
    const r = parseNestingText(text);
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
      const inferredSheetType = classifyProductionMaterial(r.material);
      const effectiveSheetType = sheetMaterialType || inferredSheetType || "";
      if (inferredSheetType) {
        if (sheetMaterialType && sheetMaterialType !== inferredSheetType) lines.push("O material identificado no PDF difere do tipo selecionado. Mantive sua seleção; confira antes de salvar.");
        else setSheetMaterialType(inferredSheetType);
      }
      if (r.thickness_mm !== null) setThick(String(r.thickness_mm));
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
      const mismatch: string[] = [];
      for (const p of r.parts) {
        const item = byKey.get(`${p.op_number}|${p.item_code.toUpperCase()}`);
        if (!item) missing.push(`OP ${p.op_number} / ${p.item_code} (${p.equipment})`);
        else if (!item.line_allows_nesting) blocked.push(`OP ${p.op_number} / ${p.item_code} (linha ${item.line_name ?? "?"})`);
        else if (!isMaterialCompatible(effectiveSheetType, item.material)) blocked.push(`OP ${p.op_number} / ${p.item_code} (material incompatível com a chapa)`);
        else {
          toAdd[item.id] = { item, qty: toText(p.quantity), allowExcess: false };
          if (r.thickness_mm !== null && item.thickness_mm !== null && Math.abs(Number(item.thickness_mm) - r.thickness_mm) > 0.05) {
            mismatch.push(`OP ${p.op_number} / ${p.item_code} (${formatMm(Number(item.thickness_mm))} no cadastro, ${formatMm(r.thickness_mm)} no PDF)`);
          }
        }
      }
      setSel((prev) => ({ ...prev, ...toAdd }));
      lines.unshift(`${Object.keys(toAdd).length} peça(s) adicionada(s) de ${r.parts.length} no PDF. Confira as quantidades abaixo.`);
      if (missing.length > 0) lines.push(`Não cadastradas no sistema (importe a lista correspondente e aplique de novo): ${missing.join("; ")}.`);
      if (blocked.length > 0) lines.push(`Peças bloqueadas por linha ou material incompatível: ${blocked.join("; ")}.`);
      if (mismatch.length > 0) lines.push(`Espessura diferente da chapa do PDF: ${mismatch.join("; ")}.`);
      r.skipped.forEach((s) => lines.push(`Ignorada: ${s}.`));
      r.warnings.forEach((w) => lines.push(w));
      setPdfMsg({ kind: missing.length > 0 || blocked.length > 0 || mismatch.length > 0 || !guess ? "warning" : "success", lines });
    } catch (e) {
      setPdfMsg({ kind: "error", lines: [errorText(e)] });
    } finally {
      setPdfBusy(false);
    }
  }

  /** Lê o(s) arquivo(s) PDF escolhidos (várias páginas ou vários arquivos do mesmo nesting) e preenche o formulário. */
  async function onPdfFiles(files: File[]) {
    if (files.length === 0) return;
    setPdfBusy(true);
    setPdfMsg(null);
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
      let text = "";
      for (const f of files) text += (await pdfToText(pdfjs, new Uint8Array(await f.arrayBuffer()))) + "\n";
      setPdfText(text);
      await applyPdf(text);
    } catch (e) {
      setPdfMsg({ kind: "error", lines: [`Não foi possível ler o PDF: ${errorText(e)}`] });
    } finally {
      setPdfBusy(false);
    }
  }

  const selected = Object.values(sel);
  const totalQty = selected.reduce((sum, s) => sum + (parseDecimalBR(s.qty).value ?? 0), 0);
  const nestableLines = lines.filter((l) => l.allows_nesting);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!NESTING_CODE_REGEX.test(code.trim().toUpperCase())) return setError("Código inválido. Use a sequência L0001, L0002... (letra L e 4 ou mais dígitos).");
    if (!machineId) return setError("Selecione a máquina de corte.");
    if (!sheetMaterialType) return setError("Selecione o tipo da chapa.");
    let t: number | null = null;
    if (thick.trim() !== "") {
      t = Number(thick);
      if (!Number.isFinite(t) || t <= 0) return setError("A espessura deve ser um número válido.");
    }
    const payload: NestingItemInput[] = [];
    for (const s of selected) {
      if (!isMaterialCompatible(sheetMaterialType, s.item.material)) return setError(`A OP ${s.item.op_number} possui material incompatível ou não identificado para a chapa selecionada.`);
      const q = parseDecimalBR(s.qty).value;
      const av = available(s.item);
      if (q === null || q <= 0) return setError(`Informe uma quantidade maior que zero para a OP ${s.item.op_number}.`);
      if (q > av && !s.allowExcess) {
        return setError(`A OP ${s.item.op_number} passaria do necessário (disponível: ${formatQty(av)}). Reduza a quantidade ou marque “Permitir excedente”.`);
      }
      payload.push({ production_order_id: s.item.id, quantity_programmed: q, notes: null, allow_excess: s.allowExcess && q > av });
    }
    for (const item of manualItems) {
      const qty = parseDecimalBR(item.quantity).value;
      const thickness = parseDecimalBR(item.thickness_mm).value;
      if (!item.op_number.trim() || !item.equipment_name.trim() || !item.description.trim() || !item.material.trim() || thickness === null || thickness <= 0 || qty === null || qty <= 0) {
        return setError("Preencha OP, equipamento, descrição, material, espessura e quantidade válida da peça avulsa.");
      }
      if (!isMaterialCompatible(sheetMaterialType, item.material)) return setError(`A peça avulsa ${item.op_number} possui material incompatível com a chapa selecionada.`);
      if (t !== null && Math.abs(t - thickness) > 0.0001) return setError(`A peça avulsa ${item.op_number} possui espessura diferente da chapa do nesting.`);
      t = thickness;
      payload.push({ production_order_id: null, op_number: item.op_number.trim(), equipment_name: item.equipment_name.trim(), description: item.description.trim(), material: item.material.trim(), thickness_mm: thickness, quantity_programmed: qty, notes: null, allow_excess: false });
    }
    setBusy(true);
    try {
      const id = await saveNesting({
        id: nestingId ?? null,
        code: code.trim(),
        laser_machine_id: machineId,
        material: emptyToNull(material),
        sheet_material_type: sheetMaterialType,
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
            Escolha o(s) <strong>arquivo(s) PDF</strong> do nesting (se tiver mais de uma página ou arquivo, selecione todos de uma vez) <strong>ou cole o texto</strong> copiado do PDF. O sistema lê a tabela
            e preenche código, data, chapa, espessura, máquina e as peças (a coluna “Chapa” do PDF é a quantidade deste nesting).
          </p>
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={pdfBusy}
            aria-label="Arquivos PDF do nesting"
            onChange={(e) => {
              const files = Array.from((e.target.files ?? []) as ArrayLike<File>);
              e.target.value = "";
              void onPdfFiles(files);
            }}
          />
          {pdfBusy && <p className="muted" style={{ marginTop: 8 }}>Lendo o PDF...</p>}
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="pdf-text">Ou cole o texto copiado do PDF (Ctrl+A, Ctrl+C no PDF; se tiver mais de uma página, cole todas em sequência)</label>
            <textarea
              id="pdf-text"
              className="textarea"
              style={{ minHeight: 90 }}
              value={pdfText}
              onChange={(e) => setPdfText(e.target.value)}
              onPaste={(e) => {
                // ao colar, já preenche o formulário
                const pasted = e.clipboardData.getData("text");
                if (pasted.trim() !== "") {
                  e.preventDefault();
                  const all = pdfText.trim() === "" ? pasted : `${pdfText}\n${pasted}`;
                  setPdfText(all);
                  void applyPdf(all);
                }
              }}
              aria-label="Texto copiado do PDF do nesting"
            />
            <div className="btn-row">
              <button type="button" className="btn secondary" onClick={() => void applyPdf()} disabled={pdfText.trim() === "" || pdfBusy}>
                Ler texto e preencher
              </button>
              <button type="button" className="btn secondary" onClick={() => { setPdfText(""); setPdfMsg(null); }} disabled={pdfBusy}>
                Limpar texto
              </button>
            </div>
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
            <label htmlFor="n-sheet-type">Tipo da chapa *</label>
            <select id="n-sheet-type" className="select" value={sheetMaterialType} onChange={(e) => setSheetMaterialType(e.target.value as SheetMaterialType | "")}>
              <option value="">Selecione o tipo</option>
              {SHEET_MATERIAL_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="n-mat">Descrição da chapa</label>
            <input id="n-mat" className="input" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder='Ex.: 1/2", LNE-38, 16 Galv.' />
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
            <label htmlFor="n-thick">Espessura da chapa (mm)</label>
            <select id="n-thick" className="select" value={thick} onChange={(e) => { setThick(e.target.value); setPage(0); }}>
              <option value="">Todas (sem filtro)</option>
              {thicknessOptions
                .filter((o) => o.thickness_mm !== null)
                .map((o) => (
                  <option key={o.thickness_mm} value={String(Number(o.thickness_mm))}>
                    {formatMm(Number(o.thickness_mm))} ({o.items} peça(s))
                  </option>
                ))}
              {thick !== "" && !thicknessOptions.some((o) => o.thickness_mm !== null && String(Number(o.thickness_mm)) === thick) && (
                <option value={thick}>{formatMm(Number(thick))} (sem peças com saldo)</option>
              )}
            </select>
            <span className="hint">Ao escolher, a busca de peças mostra só peças dessa espessura.</span>
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="n-notes">Observações</label>
            <input id="n-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Peças neste nesting ({selected.length + manualItems.length})</h2>
        <p className="section-sub">Pode misturar peças de várias listas. Informe quantas peças de cada OP serão cortadas aqui.</p>
        {selected.length === 0 ? (
          <div className="empty">Nenhuma peça selecionada. Use a busca abaixo para adicionar (ou salve sem peças e vincule depois).</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Lista</th><th>OP</th><th>Item</th><th>Matéria-prima</th><th>Espessura</th><th className="num">Necessário</th><th className="num">Disponível</th><th>Qtd. neste nesting</th><th></th></tr>
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
                        <td style={{ maxWidth: 240 }} className="muted">{s.item.material ?? s.item.description ?? "—"}</td>
                        <td>
                          {formatMm(s.item.thickness_mm)}
                          {thick !== "" && s.item.thickness_mm !== null && Math.abs(Number(s.item.thickness_mm) - Number(thick)) > 0.05 && (
                            <div><span className="pill amber" title="Espessura da peça diferente da espessura do nesting">≠ nesting</span></div>
                          )}
                        </td>
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
        <h2 className="section-title">Peças avulsas</h2>
        <p className="section-sub">Adicione uma OP que ainda não está cadastrada em uma lista de produção.</p>
        <div className="form three">
          <div className="field"><label>OP *</label><input className="input" value={manualDraft.op_number} onChange={(e) => setManualDraft((v) => ({ ...v, op_number: e.target.value }))} placeholder="Ex.: 7.604.497" /></div>
          <div className="field"><label>Equipamento *</label><input className="input" value={manualDraft.equipment_name} onChange={(e) => setManualDraft((v) => ({ ...v, equipment_name: e.target.value }))} /></div>
          <div className="field"><label>Descrição da peça *</label><input className="input" value={manualDraft.description} onChange={(e) => setManualDraft((v) => ({ ...v, description: e.target.value }))} /></div>
          <div className="field"><label>Material *</label><select className="select" value={manualDraft.material} onChange={(e) => setManualDraft((v) => ({ ...v, material: e.target.value }))}><option value="">Selecione</option>{SHEET_MATERIAL_TYPES.map((m) => <option key={m.value} value={m.label}>{m.label}</option>)}</select></div>
          <div className="field"><label>Espessura (mm) *</label><input className="input" inputMode="decimal" value={manualDraft.thickness_mm} onChange={(e) => setManualDraft((v) => ({ ...v, thickness_mm: e.target.value }))} /></div>
          <div className="field"><label>Quantidade *</label><input className="input" inputMode="decimal" value={manualDraft.quantity} onChange={(e) => setManualDraft((v) => ({ ...v, quantity: e.target.value }))} /></div>
        </div>
        <div className="btn-row"><button type="button" className="btn secondary" onClick={() => {
          const qty = parseDecimalBR(manualDraft.quantity).value;
          const thickness = parseDecimalBR(manualDraft.thickness_mm).value;
          if (!manualDraft.op_number.trim() || !manualDraft.equipment_name.trim() || !manualDraft.description.trim() || !manualDraft.material || qty === null || qty <= 0 || thickness === null || thickness <= 0) { setError("Preencha todos os campos da peça avulsa com valores válidos."); return; }
          if (!isMaterialCompatible(sheetMaterialType, manualDraft.material)) { setError("O material da peça avulsa não é compatível com o tipo de chapa do nesting."); return; }
          if (thick && Math.abs(Number(thick) - thickness) > 0.0001) { setError("A espessura da peça avulsa deve ser igual à espessura do nesting."); return; }
          setManualItems((items) => [...items, manualDraft]);
          if (!thick) setThick(String(thickness));
          setManualDraft({ op_number: "", equipment_name: "", description: "", material: "", thickness_mm: String(thickness), quantity: "1" });
          setError("");
        }}>Adicionar peça avulsa</button></div>
        {manualItems.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>OP</th><th>Equipamento</th><th>Descrição</th><th>Material</th><th>Espessura</th><th>Qtd.</th><th></th></tr></thead><tbody>{manualItems.map((item, index) => <tr key={`${item.op_number}-${index}`}><td>{item.op_number}</td><td>{item.equipment_name}</td><td>{item.description}</td><td>{item.material}</td><td>{item.thickness_mm} mm</td><td>{item.quantity}</td><td><button type="button" className="btn secondary small" onClick={() => setManualItems((items) => items.filter((_, i) => i !== index))}>Remover</button></td></tr>)}</tbody></table></div>}
      </section>

      <section className="card">
        <h2 className="section-title">Buscar peças</h2>
        <p className="section-sub">
          Só aparecem peças de linhas de laser ({nestableLines.map((l) => l.name).join(", ") || "nenhuma habilitada"}).
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
        </div>
        {pickLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div className="empty">
            Nenhuma peça encontrada com esses filtros.
            {diag && <div className="muted" style={{ marginTop: 8 }}>{diag}</div>}
            <div className="muted">Se “linhas de laser ativas” for 0, habilite a linha em Setores e linhas. Se “itens em linhas de laser” for 0, importe a lista (e o catálogo de itens) antes.</div>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th></th><th>Lista</th><th>OP</th><th>Item</th><th>Matéria-prima</th><th>Espessura</th><th>Linha</th><th className="num">Necessário</th><th className="num" title="Já programado em outros nestings">Em outros</th><th className="num">Disponível</th></tr>
                </thead>
                <tbody>
                  {rows.map((i) => {
                    const picked = Boolean(sel[i.id]);
                    const compatible = isMaterialCompatible(sheetMaterialType, i.material);
                    return (
                      <tr key={i.id}>
                        <td>
                          <button type="button" className="btn secondary small" disabled={picked || !compatible} onClick={() => add(i)}>
                            {picked ? "Adicionada" : compatible ? "Adicionar" : "Material incompatível"}
                          </button>
                        </td>
                        <td>{listLabel(i.list_code, i.list_name)}</td>
                        <td><strong>{i.op_number}</strong></td>
                        <td>{i.item_code ?? "—"}</td>
                        <td style={{ maxWidth: 240 }} className="muted">{i.material ?? i.description ?? "—"}</td>
                        <td className="nowrap">{formatMm(i.thickness_mm)}</td>
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
    </>
  );
}
