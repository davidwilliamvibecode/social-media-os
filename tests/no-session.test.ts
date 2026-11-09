// Testes de "porta aberta" do Social Media OS: todas as funções que o cliente
// alcança **sem sessão** e a garantia de que nenhuma delas devolve dado de
// usuário.
//
// O teste tem duas partes:
//
//  1. **Inventário** — percorre os módulos de funções do Convex e exige que
//     toda função exportada esteja classificada aqui (aberta, com sessão ou
//     interna). Se alguém adicionar uma função nova e esquecer de classificá-la,
//     a suíte falha com o nome dela.
//  2. **Comportamento** — com um espaço de trabalho cheio de dados "marcados"
//     (contendo o texto `SEGREDO-DA-CONTA`), chama cada rota sem sessão e
//     confere: leitura não vaza nada, escrita é recusada e o banco não muda.
//
// Rode com: bun test

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { readdirSync } from "node:fs";

import { api } from "../src/convex/_generated/api";
import schema from "../src/convex/schema";

// Caminhos relativos a este arquivo; a entrada em `_generated` é o que permite
// ao harness descobrir a raiz do diretório de funções. A descoberta automática
// impede que um módulo novo fique fora do inventário de segurança.
const modules: Record<string, () => Promise<any>> = {
  "../src/convex/_generated/api.js": () =>
    import("../src/convex/_generated/api"),
};
const MODULES: Record<string, Record<string, unknown>> = {};
for (const file of readdirSync(new URL("../src/convex/", import.meta.url))) {
  if (!file.endsWith(".ts")) continue;
  const path = `../src/convex/${file}`;
  const load = () => import(path);
  modules[path] = load;
  MODULES[file.slice(0, -3)] = await load();
}

const SENTINEL = "SEGREDO-DA-CONTA";

// ---- inventário de rotas ---------------------------------------------------

type Kind = "query" | "mutation" | "action";

interface Route {
  name: string; // "portal:listClients"
  module: string;
  exportName: string;
  kind: Kind;
  visibility: "public" | "internal";
}

function allRoutes(): Route[] {
  const routes: Route[] = [];
  for (const [moduleName, namespace] of Object.entries(MODULES)) {
    for (const [exportName, value] of Object.entries(namespace)) {
      const fn = value as {
        isQuery?: boolean;
        isMutation?: boolean;
        isAction?: boolean;
        isPublic?: boolean;
        isInternal?: boolean;
      } | null;
      // O builder do Convex devolve uma função com metadados anexados.
      if (!fn || (typeof fn !== "object" && typeof fn !== "function")) continue;

      const kind: Kind | null = fn.isQuery
        ? "query"
        : fn.isMutation
          ? "mutation"
          : fn.isAction
            ? "action"
            : null;
      if (!kind) continue;

      routes.push({
        name: `${moduleName}:${exportName}`,
        module: moduleName,
        exportName,
        kind,
        visibility: fn.isInternal === true ? "internal" : "public",
      });
    }
  }
  return routes;
}

/**
 * Consultas que respondem sem sessão, sem devolver dados de usuário.
 */
const OPEN_QUERIES: Record<string, unknown> = {
  "auth:isAuthenticated": false,
};

/**
 * Ações que respondem sem sessão: o próprio login/logout, por definição.
 */
const OPEN_ACTIONS = ["auth:signIn", "auth:signOut"];

/** Tudo que devolve vazio/nulo sem sessão. */
const SESSION_QUERIES: Record<string, unknown> = {
  "portal:getWorkspace": null,
  "portal:exportWorkspace": null,
  "portal:listClients": [],
  "portal:listContent": [],
  "portal:listTasks": [],
  "portal:listRequests": [],
  "portal:listMeetings": [],
  "portal:listDeliverables": [],
  "portal:listFinance": [],
  "meta:listCandidates": [],
  "meta:listAccounts": [],
  "meta:listPosts": [],
  "metaMcp:listKeys": [],
  "metaMcp:listOperations": [],
  "users:currentUser": null,
};

/** Tudo que exige sessão para escrever. */
const SESSION_MUTATIONS = [
  "portal:saveWorkspace",
  "portal:createClient",
  "portal:updateClient",
  "portal:removeClient",
  "portal:createContent",
  "portal:updateContent",
  "portal:removeContent",
  "portal:createTask",
  "portal:updateTask",
  "portal:removeTask",
  "portal:createRequest",
  "portal:updateRequest",
  "portal:removeRequest",
  "portal:createMeeting",
  "portal:updateMeeting",
  "portal:removeMeeting",
  "portal:createDeliverable",
  "portal:updateDeliverable",
  "portal:removeDeliverable",
  "portal:createFinance",
  "portal:updateFinance",
  "portal:removeFinance",
  "portal:generateInvoices",
  "portal:markFinancePaid",
  "portal:clearWorkspace",
  "portal:importWorkspace",
  "demo:seedDemo",
  "meta:selectAccount",
  "meta:disconnectAccount",
  "meta:schedulePost",
  "meta:cancelPost",
  "metaMcp:revokeKey",
];

/** Nunca chamáveis pelo cliente (o Convex recusa antes de executar). */
const INTERNAL: Record<string, Kind> = {
  "access:createInvite": "mutation",
  "access:sendInvite": "action",
  "access:recoveryAccount": "query",
  "access:storeRecovery": "mutation",
  "access:consumeRecovery": "mutation",
  "audit:reportStoredDataIssues": "query",
  "auth:store": "mutation",
  "repair:relinkOrphanInvoices": "mutation",
  "sessions:cleanupInactiveSessions": "mutation",
  "meta:verifyClient": "query",
  "meta:reserveState": "mutation",
  "meta:redeemState": "mutation",
  "meta:saveCandidates": "mutation",
  "meta:claimPost": "mutation",
  "meta:completePost": "mutation",
  "meta:deliverPost": "action",
  "meta:cleanupExpiredConnections": "mutation",
  "metaMcp:identifyUser": "query",
  "metaMcp:persistKey": "mutation",
  "metaMcp:validateKey": "query",
  "metaMcp:clientSummary": "query",
  "metaMcp:approvedSummary": "query",
  "metaMcp:accountSummary": "query",
  "metaMcp:scheduledSummary": "query",
  "metaMcp:createDraft": "mutation",
  "metaMcp:scheduleFromMcp": "mutation",
};

const SESSION_ACTIONS = ["access:issueRecoveryCode", "meta:startConnection", "metaMcp:issueKey"];

const CLASSIFIED = new Set([
  ...SESSION_ACTIONS,
  ...Object.keys(OPEN_QUERIES),
  ...OPEN_ACTIONS,
  ...Object.keys(SESSION_QUERIES),
  ...SESSION_MUTATIONS,
  ...Object.keys(INTERNAL),
]);

function reference(route: Route) {
  return (api as unknown as Record<string, Record<string, unknown>>)[
    route.module
  ][route.exportName];
}

async function callWithoutSession(
  t: ReturnType<typeof convexTest>,
  name: string,
  args?: Record<string, unknown>,
) {
  const [moduleName, exportName] = name.split(":");
  const [route] = allRoutes().filter(
    (r) => r.module === moduleName && r.exportName === exportName,
  );
  const fn = reference(route) as any;
  if (route.kind === "query") return await t.query(fn, args as any);
  if (route.kind === "mutation") return await t.mutation(fn, args as any);
  return await t.action(fn, args as any);
}

// ---- espaço de trabalho marcado ------------------------------------------

const today = "2026-09-30";

async function seededWorkspace() {
  const t = convexTest(schema, modules);

  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "dona@exemplo.com" });
    const client = await ctx.db.insert("clients", {
      ownerId: owner,
      name: SENTINEL,
      contactName: SENTINEL,
      email: "contato@exemplo.com",
      phone: "",
      website: "",
      industry: "",
      packageName: "Mensalidade",
      monthlyFee: 1000,
      startDate: today,
      status: "Active",
      socials: {},
      notes: SENTINEL,
      onboarding: {},
      strategy: [],
      kpis: [],
      createdAt: Date.now(),
    });

    const content = await ctx.db.insert("content", {
      ownerId: owner,
      clientId: client,
      date: today,
      platform: "Instagram",
      format: "Reel",
      topic: SENTINEL,
      caption: SENTINEL,
      assetNote: "",
      status: "Idea",
      managerNotes: "",
      clientComments: "",
      pillar: "Education",
      owner: SENTINEL,
    });
    const task = await ctx.db.insert("tasks", {
      ownerId: owner,
      clientId: client,
      title: SENTINEL,
      project: "",
      category: "",
      priority: "Medium",
      status: "Backlog",
      startDate: today,
      dueDate: today,
      completedAt: "",
      dependsOn: "",
      notes: "",
    });
    const request = await ctx.db.insert("requests", {
      ownerId: owner,
      clientId: client,
      title: SENTINEL,
      category: "",
      priority: "Medium",
      dateSubmitted: today,
      status: "New",
      assignedTo: "",
      dueDate: today,
      comments: "",
    });
    const meeting = await ctx.db.insert("meetings", {
      ownerId: owner,
      clientId: client,
      title: SENTINEL,
      date: today,
      time: "10:00",
      agenda: "",
      participants: "",
      status: "Scheduled",
      notes: "",
      actionItems: "",
    });
    const deliverable = await ctx.db.insert("deliverables", {
      ownerId: owner,
      clientId: client,
      name: SENTINEL,
      category: "",
      description: "",
      date: today,
      status: "Shared",
      relatedContent: "",
      relatedProject: "",
    });
    const finance = await ctx.db.insert("finance", {
      ownerId: owner,
      clientId: client,
      date: today,
      type: "Income",
      amount: 100,
      category: "Retainer",
      description: SENTINEL,
      status: "Pending",
      dueDate: today,
      paidDate: "",
    });
    await ctx.db.insert("workspaces", {
      ownerId: owner,
      managerName: SENTINEL,
      agency: SENTINEL,
      email: "dona@exemplo.com",
      currency: "R$",
      weekStart: "Monday",
      approvalTurnaroundDays: 3,
      notifyEmail: true,
      notifyApprovals: true,
      notifyFinance: false,
      density: "comfortable",
    });

    const candidate = await ctx.db.insert("metaCandidates", {
      ownerId: owner,
      clientId: client,
      pageId: "123456789",
      pageName: SENTINEL,
      encryptedToken: "cifra-de-teste",
      expiresAt: Date.now() + 30_000,
    });
    const account = await ctx.db.insert("metaAccounts", {
      ownerId: owner,
      clientId: client,
      pageId: "123456789",
      pageName: SENTINEL,
      encryptedToken: "cifra-de-teste",
      connectedAt: Date.now(),
      status: "active",
    });
    const mcpKey = await ctx.db.insert("metaMcpKeys", {
      ownerId: owner, digest: "test-mcp-digest", createdAt: Date.now(),
    });
    const metaPost = await ctx.db.insert("metaPosts", {
      ownerId: owner,
      clientId: client,
      contentId: content,
      accountId: account,
      platform: "Facebook",
      format: "text",
      caption: SENTINEL,
      scheduledAt: Date.now() + 100_000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "scheduled",
    });

    return {
      owner,
      client,
      content,
      candidate,
      account,
      metaPost,
      mcpKey,
      task,
      request,
      meeting,
      deliverable,
      finance,
    };
  });

  return { t, ids };
}

type SeededIds = Awaited<ReturnType<typeof seededWorkspace>>["ids"];

/** Instantâneo de tudo que é dado de usuário, para provar que nada mudou. */
async function snapshot(t: ReturnType<typeof convexTest>) {
  const tables = [
    "users",
    "clients",
    "content",
    "tasks",
    "requests",
    "meetings",
    "deliverables",
    "finance",
    "workspaces",
    "turnstileGrants",
    "metaOAuthStates",
    "metaCandidates",
    "metaAccounts",
    "metaPosts",
    "metaMcpKeys",
  ] as const;

  return await t.run(async (ctx) => {
    const dump: Record<string, unknown[]> = {};
    for (const table of tables) {
      dump[table] = await ctx.db.query(table as any).collect();
    }
    return dump;
  });
}

/** Argumentos **válidos** para cada escrita, apontando para dados da conta alheia. */
function writeArgs(
  name: string,
  ids: SeededIds,
  sentinel: string,
): Record<string, unknown> {
  const patch = { name: sentinel, topic: sentinel, title: sentinel };
  const table: Record<string, Record<string, unknown>> = {
    "portal:saveWorkspace": { patch: { managerName: sentinel } },
    "portal:createClient": { data: { name: sentinel } },
    "portal:updateClient": { id: ids.client, patch },
    "portal:removeClient": { id: ids.client },

    "portal:createContent": { data: { topic: sentinel, clientId: ids.client } },
    "portal:updateContent": { id: ids.content, patch },
    "portal:removeContent": { id: ids.content },

    "portal:createTask": { data: { title: sentinel, clientId: ids.client } },
    "portal:updateTask": { id: ids.task, patch },
    "portal:removeTask": { id: ids.task },

    "portal:createRequest": { data: { title: sentinel, clientId: ids.client } },
    "portal:updateRequest": { id: ids.request, patch },
    "portal:removeRequest": { id: ids.request },

    "portal:createMeeting": { data: { title: sentinel, clientId: ids.client } },
    "portal:updateMeeting": { id: ids.meeting, patch },
    "portal:removeMeeting": { id: ids.meeting },

    "portal:createDeliverable": {
      data: { name: sentinel, clientId: ids.client },
    },
    "portal:updateDeliverable": { id: ids.deliverable, patch },
    "portal:removeDeliverable": { id: ids.deliverable },

    "portal:createFinance": {
      data: { description: sentinel, clientId: ids.client },
    },
    "portal:updateFinance": { id: ids.finance, patch },
    "portal:removeFinance": { id: ids.finance },

    "portal:generateInvoices": { months: 2 },
    "portal:markFinancePaid": { id: ids.finance },
    "portal:clearWorkspace": {},
    "portal:importWorkspace": { snapshot: {} },
    "demo:seedDemo": {},
    "access:issueRecoveryCode": { password: "test-only-password" },
    "meta:startConnection": { clientId: ids.client },
    "meta:selectAccount": { candidateId: ids.candidate },
    "meta:disconnectAccount": { accountId: ids.account },
    "meta:schedulePost": { contentId: ids.content, accountId: ids.account, scheduledAt: Date.now() + 100_000 },
    "meta:cancelPost": { postId: ids.metaPost },
    "metaMcp:revokeKey": { id: ids.mcpKey },
    "metaMcp:issueKey": {},
  };

  const args = table[name];
  if (!args) throw new Error(`Sem argumentos de teste para ${name}`);
  return args;
}

const realConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

beforeEach(() => {
  // O Convex Auth loga em INFO a cada `auth:store`; silenciamos o ruído.
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
});

afterEach(() => {
  console.log = realConsole.log;
  console.info = realConsole.info;
  console.warn = realConsole.warn;
  console.error = realConsole.error;
});

// ---- 1. inventário ---------------------------------------------------------

describe("inventário da API", () => {
  test("toda função exportada está classificada neste teste", () => {
    const routes = allRoutes();
    expect(routes.length).toBeGreaterThan(0);

    const unclassified = routes
      .filter((route) => !CLASSIFIED.has(route.name))
      .map((route) => route.name);
    expect(unclassified).toEqual([]);

    const known = new Set(routes.map((route) => route.name));
    const stale = [...CLASSIFIED].filter((name) => !known.has(name));
    expect(stale).toEqual([]);
  });

  test("a classificação bate com a visibilidade real das funções", () => {
    const routes = allRoutes();
    const byName = new Map(routes.map((route) => [route.name, route]));

    for (const name of Object.keys(INTERNAL)) {
      const route = byName.get(name);
      expect(route).toBeDefined();
      expect(route?.visibility).toBe("internal");
      expect(route?.kind).toBe(INTERNAL[name]);
    }

    const declaredOpen = [...Object.keys(OPEN_QUERIES), ...OPEN_ACTIONS];
    for (const route of routes) {
      if (route.visibility === "internal") continue;
      if (declaredOpen.includes(route.name)) continue;
      // Todo o resto é rota com sessão: existe em SESSION_QUERIES ou SESSION_MUTATIONS.
      const known =
        route.name in SESSION_QUERIES ||
        SESSION_MUTATIONS.includes(route.name) ||
        SESSION_ACTIONS.includes(route.name);
      expect(known, `${route.name} não está nas listas "com sessão"`).toBe(
        true,
      );
    }

    // Nenhuma função interna pode estar declarada como aberta.
    for (const name of [...Object.keys(OPEN_QUERIES), ...OPEN_ACTIONS]) {
      expect(byName.get(name)?.visibility).toBe("public");
    }
  });
});

// ---- 2. comportamento sem sessão ------------------------------------------

describe("sem sessão: leitura", () => {
  test("as consultas abertas não devolvem dado de usuário", async () => {
    const { t } = await seededWorkspace();

    for (const [name, expected] of Object.entries(OPEN_QUERIES)) {
      const result = await callWithoutSession(t, name);
      expect(result, name).toEqual(expected);
      expect(JSON.stringify(result), name).not.toContain(SENTINEL);
    }
  });

  test("as consultas com sessão devolvem vazio/nulo", async () => {
    const { t } = await seededWorkspace();

    for (const [name, expected] of Object.entries(SESSION_QUERIES)) {
      const args = name.startsWith("meta:") ? { clientId: (await t.run(async ctx => (await ctx.db.query("clients").first())?._id)) } : undefined;
      const result = await callWithoutSession(t, name, args);
      expect(result, name).toEqual(expected);
      expect(JSON.stringify(result), name).not.toContain(SENTINEL);
    }
  });

  test("as ações abertas não devolvem dado de usuário", async () => {
    const { t } = await seededWorkspace();
    const before = await snapshot(t);

    // `isAuthenticated`/`signOut` são de sessão; nada de dado de usuário sai.
    expect(await callWithoutSession(t, "auth:isAuthenticated")).toBe(false);
    // Ação sem retorno; o Convex serializa `undefined` como `null`.
    expect(await callWithoutSession(t, "auth:signOut")).toBeNull();

    // `signIn` com provider inexistente é recusado antes de qualquer escrita.
    await expect(
      callWithoutSession(t, "auth:signIn", {
        provider: "provider-que-nao-existe",
        params: {},
      }),
    ).rejects.toThrow();

    expect(await snapshot(t)).toEqual(before);
  });
});

describe("sem sessão: escrita", () => {
  test("toda mutation com sessão é recusada e nada muda no banco", async () => {
    const { t, ids } = await seededWorkspace();
    const before = await snapshot(t);

    for (const name of [...SESSION_MUTATIONS, ...SESSION_ACTIONS]) {
      await expect(
        callWithoutSession(t, name, writeArgs(name, ids, SENTINEL)),
        name,
      ).rejects.toThrow();
    }

    expect(await snapshot(t)).toEqual(before);
  });
});
