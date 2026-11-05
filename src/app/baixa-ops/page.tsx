"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OpBajaTracking } from "@/components/OpBajaTracking";
import { DeliveryTracking } from "@/components/OpTracking";
import { PageHeader } from "@/components/ui";

export default function BaixaOpsPage() {
  const [tab, setTab] = useState<"fabricacao" | "entrega">("fabricacao");
  return (
    <main className="content">
      <PageHeader
        eyebrow="PCP / Produção"
        title="Baixa de OPs"
        subtitle="Aponte a fabricação por processo, registre a entrega integral de OPs e acompanhe refugos. Laser puro é apontado pelo nesting."
        actions={<Link className="btn secondary" href="/ops"><ArrowLeft size={14} /> Voltar para OPs e peças</Link>}
      />
      <div className="btn-row" role="tablist" aria-label="Tipo de baixa" style={{ marginBottom: 16 }}>
        {([ ["fabricacao", "Baixa de fabricação"], ["entrega", "Baixa de entrega" ] ] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value}
            className={tab === value ? "pill blue" : "pill gray"}
            style={{ border: 0, cursor: "pointer", fontSize: 13, padding: "7px 14px" }}
            onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>
      {tab === "fabricacao" ? <OpBajaTracking /> : <DeliveryTracking />}
    </main>
  );
}
