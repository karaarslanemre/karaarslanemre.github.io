// Types for the PDF.js build the reader loads, and for Vite's "?url" imports.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}
declare module '*?url' {
  const url: string;
  export default url;
}
