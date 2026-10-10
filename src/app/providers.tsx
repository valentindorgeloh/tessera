"use client";

import Link from "next/link";
import { Theme } from "@astryxdesign/core/theme";
import { LinkProvider } from "@astryxdesign/core/Link";
import { paperTheme } from "../themes/paper/paper";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Theme theme={paperTheme} mode="light">
      <LinkProvider component={Link}>{children}</LinkProvider>
    </Theme>
  );
}
