import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "RecallNote",
  applicationName: "RecallNote",
  description: "업무 경험을 기록하고 다음 목표의 근거로 활용하세요.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "RecallNote" },
  icons: { icon: "/recallnote-icon.svg", apple: "/recallnote-icon.svg" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#090c17",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>
}
