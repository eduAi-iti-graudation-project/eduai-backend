declare module 'pdf-parse' {
  interface PDFResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    version: string;
  }

  function pdfParse(
    data: Buffer | ArrayBuffer | string,
    options?: Record<string, unknown>,
  ): Promise<PDFResult>;

  export = pdfParse;
}
