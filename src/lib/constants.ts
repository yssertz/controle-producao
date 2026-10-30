// Valores padronizados. Os mesmos valores existem como restrições (CHECK) no banco.

export const LIST_TYPES = ["Rodoviário", "Ambiental", "Pós-vendas", "Avulsos", "Leniors"] as const;
export const LIST_STATUSES = ["Planejada", "Em andamento", "Concluída", "Arquivada"] as const;
export const ITEM_STATUSES = ["Aguardando", "Em produção", "Parcial", "Concluída", "Bloqueada"] as const;
export const NESTING_STATUSES = ["Programado", "Em produção", "Concluído", "Cancelado"] as const;
export const UNITS = ["un", "kg", "m", "m²", "mm", "L"] as const;

export const PAGE_SIZE = 50;

/** Código de nesting: L0001, L0002... (letra L + 4 ou mais dígitos), único em todo o sistema. */
export const NESTING_CODE_REGEX = /^L\d{4,}$/;
