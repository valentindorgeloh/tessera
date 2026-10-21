"use client";

/**
 * Heading of a plain analytics table with its Download CSV button on the
 * right (docs/drafts/p10-plan.md U2, decision 100). The button is left out
 * while the table has no rows, so an empty table never downloads a file with
 * only a header.
 */
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/Stack";
import { DownloadCsvButton, type CsvTable } from "@/components/charts/csv-download";

export function AnalyticsTableHeading({ title, csv }: { title: string; csv: CsvTable }) {
  return (
    <HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
      <Heading level={2}>{title}</Heading>
      {csv.rows.length > 0 ? <DownloadCsvButton table={csv} title={title} /> : null}
    </HStack>
  );
}
