import type { Metadata, Viewport } from "next";
import { DataStream } from "@/components/data-stream";
import "./globals.css";

export const metadata: Metadata = {
  title: "PersonalLink",
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
