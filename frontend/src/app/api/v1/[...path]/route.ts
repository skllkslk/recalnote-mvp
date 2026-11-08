import { NextRequest } from "next/server"
import { upstream } from "@/lib/upstream"

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  return upstream(request, `/api/v1/${path.map(encodeURIComponent).join("/")}`)
}
export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
