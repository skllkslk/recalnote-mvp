import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "RecallNote",
  description: "업무 경험을 기록하고 다음 목표의 근거로 활용하세요.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>
}
