/**
 * Line diff for the version history dialog. A short LCS; past 400 lines the
 * two texts are shown as a full removal and a full addition.
 */
export type DiffWord = { kind: "same" | "added" | "removed"; text: string };

export type DiffLine = {
  kind: "same" | "added" | "removed";
  text: string;
  words?: DiffWord[];
};

function linesOf(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

function wordsOf(line: string): DiffWord[] {
  const parts = line.split(/(\s+)/);
  return parts.filter((part) => part !== "").map((text) => ({ kind: "same", text }));
}

function wordDiff(before: string, after: string): { removed: DiffWord[]; added: DiffWord[] } {
  const left = wordsOf(before);
  const right = wordsOf(after);
  const dp: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i].text === right[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const removed: DiffWord[] = [];
  const added: DiffWord[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i].text === right[j].text) {
      removed.push({ kind: "same", text: left[i].text });
      added.push({ kind: "same", text: right[j].text });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push({ kind: "removed", text: left[i].text });
      i += 1;
    } else {
      added.push({ kind: "added", text: right[j].text });
      j += 1;
    }
  }
  while (i < left.length) {
    removed.push({ kind: "removed", text: left[i].text });
    i += 1;
  }
  while (j < right.length) {
    added.push({ kind: "added", text: right[j].text });
    j += 1;
  }
  return { removed, added };
}

function lcsLines(before: string[], after: string[]): DiffLine[] {
  const dp: number[][] = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      out.push({ kind: "same", text: before[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "removed", text: before[i] });
      i += 1;
    } else {
      out.push({ kind: "added", text: after[j] });
      j += 1;
    }
  }
  while (i < before.length) {
    out.push({ kind: "removed", text: before[i] });
    i += 1;
  }
  while (j < after.length) {
    out.push({ kind: "added", text: after[j] });
    j += 1;
  }
  return out;
}

function markReplacements(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line.kind === "removed" && next?.kind === "added") {
      const words = wordDiff(line.text, next.text);
      out.push({ kind: "removed", text: line.text, words: words.removed });
      out.push({ kind: "added", text: next.text, words: words.added });
      i += 1;
      continue;
    }
    out.push(line);
  }
  return out;
}

/** Changes from `before` to `after`. Word marks sit on a removed line paired with the following added line. */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = linesOf(before);
  const right = linesOf(after);
  if (left.length + right.length > 400) {
    return [...left.map((text) => ({ kind: "removed" as const, text })), ...right.map((text) => ({ kind: "added" as const, text }))];
  }
  return markReplacements(lcsLines(left, right));
}
