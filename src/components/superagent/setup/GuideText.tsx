"use client";

/**
 * One paragraph of the setup guide (decision 155): text with `backticks` for inline code, drawn as Astryx
 * `Code`. The guide's strings are data (`setup-guide.ts`); this is the one place that turns them into elements.
 */
import { Fragment } from "react";
import { Code } from "@astryxdesign/core/Code";
import { Text } from "@astryxdesign/core/Text";
import { splitInlineCode } from "../setup-guide";

export type GuideTextProps = {
  text: string;
  type?: "body" | "supporting";
  color?: "primary" | "secondary";
};

export function GuideText({ text, type, color }: GuideTextProps) {
  return (
    <Text type={type} color={color}>
      {splitInlineCode(text).map((part, i) => (part.isCode ? <Code key={`c${i}`}>{part.value}</Code> : <Fragment key={`t${i}`}>{part.value}</Fragment>))}
    </Text>
  );
}
