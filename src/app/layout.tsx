import type {Metadata} from "next";
import {Suspense} from "react";
import {Source_Code_Pro, Source_Sans_3, Source_Serif_4} from "next/font/google";
import "./globals.css";
import {Providers} from "./providers";
import {WorkspaceFrame} from "./workspace-frame";

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
  title: "Handbook",
  description: "A local workspace of collections and pages, shared with MCP",
};

export default function RootLayout({children}: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${headingFont.variable} ${codeFont.variable}`}
    >
      <body>
        <Providers>
          <Suspense fallback={null}>
            <WorkspaceFrame>{children}</WorkspaceFrame>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
