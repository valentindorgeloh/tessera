"use client";

/**
 * Client-side CSV download for the analytics tables (decision 100: analytics
 * tables export client-side through the same `toCsv`). One helper and one
 * button serve the chart data tables (ChartFrame) and the plain tables
 * (top assignees, projects, cycles, modules). The file has the UTF-8 BOM and
 * CRLF that `toCsv` writes.
 */
import { Button } from "@astryxdesign/core/Button";
import { toCsv } from "@/lib/tessera/core/csv";
import { DownloadIcon } from "@/themes/catppuccin/icons";

export type CsvTable = {
  /** File name without extension, e.g. "analytics-priority". */
  fileStem: string;
  header: string[];
  rows: (string | number | null)[][];
};

/** The file name a table downloads as. */
export function csvFileName(fileStem: string): string {
  return `${fileStem}.csv`;
}

/** The CSV file of a table as a Blob (BOM included in the bytes). */
export function csvBlob(table: CsvTable): Blob {
  return new Blob([toCsv(table.header, table.rows)], { type: "text/csv;charset=utf-8" });
}

/** Saves the table through a temporary object URL and anchor. */
export function downloadCsv(table: CsvTable): void {
  const url = URL.createObjectURL(csvBlob(table));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = csvFileName(table.fileStem);
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * `title` names the table in the accessible name ("Download CSV: Top
 * assignees"), so several buttons on one screen are told apart. The visible
 * text stays "Download CSV" and the name starts with it (label in name).
 */
export function DownloadCsvButton({ table, title }: { table: CsvTable; title?: string }) {
  const label = title ? `Download CSV: ${title}` : "Download CSV";
  return (
    <Button variant="ghost" size="sm" label={label} icon={<DownloadIcon />} className="tessera-analytics-csv" onClick={() => downloadCsv(table)}>
      Download CSV
    </Button>
  );
}
