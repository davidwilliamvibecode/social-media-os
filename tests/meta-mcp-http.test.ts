import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";

// Testa o endpoint MCP completo (não apenas as funções internas).
const modules = {
  "../src/convex/_generated/api.js": () => import("../src/convex/_generated/api"),
  "../src/convex/http.ts": () => import("../src/convex/http"),
  "../src/convex/metaMcp.ts": () => import("../src/convex/metaMcp"),
  "../src/convex/meta.ts": () => import("../src/convex/meta"),
  "../src/convex/auth.ts": () => import("../src/convex/auth"),
};

async function fixture() {
  const t = convexTest(schema, modules);
  const token = "smos_" + "A".repeat(43);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  const digest = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const ids = await t.run(async (ctx) => {
    const alice = await ctx.db.insert("users", { email: "mcp-a@example.test" });
    const bob = await ctx.db.insert("users", { email: "mcp-b@example.test" });
    await ctx.db.insert("metaMcpKeys", { ownerId: alice, digest, createdAt: Date.now() });
    const mk = async (ownerId: typeof alice, name: string) =>
      ctx.db.insert("clients", {
        ownerId, name, contactName: "", email: "", phone: "",
        website: "", industry: "", packageName: "", monthlyFee: 0,
        startDate: "2026-11-09", status: "Active", socials: {},
        notes: "", onboarding: {}, strategy: [], kpis: [],
        createdAt: Date.now(),
      });
    await mk(alice, "Empresa A");
    await mk(bob, "DADOS-PRIVADOS-EMPRESA-B");
    return { alice, bob };
  });
  return { t, token, ids };
}

describe("Endpoint HTTP /mcp do Social Media OS", () => {
  test("conector permanece indisponível sem ativação explícita", async () => {
    const { t } = await fixture();
    const old = process.env.META_MCP_ENABLED;
    delete process.env.META_MCP_ENABLED;
    try {
      const result = await t.fetch("/mcp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      expect(result.status).toBe(503);
    } finally {
      if (old === undefined) delete process.env.META_MCP_ENABLED;
      else process.env.META_MCP_ENABLED = old;
    }
  });

  test("nega token ausente ou inválido e recusa GET na rota MCP", async () => {
    const { t } = await fixture();
    const old = process.env.META_MCP_ENABLED;
    process.env.META_MCP_ENABLED = "true";
    try {
      const args = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      };
      const unauthenticated = await t.fetch("/mcp", args);
      expect(unauthenticated.status).toBe(401);
      const invalid = await t.fetch("/mcp", {
        ...args, headers: { ...args.headers, authorization: "Bearer smos_" + "B".repeat(43) },
      });
      expect(invalid.status).toBe(401);
      const get = await t.fetch("/mcp", { method: "GET" });
      expect(get.status).toBe(405);
    } finally {
      if (old === undefined) delete process.env.META_MCP_ENABLED;
      else process.env.META_MCP_ENABLED = old;
    }
  });

  test("lista apenas clientes do gestor da chave e não permite agendamento desativado", async () => {
    const { t, token } = await fixture();
    const prevMcp = process.env.META_MCP_ENABLED;
    const prevPublish = process.env.META_PUBLISHING_ENABLED;
    process.env.META_MCP_ENABLED = "true";
    delete process.env.META_PUBLISHING_ENABLED;
    try {
      async function call(id: number, method: string, params?: object) {
        const response = await t.fetch("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + token },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
        });
        expect(response.status).toBe(200);
        return response.json() as Promise<{ result?: { content?: { text: string }[]; isError?: boolean; tools?: unknown[] } }>;
      }

      const init = await call(1, "initialize");
      expect(init.result).toBeDefined();
      const tools = await call(2, "tools/list");
      expect(tools.result?.tools).toBeDefined();

      const clients = await call(3, "tools/call", { name: "list_clients", arguments: {} });
      const output = clients.result?.content?.[0]?.text ?? "";
      expect(output).toContain("Empresa A");
      expect(output).not.toContain("DADOS-PRIVADOS-EMPRESA-B");

      const forbidden = await call(4, "tools/call", {
        name: "schedule_approved",
        arguments: { confirm: true, contentId: "invalid", accountId: "invalid", scheduledAt: Date.now() + 300000 },
      });
      expect(forbidden.result?.isError).toBe(true);
    } finally {
      if (prevMcp === undefined) delete process.env.META_MCP_ENABLED;
      else process.env.META_MCP_ENABLED = prevMcp;
      if (prevPublish === undefined) delete process.env.META_PUBLISHING_ENABLED;
      else process.env.META_PUBLISHING_ENABLED = prevPublish;
    }
  });
});
