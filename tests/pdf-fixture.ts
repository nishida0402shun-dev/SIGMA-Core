/**
 * Generates deterministic, minimal PDF fixtures for extraction tests.
 * The generator writes a classic xref table so the files are valid standalone
 * PDFs without requiring an external PDF authoring tool.
 */

export interface PdfFixtureOptions {
  /** Page text; `null` produces a page with an empty content stream (a scan-like page). */
  pages: Array<string | null>;
  /** Media box in PDF points. */
  width?: number;
  height?: number;
}

export function makePdf({ pages, width = 612, height = 792 }: PdfFixtureOptions): Buffer {
  if (pages.length === 0) throw new Error("A PDF fixture needs at least one page");

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, index) => `${3 + index} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;

  const fontObject = 3 + pages.length;
  const contentsStart = fontObject + 1;

  pages.forEach((text, index) => {
    const contentObject = contentsStart + index;
    objects[3 + index] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`;
    const stream = text === null
      ? ""
      : `BT /F1 24 Tf 72 ${height - 72} Td (${escapePdfString(text)}) Tj ET`;
    objects[contentObject] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontObject] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(output, "latin1");
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

function escapePdfString(value: string): string {
  return value.replace(/([()\\])/g, "\\$1").replace(/\r?\n/g, " ");
}
