import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { internal } from "../src/convex/_generated/api";
import schema from "../src/convex/schema";

const modules = {
  "../src/convex/_generated/api.js": () => import("../src/convex/_generated/api"),
  "../src/convex/metaMcp.ts": () => import("../src/convex/metaMcp"),
  "../src/convex/meta.ts": () => import("../src/convex/meta"),
};

const fingerprint = "x".repeat(43);

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "duas-ias@teste.com" });
    const stranger = await ctx.db.insert("users", { email: "outro-gestor@teste.com" });
    const makeClient = async (ownerId: typeof owner, name: string) => ctx.db.insert("clients", {
      ownerId, name, contactName: "", email: "", phone: "", website: "",
      industry: "", packageName: "", monthlyFee: 0, startDate: "2026-11-09",
      status: "Active", socials: {}, notes: "", onboarding: {},
      strategy: [], kpis: [], createdAt: Date.now(),
    });
    const clientId = await makeClient(owner, "Cliente A");
    const strangerClient = await makeClient(stranger, "Cliente B");
    const accountId = await ctx.db.insert("metaAccounts", {
      ownerId: owner, clientId, pageId: "123456789", pageName: "Teste",
      encryptedToken: "ciphertext-ficticio", connectedAt: Date.now(), status: "active",
    });
    return { owner, stranger, clientId, strangerClient, accountId };
  });
  return { t, ids };
}

describe("Conector MCP — Claude e ChatGPT independentes", () => {
  test("criar chave ChatGPT não revoga Claude; renovar Claude preserva ChatGPT", async () => {
    const { t, ids } = await fixture();
    await t.mutation(internal.metaMcp.persistKey, {
      ownerId: ids.owner, digest: "claude1", provider: "claude",
    });
    await t.mutation(internal.metaMcp.persistKey, {
      ownerId: ids.owner, digest: "chatgpt1", provider: "chatgpt",
    });
    expect((await t.query(internal.metaMcp.validateKey, { digest: "claude1" }))?.provider)
      .toBe("claude");
    expect((await t.query(internal.metaMcp.validateKey, { digest: "chatgpt1" }))?.provider)
      .toBe("chatgpt");

    await t.mutation(internal.metaMcp.persistKey, {
      ownerId: ids.owner, digest: "claude2", provider: "claude",
    });
    expect(await t.query(internal.metaMcp.validateKey, { digest: "claude1" })).toBeNull();
    expect((await t.query(internal.metaMcp.validateKey, { digest: "claude2" }))?.provider)
      .toBe("claude");
    expect((await t.query(internal.metaMcp.validateKey, { digest: "chatgpt1" }))?.provider)
      .toBe("chatgpt");
  });

  test("chaves antigas não identificadas não autenticam na central multi-IA", async () => {
    const { t, ids } = await fixture();
    await t.run(ctx => ctx.db.insert("metaMcpKeys", {
      ownerId: ids.owner, digest: "legacy", createdAt: Date.now(),
    }));
    expect(await t.query(internal.metaMcp.validateKey, { digest: "legacy" })).toBeNull();
  });

  test("duas IAs criando o mesmo rascunho quase simultaneamente obtêm o mesmo conteúdo", async () => {
    const { t, ids } = await fixture();
    const values = {
      ownerId: ids.owner, clientId: ids.clientId,
      platform: "Facebook" as const, format: "Single post" as const,
      topic: "Comunicado", caption: "Texto aprovado depois", assetNote: "",
      fingerprint,
    };
    const claude = await t.mutation(internal.metaMcp.createDraft, {
      ...values, provider: "claude", commandId: "claude-001",
    });
    const chatgpt = await t.mutation(internal.metaMcp.createDraft, {
      ...values, provider: "chatgpt", commandId: "chatgpt-001",
    });
    expect(chatgpt.contentId).toBe(claude.contentId);
    expect(chatgpt.repeated).toBe(true);
    const again = await t.mutation(internal.metaMcp.createDraft, {
      ...values, provider: "claude", commandId: "claude-001",
    });
    expect(again.contentId).toBe(claude.contentId);
    expect(again.repeated).toBe(true);
    const data = await t.run(async (ctx) => ({
      content: await ctx.db.query("content").collect(),
      operations: await ctx.db.query("metaAiOperations").collect(),
    }));
    expect(data.content).toHaveLength(1);
    expect(data.operations).toHaveLength(2);
    expect(data.operations.map(o => o.provider).sort()).toEqual(["chatgpt", "claude"]);
  });

  test("reutilizar commandId com dados diferentes é rejeitado", async () => {
    const { t, ids } = await fixture();
    const values = {
      ownerId: ids.owner, clientId: ids.clientId, provider: "claude" as const,
      commandId: "comando-fixo", fingerprint,
      platform: "Facebook" as const, format: "Single post" as const,
      topic: "Original", caption: "Texto", assetNote: "",
    };
    await t.mutation(internal.metaMcp.createDraft, values);
    await expect(t.mutation(internal.metaMcp.createDraft, {
      ...values, fingerprint: "y".repeat(43), topic: "Alterado",
    })).rejects.toThrow("já foi utilizado");
  });

  test("aprovado pode ser agendado somente uma vez mesmo com duas IAs", async () => {
    const { t, ids } = await fixture();
    const draft = await t.run(ctx => ctx.db.insert("content", {
      ownerId: ids.owner, clientId: ids.clientId, date: "2026-11-09",
      platform: "Facebook", format: "Single post", topic: "Teste",
      caption: "Legenda", assetNote: "", status: "Approved", managerNotes: "",
      clientComments: "", pillar: "Promotion", owner: "",
    }));
    const old = process.env.META_PUBLISHING_ENABLED;
    process.env.META_PUBLISHING_ENABLED = "true";
    try {
      const data = {
        ownerId: ids.owner, contentId: draft, accountId: ids.accountId,
        scheduledAt: Date.now() + 7200000, fingerprint,
      };
      const a = await t.mutation(internal.metaMcp.scheduleFromMcp, {
        ...data, provider: "claude", commandId: "schedule-001",
      });
      const again = await t.mutation(internal.metaMcp.scheduleFromMcp, {
        ...data, provider: "chatgpt", commandId: "schedule-001",
      });
      expect(again.postId).toBe(a.postId);
      await expect(t.mutation(internal.metaMcp.scheduleFromMcp, {
        ...data, provider: "chatgpt", commandId: "schedule-002",
      })).rejects.toThrow("ainda não aprovado");
      expect((await t.run(ctx => ctx.db.query("metaPosts").collect())).length).toBe(1);
    } finally {
      if (old === undefined) delete process.env.META_PUBLISHING_ENABLED;
      else process.env.META_PUBLISHING_ENABLED = old;
    }
  });

  test("conta da outra empresa não pode criar conteúdo via IA", async () => {
    const { t, ids } = await fixture();
    await expect(t.mutation(internal.metaMcp.createDraft, {
      ownerId: ids.owner, clientId: ids.strangerClient, provider: "chatgpt",
      commandId: "tentativa-001", fingerprint,
      platform: "Instagram", format: "Single post",
      topic: "Não autorizado", caption: "Texto", assetNote: "",
    })).rejects.toThrow("Cliente não encontrado");
  });
});
