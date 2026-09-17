import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeScript } from "@/components/ThemeScript";
import { cn } from "@/lib/utils";
import "./globals.css";

// Typography recommended by ui-ux-pro-max: Fira Sans / Fira Code
// ("dashboard, data, analytics, technical, precise")
const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-fira-sans",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-fira-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Research Constellation",
  description:
    "Explore your research network from an ORCID iD: how it connects, evolves, and expands — everyone you have written with, where your work has been cited, and who you could connect with next.",
};

// Cloudflare Web Analytics. Only the published build gets it: the Pages workflow passes the
// token in, so running the app locally counts nothing. The token is not a secret — it sits in
// the HTML of every published page — and all it can do is record a visit to this site.
const BEACON_TOKEN = process.env.CF_BEACON_TOKEN;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", firaSans.variable, firaCode.variable)}
    >
      <body>
        <ThemeScript />
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        {BEACON_TOKEN && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: BEACON_TOKEN })}
          />
        )}
      </body>
    </html>
  );
}
