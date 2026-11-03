// Converte a descrição da matéria-prima (MP) em espessura da chapa, em milímetros.
// Sem dependências, para poder ser testado sozinho (npm test).
//
// Formas reconhecidas, nesta ordem de prioridade:
//   1. milímetros escritos na descrição:  "CHAPA 3/8 (9,50 mm) LNE-38"  ->  9.5
//                                          "CHAPA INOX DIN 410 - 4,76mm x 1270mm ..."  ->  4.76
//      (só vale até 100 mm: "2550mm" é largura da chapa, não espessura)
//   2. polegadas logo após CHAPA / FERRO CHAT:  "CHAPA 1/4 ..." -> 6.35 ;  "CHAPA 1 1/2 ..." -> 38.1 ;  "CHAPA 2 ..." -> 50.8
//   3. bitola (número de 5 a 30):  "CHAPA 8 SAE 1010/20" -> 4.17 ;  "CHAPA INOX 14 ..." -> 1.9   (tabela MSG)
// Medidas entre parênteses como "(1200 X 3000)" nunca são tomadas como espessura.
// Retorna null quando a MP não é chapa/barra chata ou quando não dá para saber (nunca chuta).

/** Polegadas comerciais -> mm (valores usados no ERP: 3/8" = 9,50 mm; 3/16" = 4,76 mm...). */
const INCH_TO_MM: Record<string, number> = {
  "1/16": 1.59, "1/8": 3.18, "3/16": 4.76, "1/4": 6.35, "5/16": 7.94, "3/8": 9.5, "7/16": 11.11, "1/2": 12.7,
  "9/16": 14.29, "5/8": 15.88, "3/4": 19.05, "7/8": 22.23,
  "1": 25.4, "1 1/8": 28.58, "1 1/4": 31.75, "1 3/8": 34.93, "1 1/2": 38.1, "1 3/4": 44.45,
  "2": 50.8, "2 1/4": 57.15, "2 1/2": 63.5, "3": 76.2, "3 1/2": 88.9, "4": 101.6,
};

/** Bitola MSG (Manufacturer's Standard Gauge) -> mm. */
const GAUGE_TO_MM: Record<number, number> = {
  5: 5.31, 6: 4.94, 7: 4.55, 8: 4.17, 9: 3.8, 10: 3.42, 11: 3.04, 12: 2.66, 13: 2.28, 14: 1.9,
  15: 1.71, 16: 1.52, 17: 1.37, 18: 1.21, 19: 1.06, 20: 0.91, 22: 0.76, 24: 0.61, 26: 0.46, 28: 0.38, 30: 0.3,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Espessura em mm, ou null se não for possível determinar. */
export function parseThicknessMm(description: string | null | undefined): number | null {
  if (!description) return null;
  const text = description.replace(/\s+/g, " ").trim().toUpperCase();

  // Só chapa e barra chata têm "espessura" aqui (tubo, cantoneira e redondo ficam sem).
  const kind = /^(CHAPA|FERRO CHAT)/.exec(text);
  if (!kind) return null;

  // 1) milímetros escritos na descrição
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*MM\b/g)) {
    const v = Number(m[1].replace(",", "."));
    if (v > 0 && v <= 100) return round2(v);
  }

  // 2) e 3) número logo depois de CHAPA / FERRO CHAT (pulando adjetivos como INOX, GALV., ANTIDERRAPANTE)
  const afterKeyword = text.replace(/^(CHAPA|FERRO CHATO?)\s+/, "").replace(/^((INOX|ANTIDERRAPANTE|GALV\.?|GALVANIZADA|ZINCADA|XADREZ)\s+)+/, "");
  const frac = /^(\d+)\s+(\d+)\/(\d+)\b/.exec(afterKeyword) ?? /^()(\d+)\/(\d+)\b/.exec(afterKeyword);
  if (frac) {
    const key = frac[1] ? `${frac[1]} ${frac[2]}/${frac[3]}` : `${frac[2]}/${frac[3]}`;
    if (INCH_TO_MM[key] !== undefined) return INCH_TO_MM[key];
    const whole = frac[1] ? Number(frac[1]) : 0;
    const v = whole + Number(frac[2]) / Number(frac[3]);
    return v > 0 && v <= 4 ? round2(v * 25.4) : null;
  }
  const num = /^(\d+)(?![\d/,.])/.exec(afterKeyword);
  if (num) {
    const n = Number(num[1]);
    if (n >= 1 && n <= 4) return INCH_TO_MM[String(n)] ?? null; // 1" a 4"
    if (GAUGE_TO_MM[n] !== undefined) return GAUGE_TO_MM[n]; // bitola
  }
  return null;
}

/** "6,35 mm" para exibição. */
export function formatMm(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)} mm`;
}
