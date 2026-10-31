import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RecallNote",
    short_name: "RecallNote",
    description: "업무 경험을 기록하고 다음 목표의 근거로 활용하세요.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f2",
    theme_color: "#f7f7f2",
    icons: [{ src: "/recallnote-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  }
}
