import type { Metadata, Viewport } from "next";
import { DataStream } from "@/components/data-stream";
import "./globals.css";

export const metadata: Metadata = {
  // People OS の機能「Personal LINK」(docs/07-positioning.md)
  title: "Personal LINK",
  description: "LINEを教える前に、つながろう。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <DataStream />
        {children}
      </body>
    </html>
  );
}
