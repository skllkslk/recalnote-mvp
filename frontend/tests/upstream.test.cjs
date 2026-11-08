const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const ts = require("typescript")
const { NextRequest } = require("next/server")
const filename = path.resolve(__dirname, "../src/lib/upstream.ts")
const compiled = new Module(filename, module)
compiled.filename = filename
compiled.paths = Module._nodeModulePaths(path.dirname(filename))
compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
const { upstream } = compiled.exports

test("proxy preserves OAuth redirect and session cookie without following redirect", async () => {
  const original = global.fetch
  global.fetch = async (url, options) => {
    assert.equal(options.redirect, "manual")
    assert.equal(options.cache, "no-store")
    assert.equal(options.headers.get("cookie"), "SESSION=YWJjZA==")
    assert.equal(options.headers.get("x-authenticated-user"), null)
    assert.equal(options.headers.get("authorization"), null)
    assert.equal(options.headers.get("host"), null)
    return new Response(null, { status: 302, headers: {
      Location: "https://accounts.google.com/example",
      "Set-Cookie": "SESSION=new-session; Path=/; HttpOnly; Secure; SameSite=Lax",
    } })
  }
  try {
    const response = await upstream(new NextRequest("https://app.example/auth/login/google", {
      headers: { cookie: "SESSION=YWJjZA==; other=secret", "x-authenticated-user": "victim", authorization: "Bearer fake", host: "attacker.example" },
    }), "/oauth2/authorization/google")
    assert.equal(response.status, 302)
    assert.equal(response.headers.get("location"), "https://accounts.google.com/example")
    assert.match(response.headers.get("set-cookie"), /HttpOnly/)
    assert.equal(response.headers.get("cache-control"), "no-store")
  } finally { global.fetch = original }
})

test("proxy forwards CSRF and body, preserving logout 204", async () => {
  const original = global.fetch
  global.fetch = async (url, options) => {
    assert.equal(options.method, "POST")
    assert.equal(options.headers.get("x-csrf-token"), "token")
    assert.equal(options.headers.get("cookie"), null)
    assert.equal(Buffer.from(options.body).toString(), "{}")
    return new Response(null, { status: 204 })
  }
  try {
    const response = await upstream(new NextRequest("https://app.example/auth/logout", {
      method: "POST", headers: { "x-csrf-token": "token", "content-type": "application/json" }, body: "{}",
    }), "/auth/logout")
    assert.equal(response.status, 204)
    assert.equal(await response.text(), "")
  } finally { global.fetch = original }
})
