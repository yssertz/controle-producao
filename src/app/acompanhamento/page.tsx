import Link from "next/link";
import { PageHeader } from "@/components/ui";

export default function AcompanhamentoPage() {
  return (
    <main className="content">
      <PageHeader
        eyebrow="PCP / Produção"
        title="Acompanhamento geral"
        subtitle="Roteiros, etapas e apontamentos por setor ainda não foram implementados (Fase 6)."
      />
      <div className="notice warning">
        Nenhum percentual de avanço é calculado aqui, de propósito: ele depende dos roteiros e apontamentos por setor, que ainda não existem.
        As tabelas já estão no banco, mas não há tela para usá-las.
      </div>
      <div className="grid two">
        <section className="card">
          <h2 className="section-title">Já disponível</h2>
          <p className="section-sub">O acompanhamento do corte a laser por OP já funciona.</p>
          <div className="btn-row">
            <Link className="btn primary" href="/ops">Saldo por OP</Link>
            <Link className="btn secondary" href="/nestings">Nestings</Link>
            <Link className="btn secondary" href="/">Dashboard</Link>
          </div>
        </section>
        <section className="card">
          <h2 className="section-title">Pendente (Fase 6)</h2>
          <p className="subtitle">Roteiros por peça, etapas sequenciais, apontamentos por setor e o fluxo específico de Leniors.</p>
        </section>
      </div>
    </main>
  );
}
