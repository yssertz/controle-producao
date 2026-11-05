import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { PAGE_SIZE } from "@/lib/constants";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="back-link">
      <ArrowLeft size={14} /> {children}
    </Link>
  );
}

export function Notice({
  kind = "info",
  children,
  onClose,
}: {
  kind?: "info" | "success" | "warning" | "error";
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div style={{ flex: 1 }}>{children}</div>
      {onClose && (
        <button className="notice-close" onClick={onClose} aria-label="Dispensar aviso">
          ×
        </button>
      )}
    </div>
  );
}

const TONES: Record<string, string> = {
  Aguardando: "gray",
  "Em produção": "amber",
  Parcial: "amber",
  Fabricada: "blue",
  Concluída: "green",
  Concluído: "green",
  Bloqueada: "red",
  Programado: "blue",
  Cancelado: "red",
  Planejada: "blue",
  "Em andamento": "amber",
  Arquivada: "gray",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${TONES[status] ?? "gray"}`}>{status}</span>;
}

export function Loading({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="empty">
      <span className="loading-inline">
        <Loader2 className="spin" size={16} /> {label}
      </span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

export function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  const first = page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="pagination">
      <span className="muted">
        {first}–{last} de {total}
      </span>
      <button type="button" className="btn secondary small" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} /> Anterior
      </button>
      <span className="muted">
        Página {page + 1} de {pages}
      </span>
      <button type="button" className="btn secondary small" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
        Próxima <ChevronRight size={14} />
      </button>
    </div>
  );
}

/** Barra de progresso simples (valor de 0 a 100). */
export function ProgressBar({ value, tone = "blue" }: { value: number; tone?: "blue" | "green" | "amber" }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" aria-label={`${Math.round(v)}%`}>
      <div className={`progress-fill ${tone}`} style={{ width: `${v}%` }} />
    </div>
  );
}
