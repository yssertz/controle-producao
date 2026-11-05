export function opNumberVariants(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return [trimmed];

  const variants = new Set([trimmed, digits]);
  const groups: string[] = [];
  let remaining = digits;
  while (remaining.length > 3) {
    groups.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }
  groups.unshift(remaining);
  variants.add(groups.join("."));
  return [...variants];
}
