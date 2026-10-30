// O Supabase devolve no máximo 1000 linhas por consulta. Esta função busca página por página
// até acabar, para telas que precisam do conjunto completo (ex.: escolher OPs de uma lista).

import { DbError, friendlyMessage } from "./errors";

const CHUNK = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string; details?: string | null } | null }>,
  limit = 20000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < limit; from += CHUNK) {
    const { data, error } = await page(from, from + CHUNK - 1);
    if (error) throw new DbError(friendlyMessage(error), error.code);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < CHUNK) break;
  }
  return all;
}
