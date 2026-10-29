import { NextRequest, NextResponse } from "next/server"

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "")

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const url = new URL(`${API_BASE_URL}/api/v1/${path.map(encodeURIComponent).join("/")}`)
  request.nextUrl.searchParams.forEach((value, key) => url.searchParams.append(key, value))

  const hasBody = !["GET", "HEAD"].includes(request.method)
  const upstream = await fetch(url, {
    method: request.method,
    headers: request.headers.get("content-type") ? { "Content-Type": request.headers.get("content-type")! } : undefined,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
  })

  if (upstream.status === 204) return new NextResponse(null, { status: 204 })
  return new NextResponse(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  })
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
