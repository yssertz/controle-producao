// Tipos mínimos do pdf.js (build "legacy", com suporte a navegadores mais antigos, como os tablets da fábrica).
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(src: { data: Uint8Array }): { promise: Promise<unknown> };
}
