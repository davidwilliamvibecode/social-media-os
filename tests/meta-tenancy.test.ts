import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api, internal } from "../src/convex/_generated/api";
import schema from "../src/convex/schema";
import { signedIdentity } from "./identity";

const modules = {
  "../src/convex/_generated/api.js": () => import("../src/convex/_generated/api"),
  "../src/convex/meta.ts": () => import("../src/convex/meta"),
  "../src/convex/metaMcp.ts": () => import("../src/convex/metaMcp"),
  "../src/convex/portal.ts": () => import("../src/convex/portal"),
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const alice = await ctx.db.insert("users", { email: "alice@teste.com" });
    const bob = await ctx.db.insert("users", { email: "bob@teste.com" });
    const client = (ownerId: typeof alice, name: string) => ({
      ownerId, name, contactName: "", email: "", phone: "", website: "",
      industry: "", packageName: "", monthlyFee: 0, startDate: "2026-11-08",
      status: "Active", socials: {}, notes: "", onboarding: {},
      strategy: [], kpis: [], createdAt: Date.now(),
    });
    const aliceClient = await ctx.db.insert("clients", client(alice, "Alice empresa"));
    const aliceOtherClient = await ctx.db.insert("clients", client(alice, "Alice outra"));
    const bobClient = await ctx.db.insert("clients", client(bob, "Bob empresa"));
    const candidate = await ctx.db.insert("metaCandidates", {
      ownerId: alice, clientId: aliceClient, pageId: "123456789",
      pageName: "Página Alice", encryptedToken: "fake-token-test",
      expiresAt: Date.now() + 60000,
    });
    const account = await ctx.db.insert("metaAccounts", {
      ownerId: alice, clientId: aliceClient, pageId: "123456789",
      pageName: "Página Alice", encryptedToken: "fake-token-test",
      connectedAt: Date.now(), status: "active",
    });
    const content = await ctx.db.insert("content", {
      ownerId: alice, clientId: aliceClient, date: "2026-11-08",
      platform: "Facebook", format: "Single post",
      topic: "Teste", caption: "Aprovado", assetNote: "",
      status: "Approved", managerNotes: "", clientComments: "",
      pillar: "Promotion", owner: "",
    });
    return { alice, bob, aliceClient, aliceOtherClient, bobClient, candidate, account, content };
  });
  return {
    t, ids,
    alice: await signedIdentity(t, ids.alice),
    bob: await signedIdentity(t, ids.bob),
  };
}

describe("Meta multicliente — isolamento", () => {
  test("gestor B não enxerga contas Meta ou conteúdos aprovados do gestor A", async () => {
    const { bob, alice, ids } = await setup();
    expect(await bob.query(api.meta.listAccounts, { clientId: ids.aliceClient })).toEqual([]);
    expect(await bob.query(api.meta.listCandidates, { clientId: ids.aliceClient })).toEqual([]);
    expect(await bob.query(api.meta.listPosts, { clientId: ids.aliceClient })).toEqual([]);
    expect((await alice.query(api.meta.listAccounts, { clientId: ids.aliceClient })).length).toBe(1);
    await expect(
      bob.mutation(api.meta.selectAccount, { candidateId: ids.candidate }),
    ).rejects.toThrow("Conexão não disponível.");
  });

  test("Página da empresa A não pode ser vinculada a outra empresa do mesmo gestor", async () => {
    const { t, alice, ids } = await setup();
    const otherCandidate = await t.run(ctx => ctx.db.insert("metaCandidates", {
      ownerId: ids.alice, clientId: ids.aliceOtherClient, pageId: "123456789",
      pageName: "Página Alice", encryptedToken: "fake",
      expiresAt: Date.now() + 60000,
    }));
    await expect(
      alice.mutation(api.meta.selectAccount, { candidateId: otherCandidate }),
    ).rejects.toThrow("já está associada a outro cliente");
  });

  test("agendamento não publica nada enquanto feature flag estiver desativada", async () => {
    const { alice, ids } = await setup();
    const old = process.env.META_PUBLISHING_ENABLED;
    delete process.env.META_PUBLISHING_ENABLED;
    try {
      await expect(
        alice.mutation(api.meta.schedulePost, {
          contentId: ids.content, accountId: ids.account,
          scheduledAt: Date.now() + 100000,
        }),
      ).rejects.toThrow("desativadas");
    } finally {
      if (old === undefined) delete process.env.META_PUBLISHING_ENABLED;
      else process.env.META_PUBLISHING_ENABLED = old;
    }
  });

  test("ferramentas internas MCP validam owner/client, sem retornar dados de terceiros", async () => {
    const { t, ids } = await setup();
    await expect(t.query(internal.metaMcp.accountSummary, {
      ownerId: ids.bob, clientId: ids.aliceClient,
    })).rejects.toThrow("Cliente não encontrado.");
  });
});
