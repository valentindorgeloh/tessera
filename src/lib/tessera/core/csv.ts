/**
 * CSV for exports (decision 20's spreadsheet exit). UTF-8 BOM, CRLF, RFC 4180
 * quoting, and a leading apostrophe on cells that a spreadsheet would treat
 * as a formula.
 */

const FORMULA = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** One cell: formula guard, then quotes when the cell holds a comma, quote or line break. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (text.length > 0 && FORMULA.has(text[0])) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** UTF-8 BOM, header, then rows, each line ending in CRLF. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [header, ...rows].map((row) => row.map((cell) => csvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
