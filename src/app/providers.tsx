"use client";

import Link from "next/link";
import { Theme } from "@astryxdesign/core/theme";
import { LinkProvider } from "@astryxdesign/core/Link";
import { useColorScheme } from "@/components/shell/color-scheme";
import { defaultThemeSlug, themes } from "../astryx-themes";

/**
 * App root providers. The theme comes from the module `astryx theme add
 * --import` generates; the remembered colour scheme sets the Astryx mode.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  return (
    <Theme theme={themes[defaultThemeSlug]} mode={scheme}>
      <LinkProvider component={Link}>{children}</LinkProvider>
    </Theme>
  );
}
