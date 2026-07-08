import type { Metadata } from "next";
import "./globals.css";
import AppShell from "./components/AppShell";
import RandomEventModal from "./components/RandomEventModal";

export const metadata: Metadata = {
  title: "무명 — 가상 주식 거래소",
  description: "웹소설과 연계된 가상 주식 거래 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className="h-full antialiased"
    >
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
        <RandomEventModal />
      </body>
    </html>
  );
}
