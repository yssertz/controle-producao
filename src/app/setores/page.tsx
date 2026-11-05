"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Loading, Notice, PageHeader } from "@/components/ui";
import { errorText } from "@/lib/errors";
import { addLine, fetchErpCodes, fetchLaserMachines, fetchLines, fetchSectors, setLineActive, setLineAllowsNesting } from "@/lib/reference";
import type { ErpLineCode, LaserMachine, ProductionLine, ProductionSector } from "@/lib/types";

export default function SetoresPage() {
  const { isAdmin } = useAuth();
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [machines, setMachines] = useState<LaserMachine[]>([]);
  const [sectors, setSectors] = useState<ProductionSector[]>([]);
  const [erp, setErp] = useState<ErpLineCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [newLine, setNewLine] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, m, s, e] = await Promise.all([fetchLines(false), fetchLaserMachines(false), fetchSectors(), fetchErpCodes()]);
      setLines(l);
      setMachines(m);
      setSectors(s);
      setErp(e);
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (newLine.trim() === "") return;
    const normalizedName = newLine.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
    if (lines.some((line) => line.name.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR") === normalizedName)) {
      setMsg({ kind: "error", text: `A linha ${normalizedName} já está cadastrada.` });
      return;
    }
    setBusy(true);
    try {
      const nextOrder = (lines.reduce((m, l) => Math.max(m, l.sort_order), 0) || 0) + 10;
      await addLine(normalizedName, nextOrder);
      setNewLine("");
      setMsg({ kind: "success", text: "Linha cadastrada." });
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleNesting(l: ProductionLine) {
    try {
      await setLineAllowsNesting(l.id, !l.allows_nesting);
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    }
  }

  async function toggle(l: ProductionLine) {
    try {
      await setLineActive(l.id, !l.active);
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    }
  }

  return (
    <main className="content">
      <PageHeader eyebrow="Configuração" title="Setores e linhas" subtitle="Configure as linhas e etapas que aparecem nas OPs. Os nomes são padronizados automaticamente em maiúsculas." />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {loading ? (
        <Loading />
      ) : (
        <div className="stack">
          <section className="card">
            <h2 className="section-title">Linhas de produção ({lines.length})</h2>
            <p className="section-sub">Linhas são o agrupamento do item na lista. Não são máquinas. Linhas em uso não são apagadas, apenas desativadas.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Linha</th><th>Códigos ERP</th><th>Situação</th><th>Aceita nesting (laser)</th>{isAdmin && <th>Ações</th>}</tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td className="muted">{erp.filter((x) => x.line_id === l.id).map((x) => x.code).join(", ") || "—"}</td>
                      <td><span className={l.active ? "pill green" : "pill gray"}>{l.active ? "Ativa" : "Inativa"}</span></td>
                      <td><span className={l.allows_nesting ? "pill blue" : "pill gray"}>{l.allows_nesting ? "Sim" : "Não"}</span></td>
                      {isAdmin && (
                        <td>
                          <div className="btn-row">
                            <button className="btn secondary small" onClick={() => void toggle(l)}>{l.active ? "Desativar" : "Ativar"}</button>
                            <button className="btn secondary small" onClick={() => void toggleNesting(l)}>{l.allows_nesting ? "Bloquear nesting" : "Permitir nesting"}</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isAdmin && (
              <form onSubmit={add} className="btn-row" style={{ marginTop: 14 }}>
                <input className="input" style={{ maxWidth: 320 }} value={newLine} onChange={(e) => setNewLine(e.target.value)} placeholder="Nome da nova linha" aria-label="Nome da nova linha" />
                <button className="btn primary" disabled={busy || newLine.trim() === ""}>Adicionar linha</button>
              </form>
            )}
          </section>

          <section className="card">
            <h2 className="section-title">Linhas do ERP não controladas ({erp.filter((x) => !x.line_id).length})</h2>
            <p className="section-sub">Itens dessas linhas do ERP entram como “sem linha” na colagem (equipamentos, montagem, tubulação etc.). Para controlar uma delas, crie a linha e peça ao administrador para ligá-la ao código no banco (tabela erp_line_codes).</p>
            <div className="muted">{erp.filter((x) => !x.line_id).map((x) => `${x.code} ${x.description}`).join(" · ") || "Nenhuma."}</div>
          </section>

          <div className="grid two">
            <section className="card">
              <h2 className="section-title">Máquinas de corte</h2>
              <p className="section-sub">Somente estas máquinas (laser e bobina) podem ser escolhidas em um nesting.</p>
              {machines.map((m) => (
                <div className="kv-value" key={m.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  {m.name} <span className={m.active ? "pill green" : "pill gray"}>{m.active ? "Ativa" : "Inativa"}</span>
                </div>
              ))}
            </section>
            <section className="card">
              <h2 className="section-title">Setores / processos</h2>
            <p className="section-sub">Etapas de fabricação usadas nos apontamentos das OPs.</p>
              {sectors.map((s) => (
                <div key={s.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft)", fontWeight: 600 }}>
                  {s.name} {s.is_external && <span className="pill blue">Externo</span>}
                </div>
              ))}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
