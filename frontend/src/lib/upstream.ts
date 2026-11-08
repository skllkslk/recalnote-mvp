import { NextRequest, NextResponse } from "next/server"

const base = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "")

export async function upstream(request: NextRequest, path: string) {
  const url = new URL(`${base}${path}`)
  url.search = request.nextUrl.search
  const headers = new Headers()
  for (const name of ["content-type", "x-csrf-token"]) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const session = request.cookies.get("SESSION")
  if (session && /^[A-Za-z0-9+/_=-]+$/.test(session.value)) headers.set("cookie", `SESSION=${session.value}`)
  const response = await fetch(url, {
    method: request.method, headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    cache: "no-store", redirect: "manual",
  })
  const outgoing = new Headers({ "Cache-Control": "no-store" })
  const contentType = response.headers.get("content-type")
  if (contentType) outgoing.set("Content-Type", contentType)
  const location = response.headers.get("location")
  if (location) outgoing.set("Location", location)
  for (const cookie of response.headers.getSetCookie()) {
    if (cookie.startsWith("SESSION=")) outgoing.append("Set-Cookie", cookie)
  }
  return new NextResponse([204, 304].includes(response.status) ? null : await response.arrayBuffer(), {
    status: response.status, headers: outgoing,
  })
}
