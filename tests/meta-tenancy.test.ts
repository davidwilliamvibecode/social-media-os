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

describe("Meta multicliente — agendamento seguro", () => {
  /** A flag fica habilitada SOMENTE no teste em memória. Nenhuma chamada externa é feita. */
  async function withPublishingEnabled<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env.META_PUBLISHING_ENABLED;
    process.env.META_PUBLISHING_ENABLED = "true";
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.META_PUBLISHING_ENABLED;
      else process.env.META_PUBLISHING_ENABLED = previous;
    }
  }

  test("agendar e cancelar mantém snapshot e devolve conteúdo a Aprovado", async () => {
    await withPublishingEnabled(async () => {
      const { alice, t, ids } = await setup();
      const when = Date.now() + 60 * 60_000;
      const postId = await alice.mutation(api.meta.schedulePost, {
        contentId: ids.content, accountId: ids.account, scheduledAt: when,
      });
      const row = await t.run(ctx => ctx.db.get(postId));
      expect(row?.status).toBe("scheduled");
      expect(row?.targetPageId).toBe("123456789");
      expect(row?.scheduledJobId).toBeDefined();
      expect((await t.run(ctx => ctx.db.get(ids.content)))?.status).toBe("Scheduled");

      await alice.mutation(api.meta.cancelPost, { postId });
      const updated = await t.run(ctx => ctx.db.get(postId));
      expect(updated?.status).toBe("cancelled");
      expect((await t.run(ctx => ctx.db.get(ids.content)))?.status).toBe("Approved");
    });
  });

  test("não permite programar publicação para conta de outra empresa", async () => {
    await withPublishingEnabled(async () => {
      const { alice, t, ids } = await setup();
      const foreignAccount = await t.run(ctx => ctx.db.insert("metaAccounts", {
        ownerId: ids.alice,
        clientId: ids.aliceOtherClient,
        pageId: "99999888888",
        pageName: "Outra empresa",
        encryptedToken: "cifra-teste",
        connectedAt: Date.now(),
        status: "active",
      }));
      await expect(alice.mutation(api.meta.schedulePost, {
        contentId: ids.content, accountId: foreignAccount,
        scheduledAt: Date.now() + 100000,
      })).rejects.toThrow("sem acesso");
    });
  });

  test("alteração de Página após agendamento bloqueia publicação no destino trocado", async () => {
    await withPublishingEnabled(async () => {
      const { alice, t, ids } = await setup();
      const postId = await alice.mutation(api.meta.schedulePost, {
        contentId: ids.content, accountId: ids.account,
        scheduledAt: Date.now() + 100000,
      });
      await t.run(async (ctx) => {
        await ctx.db.patch(ids.account, { pageId: "77777888888" });
        // Em teste, antecipa apenas a verificação do job (sem Graph API).
        await ctx.db.patch(postId, { scheduledAt: Date.now() - 1000 });
      });
      const result = await t.mutation(internal.meta.claimPost, { postId });
      expect(result).toBeNull();
      const row = await t.run(ctx => ctx.db.get(postId));
      expect(row?.status).toBe("failed");
      expect(row?.lastError).toContain("Vínculo");
    });
  });

  test("desconectar revoga credencial sem preservar o token criptografado", async () => {
    const { alice, t, ids } = await setup();
    await alice.mutation(api.meta.disconnectAccount, { accountId: ids.account });
    const account = await t.run(ctx => ctx.db.get(ids.account));
    expect(account?.status).toBe("revoked");
    expect(account?.encryptedToken).toBe("");
  });

  test("limpa estados OAuth e tokens temporários vencidos", async () => {
    const { t, ids } = await setup();
    const expired = await t.run(async (ctx) => {
      const candidate = await ctx.db.insert("metaCandidates", {
        ownerId: ids.alice, clientId: ids.aliceClient,
        pageId: "3333344444", pageName: "Expirada",
        encryptedToken: "cifra",
        expiresAt: Date.now() - 1000,
      });
      const state = await ctx.db.insert("metaOAuthStates", {
        ownerId: ids.alice, clientId: ids.aliceClient,
        digest: "digest-teste-unico",
        expiresAt: Date.now() - 1000,
      });
      return { candidate, state };
    });
    expect(await t.mutation(internal.meta.cleanupExpiredConnections, {}))
      .toEqual({ candidates: 1, states: 1 });
    const after = await t.run(async (ctx) => ({
      candidate: await ctx.db.get(expired.candidate),
      state: await ctx.db.get(expired.state),
      stillValid: await ctx.db.get(ids.candidate),
    }));
    expect(after.candidate).toBeNull();
    expect(after.state).toBeNull();
    expect(after.stillValid).not.toBeNull();
  });
});
