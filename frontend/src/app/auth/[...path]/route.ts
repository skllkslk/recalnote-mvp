import { NextRequest, NextResponse } from "next/server"
import { upstream } from "@/lib/upstream"

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join("/")
  const target = request.method === "GET" ? {
    "login/google": "/oauth2/authorization/google",
    "callback/google": "/login/oauth2/code/google",
    "csrf": "/auth/csrf",
  }[path] : request.method === "POST" && path === "logout" ? "/auth/logout" : undefined
  if (!target) return new NextResponse(null, { status: 404 })
  return upstream(request, target)
}
export const GET = forward
export const POST = forward
