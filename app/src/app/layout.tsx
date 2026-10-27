import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const THEME_SCRIPT = `try{var t=localStorage.getItem("dpm-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "DPM",
  description: "Digital Project Manager: talk to Atlas, see what needs you.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The theme script sets data-theme before React loads, so the server's <html> differs on purpose
      suppressHydrationWarning
    >
      <head>
        {/* The saved theme (Light or Dark) applies before the first paint, so the page never flashes the other one */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
