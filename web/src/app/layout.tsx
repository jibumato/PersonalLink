import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PersonalLink",
  description: "LINEを教える前に、つながろう。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 実機のPasskeyダイアログ表示中に意図せずズームしないよう、拡大は許可しつつ初期値を固定する
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
