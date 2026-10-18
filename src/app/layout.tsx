import type {Metadata} from "next";
import {Source_Code_Pro, Source_Sans_3} from "next/font/google";
import "./globals.css";
import {Providers} from "./providers";

const bodyFont = Source_Sans_3({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-body",
  display: "swap",
});

const codeFont = Source_Code_Pro({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tessera",
  description: "Local AI-first work tracker",
};

/**
 * Root layout: fonts and providers only. `(tessera)` renders the Tessera shell.
 */
export default function RootLayout({children}: LayoutProps<"/">) {
  return (
    // data-theme="dark" is the Astryx SSR hint for the Frappé default
    // (DEFAULT_COLOR_SCHEME); the root <Theme> updates it after hydration.
    <html
      lang="en"
      data-theme="dark"
      className={`${bodyFont.variable} ${codeFont.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
