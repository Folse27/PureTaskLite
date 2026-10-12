import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PureTask Lite",
  description: "Personal day planner",
  applicationName: "PureTask Lite",
  appleWebApp: { capable: true, title: "PureTask", statusBarStyle: "default" },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

/** Applies the remembered theme before first paint (no flash). Defaults to the system setting. */
const themeScript = `(function(){try{var s=localStorage.getItem("ptl-theme");var d=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
