"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { BackLink, Loading, Notice } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { PASTE_COLUMNS, findRepeatedInPaste, itemKey, parsePaste, validateFields, type ParsedRow } from "@/lib/excel-paste";
import { listLabel } from "@/lib/format";
import { fetchExistingKeys, importItemsErp, resolveLines } from "@/lib/items";
import { fetchErpCodes, fetchLines, fetchListOptions, type ListOption } from "@/lib/reference";
import type { ProductionLine, ResolvedLine } from "@/lib/types";

const EXAMPLE = "7446970\t2\t1128028\tCH. GUIA LATERAL INT.\t20100072\t3,5\tKG\tCHAPA 3/8 LNE-38";
const MAX_VISIBLE = 300;

type Field = "op_number" | "quantity_text" | "item_code" | "description";
type View = "pronta" | "erro" | "duplicada" | "sem_linha" | "todas";

function ColarContent() {
  const { canPlan } = useAuth();
  const params = useSearchParams();
  const [lists, setLists] = useState<ListOption[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [erpLine, setErpLine] = useState<Map<number, string | null>>(new Map());
  const [pasteInfo, setPasteInfo] = useState<{ headerFound: boolean; ignored: number } | null>(null);
  const [listId, setListId] = useState(params.get("lista") ?? "");
  const [defaultLineId, setDefaultLineId] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [resolved, setResolved] = useState<Map<string, ResolvedLine>>(new Map());
  const [previewDone, setPreviewDone] = useState(false);
  const [noTab, setNoTab] = useState(false);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [skipDup, setSkipDup] = useState(true);
  const [view, setView] = useState<View>("pronta");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([fetchListOptions(false), fetchLines(true), fetchErpCodes()])
      .then(([l, ln, erp]) => {
        setLists(l);
        setLines(ln);
        setErpLine(new Map(erp.map((e) => [e.code, e.line_id])));
      })
      .catch((e) => setMsg({ kind: "error", text: errorText(e) }));
  }, []);

  // Chaves já cadastradas na lista, para avisar duplicidade na prévia
  useEffect(() => {
    if (!listId) {
      setExisting(new Set());
      return;
    }
    let cancelled = false;
    fetchExistingKeys(listId)
      .then((k) => {
        if (!cancelled) setExisting(k);
      })
      .catch((e) => {
        if (!cancelled) setMsg({ kind: "error", text: errorText(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const defaultLine = lines.find((l) => l.id === defaultLineId) ?? null;
  const repeated = useMemo(() => findRepeatedInPaste(rows), [rows]);

  const info = useMemo(
    () =>
      rows.map((r, idx) => {
        // 1) coluna "Linha" da planilha (código ERP conhecido)  2) catálogo  3) linha padrão
        let lineName: string | null = null;
        let explicit = false;
        if (r.erp_line_code !== null && erpLine.has(r.erp_line_code)) {
          explicit = true;
          const lid = erpLine.get(r.erp_line_code);
          lineName = lines.find((l) => l.id === lid)?.name ?? null;
        }
        if (!explicit) lineName = resolved.get(r.item_code.trim().toUpperCase())?.line_name ?? null;
        if (!lineName && defaultLine) lineName = defaultLine.name;
        const hasLine = lineName !== null;
        const inDb = existing.has(itemKey(r.op_number, r.item_code, r.material_code));
        const dup = r.errors.length === 0 && hasLine && (inDb || repeated.has(idx));
        const state: View = r.errors.length ? "erro" : !hasLine ? "sem_linha" : dup ? "duplicada" : "pronta";
        return { lineName, hasLine, inDb, repeatedInPaste: repeated.has(idx), dup, state };
      }),
    [rows, resolved, existing, repeated, defaultLine, erpLine, lines],
  );

  const count = (s: View) => info.filter((i) => i.state === s).length;
  const toImport = rows.filter((r, i) => r.errors.length === 0 && info[i]?.hasLine);

  const shown = rows
    .map((r, idx) => ({ r, idx }))
    .filter(({ idx }) => view === "todas" || info[idx]?.state === view)
    .slice(0, MAX_VISIBLE);
  const totalInView = view === "todas" ? rows.length : count(view);

  async function generatePreview() {
    setMsg(null);
    setBusy(true);
    try {
      const res = parsePaste(text);
      setRows(res.rows);
      setNoTab(res.noTabFound);
      setPasteInfo({ headerFound: res.headerFound, ignored: res.ignoredAboveHeader });
      setPreviewDone(true);
      setView("pronta");
      if (res.rows.length === 0) {
        setMsg({ kind: "warning", text: "Nenhuma linha encontrada. Cole as células copiadas do Excel." });
        return;
      }
      setResolved(await resolveLines(res.rows.map((r) => r.item_code)));
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  function editCell(idx: number, field: Field, value: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, [field]: value };
        const v = validateFields(next);
        return { ...next, quantity: v.quantity, material_qty: v.material_qty, errors: v.errors, warnings: v.warnings };
      }),
    );
  }

  /** Ao corrigir o código do item, descobre a linha do novo código. */
  async function reResolve(code: string) {
    try {
      const m = await resolveLines([code]);
      setResolved((prev) => new Map([...prev, ...m]));
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    }
  }

  async function confirmImport() {
    if (!listId) return setMsg({ kind: "error", text: "Selecione a lista de destino." });
    if (toImport.length === 0) return setMsg({ kind: "error", text: "Não há linhas prontas para importar." });
    setBusy(true);
    setMsg(null);
    try {
      const result = await importItemsErp(
        listId,
        toImport.map((r) => ({
          row: r.line,
          op_number: r.op_number,
          quantity: r.quantity as number,
          item_code: r.item_code,
          description: r.description,
          material_code: r.material_code,
          material_qty: r.material_qty,
          material_unit: r.material_unit,
          material: r.material,
          item_unit: r.item_unit,
          erp_line_code: r.erp_line_code,
        })),
        defaultLineId || null,
        skipDup,
      );
      const serverErrors = new Map(result.errors.map((e) => [e.row, e.message]));
      const clientErrors = count("erro");
      const noLine = count("sem_linha");
      // Mantém na tela só o que NÃO foi salvo por erro, para corrigir
      setRows((prev) =>
        prev
          .filter((r) => r.errors.length > 0 || serverErrors.has(r.line))
          .map((r) => (serverErrors.has(r.line) ? { ...r, errors: [serverErrors.get(r.line) as string] } : r)),
      );
      const totalErrors = clientErrors + result.errors.length;
      const parts = [`${result.inserted} item(ns) inserido(s)`];
      if (result.duplicates > 0) parts.push(`${result.duplicates} duplicado(s) ignorado(s)`);
      if (noLine > 0) parts.push(`${noLine} sem linha de fabricação ignorado(s)`);
      parts.push(`${totalErrors} com erro (não inseridos)`);
      setMsg({ kind: totalErrors > 0 ? "warning" : "success", text: parts.join(" · ") + "." });
      setView("erro");
      if (totalErrors === 0) {
        setText("");
        setPreviewDone(false);
        setRows([]);
      }
      setExisting(await fetchExistingKeys(listId));
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!canPlan) {
    return (
      <main className="content">
        <BackLink href="/ops">Voltar</BackLink>
        <Notice kind="warning">Seu perfil não permite cadastrar itens.</Notice>
      </main>
    );
  }

  const viewTabs: { v: View; label: string; n: number; cls: string }[] = [
    { v: "pronta", label: "Prontas", n: count("pronta"), cls: "green" },
    { v: "duplicada", label: "Duplicadas", n: count("duplicada"), cls: "amber" },
    { v: "erro", label: "Com erro", n: count("erro"), cls: "red" },
    { v: "sem_linha", label: "Sem linha de fabricação", n: count("sem_linha"), cls: "gray" },
  ];

  return (
    <main className="content">
      <BackLink href="/ops">Voltar para OPs e peças</BackLink>
      <div className="heading">
        <div>
          <div className="eyebrow">PCP / Planejamento</div>
          <h1>Colar dados do ERP / Excel</h1>
          <p className="subtitle">Cole as colunas da aba DADOS. A linha de produção é descoberta pelo código do item (catálogo).</p>
        </div>
      </div>

      {msg && (
        <Notice kind={msg.kind} onClose={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}

      <div className="stack">
        <section className="card">
          <h2 className="section-title">1. Destino</h2>
          <div className="form" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="c-list">Lista de produção *</label>
              <select id="c-list" className="select" value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">Selecione...</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {listLabel(l.code, l.name)} ({l.list_type})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-line">Linha para itens fora do catálogo (opcional)</label>
              <select id="c-line" className="select" value={defaultLineId} onChange={(e) => setDefaultLineId(e.target.value)}>
                <option value="">Ignorar itens sem linha (padrão)</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    Usar {l.name}
                  </option>
                ))}
              </select>
              <span className="hint">Itens comprados/conjuntos não têm linha e são ignorados. Em listas Leniors ou Avulsos você pode escolher uma linha para todos.</span>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">2. Cole as linhas</h2>
          <p className="section-sub">
            <strong>Recomendado:</strong> cole <strong>com a linha de cabeçalho</strong> (OP, Qtde, Código…): o sistema localiza as colunas pelo nome e funciona com as variações das planilhas (com ou sem “Und” após a Qtde, com “Linha”/“Fabricação”). Sem cabeçalho, vale esta ordem:
          </p>
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  {PASTE_COLUMNS.map((c, i) => (
                    <th key={c}>{i + 1}. {c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>obrigatória</td><td>obrigatória, &gt; 0</td><td>obrigatório</td><td>opcional</td><td>opcional</td><td>opcional</td><td>opcional</td><td>opcional</td>
                </tr>
              </tbody>
            </table>
          </div>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} aria-label="Dados colados do Excel" />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => void generatePreview()} disabled={text.trim() === "" || busy}>
              {busy && !previewDone ? "Analisando..." : "Gerar prévia"}
            </button>
            <button className="btn secondary" onClick={() => { setText(""); setRows([]); setPreviewDone(false); setMsg(null); }}>
              Limpar
            </button>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            A linha de cada item vem da coluna “Linha” da planilha (se colada) ou do catálogo. Duplicidade: mesma lista + OP + Código do item + Código MP. A mesma OP e item com matéria-prima diferente NÃO é duplicada. Linhas vazias e valores “#N/A” são tratados como vazios.
          </p>
        </section>

        {previewDone && rows.length > 0 && (
          <section className="card">
            <h2 className="section-title">3. Confira e confirme</h2>
            {noTab && <Notice kind="warning">Nenhuma tabulação encontrada. Copie as células direto do Excel.</Notice>}
            {pasteInfo?.headerFound ? (
              <Notice kind="info">Cabeçalho reconhecido: colunas localizadas pelo nome{pasteInfo.ignored > 0 ? ` (${pasteInfo.ignored} linha(s) acima do cabeçalho ignorada(s))` : ""}. Se a coluna “Linha” veio preenchida, ela define a linha do item.</Notice>
            ) : (
              <Notice kind="warning">Sem cabeçalho: usando a ordem padrão de 8 colunas. Confira a prévia.</Notice>
            )}
            <div className="btn-row" style={{ marginBottom: 12 }}>
              {viewTabs.map((t) => (
                <button key={t.v} className={view === t.v ? `pill ${t.cls}` : "pill gray"} style={{ border: 0, cursor: "pointer", fontSize: 12, padding: "6px 12px" }} onClick={() => setView(t.v)}>
                  {t.label}: {t.n}
                </button>
              ))}
              <label className="checkbox" style={{ marginLeft: "auto" }}>
                <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} />
                Ignorar duplicadas
              </label>
            </div>
            {count("erro") > 0 && (
              <Notice kind="error">
                {count("erro")} linha(s) com erro <strong>não serão importadas</strong>. Corrija nos campos (aba “Com erro”) ou remova a linha.
              </Notice>
            )}
            {count("sem_linha") > 0 && (
              <Notice kind="info">
                {count("sem_linha")} linha(s) não têm linha de fabricação no catálogo (itens comprados, conjuntos ou ainda não cadastrados) e <strong>serão ignoradas</strong>. Se algum item deveria ter linha, atualize o <Link className="link" href="/catalogo">catálogo de itens</Link>.
              </Notice>
            )}
            {shown.length === 0 ? (
              <div className="empty">Nenhuma linha nesta aba.</div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr><th>Linha</th><th>OP</th><th>Qtde</th><th>Código</th><th>Descrição</th><th>Matéria-prima</th><th>Linha de produção</th><th>Situação</th><th></th></tr>
                  </thead>
                  <tbody>
                    {shown.map(({ r, idx }) => {
                      const i = info[idx];
                      const cls = r.errors.length ? "row-error" : i.dup ? "row-dup" : "";
                      const cell = (f: Field, w: number) => (
                        <input
                          className={`input cell-input${r.errors.length ? " invalid" : ""}`}
                          style={{ minWidth: w }}
                          value={r[f]}
                          onChange={(e) => editCell(idx, f, e.target.value)}
                          onBlur={f === "item_code" ? (e) => void reResolve(e.target.value) : undefined}
                          aria-label={f}
                        />
                      );
                      return (
                        <tr key={`${r.line}-${idx}`} className={cls}>
                          <td>{r.line}</td>
                          <td>{cell("op_number", 90)}</td>
                          <td>{cell("quantity_text", 60)}</td>
                          <td>{cell("item_code", 100)}</td>
                          <td>{cell("description", 200)}</td>
                          <td className="muted" style={{ maxWidth: 200 }}>{r.material_code}{r.material ? ` · ${r.material}` : ""}</td>
                          <td>{i.lineName ?? <span className="pill gray">Sem linha</span>}</td>
                          <td style={{ minWidth: 200 }}>
                            {r.errors.map((e) => <div key={e} className="cell-msg err">{e}</div>)}
                            {r.warnings.map((w) => <div key={w} className="cell-msg warn">{w}</div>)}
                            {r.errors.length === 0 && i.dup && <span className="pill amber">{i.inDb ? "Já cadastrada" : "Repetida na colagem"}</span>}
                            {r.errors.length === 0 && !i.dup && i.hasLine && r.warnings.length === 0 && <span className="pill green">OK</span>}
                          </td>
                          <td>
                            <button className="icon-btn" onClick={() => setRows((prev) => prev.filter((_, k) => k !== idx))} aria-label="Remover linha" title="Remover linha">
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {totalInView > MAX_VISIBLE && <p className="muted" style={{ marginTop: 8 }}>Mostrando {MAX_VISIBLE} de {totalInView} linhas desta aba (todas serão consideradas na importação).</p>}
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => void confirmImport()} disabled={busy || toImport.length === 0 || !listId}>
                {busy ? "Importando..." : `Confirmar cadastro de ${toImport.length} linha(s)`}
              </button>
              {!listId && <span className="muted">Selecione a lista no passo 1.</span>}
            </div>
          </section>
        )}
      </div>
      <p className="muted" style={{ marginTop: 16 }}>
        Depois de importar, veja os itens em <Link className="link" href={listId ? `/ops?lista=${listId}` : "/ops"}>OPs e peças</Link>.
      </p>
    </main>
  );
}

export default function ColarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ColarContent />
    </Suspense>
  );
}
