"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, ListChecks, Search, Truck } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmModal } from "@/components/Modal";
import { EmptyState, Notice, StatusPill } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { parseDecimalBR } from "@/lib/excel-paste";
import { formatDate, formatQty, listLabel } from "@/lib/format";
import {
  fetchItemsByOpNumber,
  fetchFabricatedOpGroups,
  fetchProductionDelivery,
  fetchProductionScrapReports,
  recordProductionDelivery,
  recordProductionScrap,
  type ProductionDelivery,
  type ProductionScrapReport,
  type FabricatedOpGroup,
} from "@/lib/delivery";
import { fetchItemProcessSteps, type ItemProcessStep } from "@/lib/progress";
import { fetchListOptions } from "@/lib/reference";
import type { ItemBalance } from "@/lib/types";

type BarcodeReader = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type BarcodeReaderConstructor = new (options: { formats: string[] }) => BarcodeReader;
type WindowWithBarcodeReader = Window & { BarcodeDetector?: BarcodeReaderConstructor };

export function QrOpScanner({ onScan }: { onScan: (opNumber: string) => Promise<boolean> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [opNumber, setOpNumber] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!cameraOpen) return;
    let active = true;
    let stream: MediaStream | null = null;
    let videoElement: HTMLVideoElement | null = null;
    let frame = 0;
    let detecting = false;

    async function start() {
      try {
        const Detector = (window as WindowWithBarcodeReader).BarcodeDetector;
        if (!Detector) {
          setCameraError("A leitura pela câmera não está disponível neste navegador. Use um leitor QR conectado ou digite o número da OP.");
          setCameraOpen(false);
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("A câmera não está disponível neste dispositivo.");
        const detector = new Detector({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const video = videoRef.current;
        videoElement = video;
        if (!video || !active) return;
        video.srcObject = stream;
        await video.play();
        const scan = async () => {
          if (!active || !videoRef.current) return;
          if (!detecting && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            detecting = true;
            try {
              const codes = await detector.detect(video);
              if (active && codes[0]?.rawValue) {
                active = false;
                setCameraOpen(false);
                void onScanRef.current(codes[0].rawValue.trim());
                return;
              }
            } catch {
              // Frames without a readable QR are expected while the camera is moving.
            } finally {
              detecting = false;
            }
          }
          if (active) frame = requestAnimationFrame(() => void scan());
        };
        frame = requestAnimationFrame(() => void scan());
      } catch (e) {
        setCameraError(errorText(e));
        setCameraOpen(false);
      }
    }

    void start();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoElement) videoElement.srcObject = null;
    };
  }, [cameraOpen]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = opNumber.trim();
    if (!value) return;
    setBusy(true);
    setCameraError("");
    try {
      if (await onScan(value)) setOpNumber("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <h2 className="section-title">Ler OP pelo QR code</h2>
      <p className="section-sub">Aponte a câmera ou use um leitor conectado. O código é procurado exatamente como está impresso, incluindo os pontos.</p>
      <form className="btn-row" onSubmit={(e) => void submit(e)}>
        <div className="field grow" style={{ minWidth: 220 }}>
          <label htmlFor="op-qr-number">Número da OP</label>
          <input id="op-qr-number" className="input" autoFocus value={opNumber} onChange={(e) => setOpNumber(e.target.value)} placeholder="Ex.: 180.085 ou 7.500.200" autoComplete="off" />
        </div>
        <button className="btn primary" type="submit" disabled={!opNumber.trim() || busy} style={{ alignSelf: "end" }}>
          <Search size={14} /> {busy ? "Buscando..." : "Buscar OP"}
        </button>
        <button className="btn secondary" type="button" onClick={() => { setCameraError(""); setCameraOpen(true); }} style={{ alignSelf: "end" }}>
          <Camera size={14} /> Abrir câmera
        </button>
      </form>
      {cameraError && <Notice kind="warning" onClose={() => setCameraError("")}>{cameraError}</Notice>}
      {cameraOpen && <video ref={videoRef} autoPlay muted playsInline style={{ display: "block", marginTop: 12, width: "min(100%, 480px)", borderRadius: 10, background: "#111" }} aria-label="Visualização da câmera para escanear o QR code" />}
    </section>
  );
}

export function OpProductionLookup() {
  const [items, setItems] = useState<ItemBalance[]>([]);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const scan = useCallback(async (opNumber: string) => {
    try {
      const found = await fetchItemsByOpNumber(opNumber);
      setItems(found);
      setMessage(found.length ? null : { kind: "info", text: `Nenhuma OP ativa encontrada com o número ${opNumber}.` });
      return found.length > 0;
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
      return false;
    }
  }, []);

  return (
    <>
      <QrOpScanner onScan={scan} />
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {items.length > 0 && (
        <section className="card section-gap">
          <h2 className="section-title">OP {items[0].op_number} · {items.length} peça(s)</h2>
          <p className="section-sub">Abra a peça para acompanhar ou registrar a baixa em cada processo.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Peça</th><th>Lista</th><th>Linha</th><th className="num">Necessário</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.item_code ?? item.description ?? "—"}</td>
                    <td>{item.list_name ? listLabel(item.list_code, item.list_name) : "—"}</td>
                    <td>{item.line_name ?? "—"}</td>
                    <td className="num">{formatQty(item.qty_total)} {item.unit}</td>
                    <td><StatusPill status={item.status} /></td>
                    <td><Link className="btn secondary small" href={`/ops/${item.id}`}>Acompanhar OP</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

interface OpPiece extends ItemBalance {
  readyQuantity: number;
  scrapQuantity: number;
  processes: ItemProcessStep[];
}

function listGroups(items: ItemBalance[]): { id: string; label: string; items: ItemBalance[] }[] {
  const groups = new Map<string, { id: string; label: string; items: ItemBalance[] }>();
  for (const item of items) {
    const id = item.list_id ?? "";
    const current = groups.get(id) ?? {
      id,
      label: item.list_name ? listLabel(item.list_code, item.list_name) : "Sem lista",
      items: [],
    };
    current.items.push(item);
    groups.set(id, current);
  }
  return [...groups.values()];
}

function quantitySummary(items: ItemBalance[]): string {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.unit, (totals.get(item.unit) ?? 0) + item.qty_total);
  return [...totals].map(([unit, quantity]) => `${formatQty(quantity)} ${unit}`).join(" · ");
}

export function DeliveryTracking() {
  const { canOperate } = useAuth();
  const [matches, setMatches] = useState<ItemBalance[]>([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [opNumber, setOpNumber] = useState("");
  const [pieces, setPieces] = useState<OpPiece[]>([]);
  const [delivery, setDelivery] = useState<ProductionDelivery | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showFabricated, setShowFabricated] = useState(false);
  const [fabricatedGroups, setFabricatedGroups] = useState<FabricatedOpGroup[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const groups = useMemo(() => listGroups(matches), [matches]);
  const selectedGroup = groups.find((group) => group.id === selectedListId);
  const batchGroups = fabricatedGroups.filter((group) => selectedBatch.has(group.key));

  const refreshFabricated = useCallback(async () => {
    const lists = await fetchListOptions(false);
    const candidates = await fetchFabricatedOpGroups(new Set(lists.map((list) => list.id)));
    setFabricatedGroups(candidates);
  }, []);

  async function toggleFabricatedList() {
    if (showFabricated) {
      setShowFabricated(false);
      return;
    }
    setBatchBusy(true);
    setMessage(null);
    try {
      await refreshFabricated();
      setSelectedBatch(new Set());
      setShowFabricated(true);
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
    } finally {
      setBatchBusy(false);
    }
  }

  async function deliverBatch() {
    if (!batchGroups.length) return;
    setBatchBusy(true);
    setMessage(null);
    let delivered = 0;
    const failures: string[] = [];
    for (let index = 0; index < batchGroups.length; index += 5) {
      const chunk = batchGroups.slice(index, index + 5);
      const results = await Promise.allSettled(chunk.map((group) => recordProductionDelivery(group.list_id, group.op_number)));
      results.forEach((result, resultIndex) => {
        if (result.status === "fulfilled") delivered += 1;
        else failures.push(`${chunk[resultIndex].op_number}: ${errorText(result.reason)}`);
      });
    }
    setSelectedBatch(new Set());
    setConfirmBatch(false);
    try {
      await refreshFabricated();
    } catch (e) {
      failures.push(`Falha ao atualizar a lista: ${errorText(e)}`);
    }
    setMessage(failures.length
      ? { kind: "error", text: `${delivered} OP(s) baixada(s); ${failures.length} falha(s): ${failures.slice(0, 4).join(" · ")}${failures.length > 4 ? " · …" : ""}` }
      : { kind: "success", text: `Baixa de entrega registrada para ${delivered} OP(s).` });
    setBatchBusy(false);
  }

  const loadGroup = useCallback(async (code: string, group: { id: string; items: ItemBalance[] }) => {
    if (!group.id) {
      setMessage({ kind: "error", text: "Esta OP não está associada a uma lista; não é possível registrar a entrega integral." });
      return;
    }
    setSelectedListId(group.id);
    setLoading(true);
    setMessage(null);
    try {
      const [storedDelivery, reports, processData] = await Promise.all([
        fetchProductionDelivery(group.id, code),
        fetchProductionScrapReports(group.id, code),
        Promise.all(group.items.map((item) => item.production_line_id
          ? fetchItemProcessSteps(item.id, item.production_line_id)
          : Promise.resolve({ progressSource: "manual" as const, steps: [] }))),
      ]);
      const scrapTotals = new Map<string, number>();
      for (const report of reports) scrapTotals.set(report.production_order_id, (scrapTotals.get(report.production_order_id) ?? 0) + Number(report.quantity));
      setPieces(group.items.map((item, index) => {
        const process = processData[index];
        const scrapQuantity = scrapTotals.get(item.id) ?? 0;
        const readyQuantity = process.progressSource === "nesting"
          ? Math.max(0, item.qty_cut - scrapQuantity)
          : process.steps.length
            ? Math.min(...process.steps.map((step) => step.status === "Não se aplica" ? item.qty_total : step.quantity_completed))
            : 0;
        return { ...item, processes: process.steps, scrapQuantity, readyQuantity };
      }));
      setDelivery(storedDelivery);
    } catch (e) {
      setPieces([]);
      setDelivery(null);
      setMessage({ kind: "error", text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  const scan = useCallback(async (code: string) => {
    setLoading(true);
    setMessage(null);
    setDelivery(null);
    setPieces([]);
    setOpNumber(code);
    setSelectedListId("");
    try {
      const found = await fetchItemsByOpNumber(code);
      setMatches(found);
      const grouped = listGroups(found);
      if (!grouped.length) {
        setMessage({ kind: "info", text: `Nenhuma OP ativa encontrada com o número ${code}.` });
        return false;
      }
      if (grouped.length === 1) await loadGroup(code, grouped[0]);
      else setMessage({ kind: "info", text: "Este número aparece em mais de uma lista. Selecione a lista correta da OP." });
      return true;
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadGroup]);

  async function deliver() {
    if (!selectedListId) return;
    setBusy(true);
    setMessage(null);
    try {
      await recordProductionDelivery(selectedListId, opNumber);
      await loadGroup(opNumber, selectedGroup ?? { id: selectedListId, items: pieces });
      setMessage({ kind: "success", text: `Entrega integral da OP ${opNumber} registrada.` });
      setConfirm(false);
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  const readyForDelivery = pieces.length > 0 && pieces.every((piece) => piece.readyQuantity >= piece.qty_total);

  return (
    <>
      <QrOpScanner onScan={scan} />
      {message && <Notice kind={message.kind} onClose={() => setMessage(null)}>{message.text}</Notice>}
      <section className="card section-gap">
        <div className="btn-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 className="section-title">OPs fabricadas aguardando entrega</h2>
            <p className="section-sub">Mostra somente OPs em que todas as peças estão fabricadas e prontas para a baixa integral.</p>
          </div>
          <button className="btn secondary" type="button" onClick={() => void toggleFabricatedList()} disabled={batchBusy}>
            <ListChecks size={14} /> {showFabricated ? "Ocultar OPs fabricadas" : batchBusy ? "Carregando..." : "Mostrar OPs fabricadas"}
          </button>
        </div>
        {showFabricated && (fabricatedGroups.length === 0 ? (
          <EmptyState title="Nenhuma OP fabricada aguardando entrega" />
        ) : <>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <label className="checkbox">
              <input type="checkbox" checked={batchGroups.length === fabricatedGroups.length} disabled={!canOperate || batchBusy}
                onChange={(e) => setSelectedBatch(e.target.checked ? new Set(fabricatedGroups.map((group) => group.key)) : new Set())} />
              Selecionar todas ({fabricatedGroups.length})
            </label>
            {canOperate && <button className="btn primary" type="button" disabled={batchBusy || batchGroups.length === 0} onClick={() => setConfirmBatch(true)}>
              <Truck size={14} /> Dar baixa nas selecionadas ({batchGroups.length})
            </button>}
          </div>
          {!canOperate && <Notice kind="info">Seu perfil pode consultar, mas não registrar a entrega.</Notice>}
          <div className="table-wrap">
            <table>
              <thead><tr><th></th><th>OP</th><th>Lista</th><th className="num">Itens</th><th>Quantidade por unidade</th><th>Status</th></tr></thead>
              <tbody>{fabricatedGroups.map((group) => <tr key={group.key}>
                <td><input type="checkbox" checked={selectedBatch.has(group.key)} disabled={!canOperate || batchBusy}
                  onChange={(e) => setSelectedBatch((previous) => {
                    const next = new Set(previous);
                    if (e.target.checked) next.add(group.key); else next.delete(group.key);
                    return next;
                  })} aria-label={`Selecionar OP ${group.op_number}`} style={{ width: 16, height: 16 }} /></td>
                <td><strong>{group.op_number}</strong></td>
                <td>{group.items[0].list_name ? listLabel(group.list_code, group.items[0].list_name) : "—"}</td>
                <td className="num">{group.items.length}</td>
                <td>{quantitySummary(group.items)}</td>
                <td><StatusPill status="Fabricada" /></td>
              </tr>)}</tbody>
            </table>
          </div>
        </>)}
      </section>
      {groups.length > 1 && (
        <div className="card section-gap">
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="delivery-list">Lista da OP</label>
            <select
              id="delivery-list"
              className="select"
              value={selectedListId}
              onChange={(e) => {
                const group = groups.find((candidate) => candidate.id === e.target.value);
                if (group) void loadGroup(opNumber, group);
              }}
            >
              <option value="">Selecione a lista...</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.label} · {group.items.length} peça(s)</option>)}
            </select>
          </div>
        </div>
      )}
      {loading ? <div className="card section-gap">Carregando OP...</div> : pieces.length > 0 && (
        <section className="card section-gap">
          <h2 className="section-title">Entrega integral da OP {opNumber}</h2>
          <p className="section-sub">A confirmação inclui todas as peças ativas desta OP na lista selecionada. Peças refugadas precisam ser repostas antes da entrega.</p>
          {delivery && (
            <Notice kind="success">
              <CheckCircle2 size={15} style={{ verticalAlign: "text-bottom" }} /> Entregue em {formatDate(delivery.delivered_at)} por <strong>{delivery.delivered_by_name}</strong>.
            </Notice>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Peça</th><th>Linha</th><th className="num">Necessário</th><th className="num">Produzido bom</th><th className="num">Refugo</th><th className="num">Falta</th></tr></thead>
              <tbody>
                {pieces.map((piece) => (
                  <tr key={piece.id}>
                    <td>{piece.item_code ?? piece.description ?? "—"}</td>
                    <td>{piece.line_name ?? "—"}</td>
                    <td className="num">{formatQty(piece.qty_total)} {piece.unit}</td>
                    <td className="num">{formatQty(piece.readyQuantity)}</td>
                    <td className="num">{formatQty(piece.scrapQuantity)}</td>
                    <td className="num">{formatQty(Math.max(0, piece.qty_total - piece.readyQuantity))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!delivery && !readyForDelivery && (
            <Notice kind="warning">A entrega só libera quando todas as peças atingirem a quantidade necessária. O refugo não reduz a meta: a reposição precisa ser apontada.</Notice>
          )}
          {!delivery && canOperate && (
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={!readyForDelivery} onClick={() => setConfirm(true)}>
                <Truck size={14} /> Registrar entrega completa
              </button>
            </div>
          )}
          {!canOperate && !delivery && <Notice kind="info">Seu perfil pode consultar, mas não registrar a entrega.</Notice>}
        </section>
      )}
      {confirm && (
        <ConfirmModal
          title="Confirmar entrega da OP"
          message={<>Será registrada a entrega completa das <strong>{pieces.length} peça(s)</strong> da OP <strong>{opNumber}</strong>. Quem confirmar e o horário ficarão no histórico.</>}
          confirmLabel="Confirmar entrega"
          busy={busy}
          onConfirm={() => void deliver()}
          onCancel={() => setConfirm(false)}
        />
      )}
      {confirmBatch && <ConfirmModal
        title="Dar baixa nas OPs selecionadas"
        message={<>
          <p>Serão registradas baixas integrais para <strong>{batchGroups.length} OP(s)</strong>:</p>
          <ul>{batchGroups.slice(0, 8).map((group) => <li key={group.key}>{group.op_number} · {group.items[0].list_name ? listLabel(group.list_code, group.items[0].list_name) : "Sem lista"}</li>)}</ul>
          {batchGroups.length > 8 && <p>e mais {batchGroups.length - 8} OP(s).</p>}
          <Notice kind="warning">Cada OP é registrada separadamente. Se alguma falhar, as demais podem ser baixadas; o resultado indicará quais falharam.</Notice>
        </>}
        confirmLabel="Confirmar baixas"
        busy={batchBusy}
        onConfirm={() => void deliverBatch()}
        onCancel={() => setConfirmBatch(false)}
      />}
    </>
  );
}

export function ScrapTracking() {
  const { canOperate } = useAuth();
  const [matches, setMatches] = useState<ItemBalance[]>([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [opNumber, setOpNumber] = useState("");
  const [processes, setProcesses] = useState<Record<string, ItemProcessStep[]>>({});
  const [reports, setReports] = useState<ProductionScrapReport[]>([]);
  const [itemId, setItemId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const groups = useMemo(() => listGroups(matches), [matches]);
  const selectedGroup = groups.find((group) => group.id === selectedListId);
  const selectedItem = selectedGroup?.items.find((item) => item.id === itemId);
  const selectedProcesses = (processes[itemId] ?? []).filter((process) => process.status !== "Não se aplica");
  const selectedProcess = selectedProcesses.find((process) => process.sector_id === sectorId);

  const loadGroup = useCallback(async (code: string, group: { id: string; items: ItemBalance[] }) => {
    if (!group.id) {
      setMessage({ kind: "error", text: "Esta OP não está associada a uma lista." });
      return;
    }
    setSelectedListId(group.id);
    setLoading(true);
    setMessage(null);
    try {
      const [newReports, stepSets] = await Promise.all([
        fetchProductionScrapReports(group.id, code),
        Promise.all(group.items.map((item) => item.production_line_id
          ? fetchItemProcessSteps(item.id, item.production_line_id)
          : Promise.resolve({ progressSource: "manual" as const, steps: [] }))),
      ]);
      setReports(newReports);
      setProcesses(Object.fromEntries(group.items.map((item, index) => [item.id, stepSets[index].steps])));
      const firstItem = group.items[0];
      const firstProcess = stepSets[0].steps[0];
      setItemId(firstItem?.id ?? "");
      setSectorId(firstProcess?.sector_id ?? "");
      setQuantity("");
      setReason("");
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  const scan = useCallback(async (code: string) => {
    setLoading(true);
    setMessage(null);
    setReports([]);
    setMatches([]);
    setProcesses({});
    setSelectedListId("");
    setOpNumber(code);
    try {
      const found = await fetchItemsByOpNumber(code);
      setMatches(found);
      const grouped = listGroups(found);
      if (!grouped.length) {
        setMessage({ kind: "info", text: `Nenhuma OP ativa encontrada com o número ${code}.` });
        return false;
      }
      if (grouped.length === 1) await loadGroup(code, grouped[0]);
      else setMessage({ kind: "info", text: "Este número aparece em mais de uma lista. Selecione a lista correta da OP." });
      return true;
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadGroup]);

  async function saveScrap(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedItem || !selectedProcess) return;
    const parsed = parseDecimalBR(quantity).value;
    if (parsed === null || parsed <= 0) {
      setMessage({ kind: "error", text: "Informe uma quantidade de refugo maior que zero." });
      return;
    }
    if (!reason.trim()) {
      setMessage({ kind: "error", text: "Informe o motivo do refugo." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await recordProductionScrap({ productionOrderId: selectedItem.id, sectorId, quantity: parsed, reason });
      await loadGroup(opNumber, selectedGroup!);
      setMessage({ kind: "success", text: "Refugo registrado. A quantidade precisa ser reposta antes da entrega." });
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <QrOpScanner onScan={scan} />
      {message && <Notice kind={message.kind} onClose={() => setMessage(null)}>{message.text}</Notice>}
      {groups.length > 1 && (
        <div className="card section-gap">
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="scrap-list">Lista da OP</label>
            <select id="scrap-list" className="select" value={selectedListId} onChange={(e) => {
              const group = groups.find((candidate) => candidate.id === e.target.value);
              if (group) void loadGroup(opNumber, group);
            }}>
              <option value="">Selecione a lista...</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.label} · {group.items.length} peça(s)</option>)}
            </select>
          </div>
        </div>
      )}
      {loading ? <div className="card section-gap">Carregando OP...</div> : selectedGroup && (
        <div className="grid two section-gap">
          <section className="card">
            <h2 className="section-title">Registrar refugo · OP {opNumber}</h2>
            <p className="section-sub">Refugo fica no histórico e não reduz a quantidade necessária. A reposição continua pendente.</p>
            {canOperate ? (
              <form className="stack" onSubmit={(e) => void saveScrap(e)}>
                <div className="field">
                  <label htmlFor="scrap-item">Peça</label>
                  <select id="scrap-item" className="select" value={itemId} onChange={(e) => {
                    const nextId = e.target.value;
                    setItemId(nextId);
                    setSectorId(processes[nextId]?.[0]?.sector_id ?? "");
                  }}>
                    {selectedGroup.items.map((item) => <option key={item.id} value={item.id}>{item.item_code ?? item.description ?? "Peça"} · {item.line_name ?? "sem linha"}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="scrap-process">Processo em que ocorreu</label>
                  <select id="scrap-process" className="select" value={sectorId} onChange={(e) => setSectorId(e.target.value)} disabled={!selectedProcesses.length}>
                    {selectedProcesses.map((process) => <option key={process.sector_id} value={process.sector_id}>{process.process_name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="scrap-qty">Quantidade de peças refugadas *</label>
                  <input id="scrap-qty" className="input" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Ex.: 1" />
                </div>
                <div className="field">
                  <label htmlFor="scrap-reason">Motivo *</label>
                  <textarea id="scrap-reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Descreva o defeito observado" />
                </div>
                {!selectedProcesses.length && <Notice kind="warning">Esta peça não tem processo de produção configurado para registrar refugo.</Notice>}
                <div className="btn-row">
                  <button className="btn primary" type="submit" disabled={busy || !selectedProcess}>{busy ? "Salvando..." : "Registrar refugo e exigir reposição"}</button>
                </div>
              </form>
            ) : <Notice kind="info">Seu perfil pode consultar, mas não registrar refugo.</Notice>}
          </section>
          <section className="card">
            <h2 className="section-title">Histórico de refugos ({reports.length})</h2>
            {reports.length === 0 ? <EmptyState title="Nenhum refugo registrado para esta OP" /> : (
              <div className="stack">
                {reports.map((report) => (
                  <article key={report.id} className="card" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 700 }}>{report.production_orders?.item_code ?? report.production_orders?.description ?? "Peça"} · {formatQty(Number(report.quantity))} un.</div>
                    <div className="muted">{report.production_sectors?.name ?? "Processo"} · {formatDate(report.reported_at)} · {report.reported_by_name}</div>
                    <div style={{ marginTop: 5 }}>{report.reason}</div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
