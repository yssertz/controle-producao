// Formatação em português do Brasil: datas DD/MM/AAAA e números com vírgula decimal.
// (Para ENVIAR ao banco usamos sempre números JavaScript normais, com ponto decimal.)

const TZ = "America/Sao_Paulo";

const qtyFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return qtyFormatter.format(value);
}

/** Aceita "2026-10-20" (campo date) ou um timestamp ISO. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: TZ });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo, para campos <input type="date">. */
export function todayISO(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

export function emptyToNull(value: string): string | null {
  const t = value.trim();
  return t === "" ? null : t;
}

/** "08 - CONTEINER" (código + nome) ou só o nome quando a lista não tem código. */
export function listLabel(code: string | null | undefined, name: string | null | undefined): string {
  const n = name ?? "—";
  return code && code.trim() !== "" ? `${code.trim()} - ${n}` : n;
}
