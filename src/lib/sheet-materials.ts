export const SHEET_MATERIAL_TYPES = [
  { value: "A36_SAE1010_20_NORMAL", label: "ASTM-A36 e SAE1010/20" },
  { value: "A36_SAE1010_20_LNE", label: "Chapa LNE" },
  { value: "GALVANIZADA", label: "Galvanizada" },
  { value: "INOX", label: "Inox" },
  { value: "HARDOX", label: "Hardox" },
  { value: "STRENX", label: "Strenx" },
  { value: "ANTIDERRAPANTE", label: "Antiderrapante" },
] as const;
export type SheetMaterialType = (typeof SHEET_MATERIAL_TYPES)[number]["value"];
export function classifyProductionMaterial(material: string | null | undefined): SheetMaterialType | null {
  const value = (material ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  if (!value) return null;
  // Códigos de matéria-prima usados no cadastro do ERP.
  if (/(^|[^0-9])25096([^0-9]|$)/.test(value)) return "A36_SAE1010_20_LNE";
  if (/(^|[^0-9])22630([^0-9]|$)/.test(value)) return "A36_SAE1010_20_NORMAL";
  if (/\bLNE\b|LNE[- ]?\d/.test(value)) return "A36_SAE1010_20_LNE";
  if (/ASTM[\s-]*A[\s-]*36|SAE\s*1010\s*\/\s*20/.test(value)) return "A36_SAE1010_20_NORMAL";
  if (/ANTIDERRAPANTE|PE DE GALINHA/.test(value)) return "ANTIDERRAPANTE";
  if (/GALVANIZ/.test(value)) return "GALVANIZADA";
  if (/INOX|AISI\s*30[24]/.test(value)) return "INOX";
  if (/HARDOX/.test(value)) return "HARDOX";
  if (/STRENX/.test(value)) return "STRENX";
  return null;
}
export function isMaterialCompatible(sheetType: SheetMaterialType | "", itemMaterial: string | null | undefined): boolean {
  const itemType = classifyProductionMaterial(itemMaterial);
  if (!sheetType || !itemType) return false;
  if (sheetType === "A36_SAE1010_20_LNE") return itemType === "A36_SAE1010_20_LNE" || itemType === "A36_SAE1010_20_NORMAL";
  return sheetType === itemType;
}
