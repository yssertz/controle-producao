// Copia o "worker" do pdf.js (leitor de PDF) para a pasta public/, na MESMA versão do pacote instalado.
// Roda sozinho depois do "npm install" (script postinstall). Se falhar, o resto do sistema continua funcionando;
// só o botão "Enviar PDF do nesting" deixaria de funcionar.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const from = "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs";
if (existsSync(from)) {
  mkdirSync("public", { recursive: true });
  copyFileSync(from, "public/pdf.worker.mjs");
  console.log("pdf.worker.mjs copiado para public/");
} else {
  console.warn("pdfjs-dist não encontrado; pulei a cópia do worker.");
}
