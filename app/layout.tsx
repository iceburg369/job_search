import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "취업 상황판",
  description: "ranked-jobs.json 기반 공고 평가 · 지원상태 대시보드"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
