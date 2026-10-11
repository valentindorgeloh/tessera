import type {Metadata} from "next";
import {Source_Code_Pro, Source_Sans_3, Source_Serif_4} from "next/font/google";
import "./globals.css";
import {Providers} from "./providers";

const bodyFont = Source_Sans_3({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-body",
  display: "swap",
});

const headingFont = Source_Serif_4({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-heading",
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
 * Root layout: fonts and providers only. The app frames live in the route
 * groups: `(handbook)` keeps the legacy WorkspaceFrame until P6 and
 * `(tessera)` renders the Tessera shell.
 */
export default function RootLayout({children}: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${headingFont.variable} ${codeFont.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
