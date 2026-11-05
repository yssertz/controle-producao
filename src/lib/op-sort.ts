export type OpSortDirection = "asc" | "desc";

function numericValue(value: string): number {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : Number.NaN;
}

/** Compara OPs numéricas preservando o formato brasileiro com separadores de milhar. */
export function compareOpNumbers(a: string, b: string, direction: OpSortDirection = "asc"): number {
  const aNumber = numericValue(a);
  const bNumber = numericValue(b);
  const comparison = Number.isNaN(aNumber) || Number.isNaN(bNumber)
    ? a.localeCompare(b, "pt-BR", { numeric: true })
    : aNumber - bNumber || a.localeCompare(b, "pt-BR", { numeric: true });
  return direction === "asc" ? comparison : -comparison;
}
