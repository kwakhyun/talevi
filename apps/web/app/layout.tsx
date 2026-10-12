import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "테일비 Talevi — 취향이 되는 첫 대화",
  description:
    "서로 다른 매력을 가진 캐릭터와 나누는 나만의 이야기. 당신의 말이 기억이 되고, 우리의 이야기가 됩니다.",
  icons: {
    icon: [
      { url: "/brand/talevi-icon.svg", type: "image/svg+xml" },
      { url: "/brand/talevi-icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/brand/talevi-icon-180.png", sizes: "180x180" },
  },
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111216",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
