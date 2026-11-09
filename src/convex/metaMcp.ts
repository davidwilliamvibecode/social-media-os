/**
 * Conector MCP remoto, sem sessão, para Claude Free.
 *
 * Segurança: cada credencial é vinculada ao gestor; digest SHA-256 no banco;
 * nenhum token Meta sai por este endpoint; respostas sem detalhes sensíveis.
 * Publicações só podem ser AGENDADAS quando o conteúdo já está Approved,
 * com confirmação explícita e feature flag Meta habilitada no backend.
 */
import { v } from "convex/values";
import { httpAction, action, query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { activeUser } from "./activeUser";
import { assertWorkspaceCapacity } from "./workspaceData";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type AiProvider = "claude" | "chatgpt";
const providerValidator = v.union(v.literal("claude"), v.literal("chatgpt"));

function b64(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function digest(input: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))));
}

export const identifyUser = internalQuery({
  args: {},
  handler: async (ctx) => await activeUser(ctx),
});
export const persistKey = internalMutation({
  args: { ownerId: v.id("users"), digest: v.string(), provider: providerValidator },
  handler: async (ctx, args) => {
    const previous = await ctx.db.query("metaMcpKeys")
      .withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).collect();
    for (const key of previous) {
      // Uma chave ativa para cada IA. Chaves legadas sem identificação
      // são revogadas automaticamente na primeira emissão.
      if (!key.revokedAt && (!key.provider || key.provider === args.provider))
        await ctx.db.patch(key._id, { revokedAt: Date.now() });
    }
    return ctx.db.insert("metaMcpKeys", { ...args, createdAt: Date.now() });
  },
});

/** Uma chave por IA e gestor. Apenas a chave daquela IA é rotacionada. */
export const issueKey = action({
  args: { provider: providerValidator },
  handler: async (ctx, { provider }): Promise<string> => {
    const ownerId = await ctx.runQuery(internal.metaMcp.identifyUser, {});
    if (!ownerId) throw new Error("Entre com sua conta do Social Media OS.");
    const key = "smos_" + b64(crypto.getRandomValues(new Uint8Array(32)));
    await ctx.runMutation(internal.metaMcp.persistKey, {
      ownerId, digest: await digest(key), provider,
    });
    return key;
  },
});
export const listKeys = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await activeUser(ctx);
    if (!ownerId) return [];
    const keys = await ctx.db.query("metaMcpKeys")
      .withIndex("by_owner", q => q.eq("ownerId", ownerId)).collect();
    return keys.map(row => ({
      id: row._id, provider: row.provider ?? "legado",
      createdAt: row.createdAt, revokedAt: row.revokedAt,
    }));
  },
});
export const revokeKey = mutation({
  args: { id: v.id("metaMcpKeys") },
  handler: async (ctx, { id }) => {
    const ownerId = await activeUser(ctx);
    const key = await ctx.db.get(id);
    if (!ownerId || !key || key.ownerId !== ownerId) throw new Error("Chave não encontrada.");
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});

export const validateKey = internalQuery({
  args: { digest: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db.query("metaMcpKeys")
      .withIndex("by_digest", q => q.eq("digest", args.digest)).unique();
    if (!key || key.revokedAt || !key.provider) return null;
    return { ownerId: key.ownerId, provider: key.provider, keyId: key._id };
  },
});

export const clientSummary = internalQuery({
  args: { ownerId: v.id("users") },
  handler: async (ctx, { ownerId }) => {
    const rows = await ctx.db.query("clients")
      .withIndex("by_owner", q => q.eq("ownerId", ownerId)).take(100);
    return rows.map(row => ({
      clientId: row._id, name: row.name, status: row.status,
      instagram: row.socials.instagram ?? "", facebook: row.socials.facebook ?? "",
    }));
  },
});

export const approvedSummary = internalQuery({
  args: { ownerId: v.id("users"), clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.ownerId !== args.ownerId) throw new Error("Cliente não encontrado.");
    const rows = await ctx.db.query("content")
      .withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).collect();
    return rows
      .filter(row => row.clientId === args.clientId && row.status === "Approved" &&
        ["Instagram", "Facebook"].includes(row.platform))
      .slice(0, 100)
      .map(row => ({
        contentId: row._id, platform: row.platform, format: row.format,
        caption: row.caption, topic: row.topic,
      }));
  },
});

export const accountSummary = internalQuery({
  args: { ownerId: v.id("users"), clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.ownerId !== args.ownerId) throw new Error("Cliente não encontrado.");
    const rows = await ctx.db.query("metaAccounts")
      .withIndex("by_owner_client", q => q.eq("ownerId", args.ownerId).eq("clientId", args.clientId))
      .collect();
    return rows.map(row => ({
      accountId: row._id, pageName: row.pageName, instagramAvailable: Boolean(row.instagramId),
      status: row.status,
    }));
  },
});

export const scheduledSummary = internalQuery({
  args: { ownerId: v.id("users"), clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.ownerId !== args.ownerId) throw new Error("Cliente não encontrado.");
    const rows = await ctx.db.query("metaPosts")
      .withIndex("by_owner_client", q => q.eq("ownerId", args.ownerId).eq("clientId", args.clientId)).collect();
    return rows.slice(-100).map(row => ({
      postId: row._id, platform: row.platform, status: row.status,
      scheduledAt: row.scheduledAt, publishedId: row.publishedId,
      error: row.lastError,
    }));
  },
});

// O identificador idempotente é definido pela requisição da IA (não pela
// chamada JSON-RPC). Ele é compartilhado entre as duas IAs do mesmo gestor.
async function existingCommand(
  ctx: MutationCtx,
  args: {
    ownerId: Id<"users">; clientId: Id<"clients">;
    operation: "create_draft" | "schedule_approved";
    commandId: string; fingerprint: string;
  },
): Promise<string | null> {
  if (!/^[A-Za-z0-9_.:-]{8,120}$/.test(args.commandId))
    throw new Error("Identificador do comando inválido.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(args.fingerprint))
    throw new Error("Assinatura de comando inválida.");
  const previous = await ctx.db.query("metaAiOperations")
    .withIndex("by_owner_command", q => q
      .eq("ownerId", args.ownerId)
      .eq("operation", args.operation)
      .eq("commandId", args.commandId))
    .unique();
  if (previous) {
    if (previous.fingerprint !== args.fingerprint || previous.clientId !== args.clientId)
      throw new Error("Este comando já foi utilizado com outros dados.");
    return previous.resultId;
  }
  return null;
}
async function recordCommand(
  ctx: MutationCtx,
  args: {
    ownerId: Id<"users">; clientId: Id<"clients">; provider: AiProvider;
    operation: "create_draft" | "schedule_approved";
    commandId: string; fingerprint: string; resultId: string;
  },
) {
  await ctx.db.insert("metaAiOperations", { ...args, createdAt: Date.now() });
}

export const listOperations = query({
  args: { clientId: v.optional(v.id("clients")) },
  handler: async (ctx, { clientId }) => {
    const ownerId = await activeUser(ctx);
    if (!ownerId) return [];
    if (clientId) {
      const client = await ctx.db.get(clientId);
      if (!client || client.ownerId !== ownerId) return [];
    }
    const rows = await ctx.db.query("metaAiOperations")
      .withIndex("by_owner", q => q.eq("ownerId", ownerId))
      .order("desc").take(100);
    return rows.filter(row => !clientId || row.clientId === clientId)
      .map(row => ({
        id: row._id, clientId: row.clientId, provider: row.provider,
        operation: row.operation, resultId: row.resultId, createdAt: row.createdAt,
      }));
  },
});

export const createDraft = internalMutation({
  args: {
    ownerId: v.id("users"), clientId: v.id("clients"),
    platform: v.union(v.literal("Instagram"), v.literal("Facebook")),
    format: v.union(v.literal("Single post"), v.literal("Reel")),
    topic: v.string(), caption: v.string(), assetNote: v.string(),
    provider: providerValidator, commandId: v.string(), fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.ownerId !== args.ownerId) throw new Error("Cliente não encontrado.");
    if (!args.topic.trim() || args.topic.length > 250 ||
        !args.caption.trim() || args.caption.length > 2200 ||
        args.assetNote.length > 1500) throw new Error("Conteúdo inválido.");
    const command = {
      ownerId: args.ownerId, clientId: args.clientId,
      operation: "create_draft" as const,
      commandId: args.commandId, fingerprint: args.fingerprint,
    };
    const old = await existingCommand(ctx, command);
    if (old) return { contentId: old as Id<"content">, status: "Drafting", repeated: true };

    // Mesmo conteúdo enviado pelas duas IAs quase ao mesmo tempo:
    // responde com o primeiro rascunho, sem criar duplicata.
    const near = await ctx.db.query("metaAiOperations")
      .withIndex("by_owner_client_fingerprint", q => q
        .eq("ownerId", args.ownerId).eq("clientId", args.clientId)
        .eq("operation", "create_draft").eq("fingerprint", args.fingerprint))
      .order("desc").first();
    if (near && near.createdAt >= Date.now() - 10 * 60_000) {
      const existingId = ctx.db.normalizeId("content", near.resultId);
      if (existingId && await ctx.db.get(existingId)) {
        await recordCommand(ctx, { ...command, provider: args.provider, resultId: existingId });
        return { contentId: existingId, status: "Drafting", repeated: true };
      }
    }
    const id = await ctx.db.insert("content", {
      ownerId: args.ownerId, clientId: args.clientId,
      date: new Date().toISOString().slice(0, 10),
      platform: args.platform, format: args.format, topic: args.topic,
      caption: args.caption, assetNote: args.assetNote,
      status: "Drafting", managerNotes: "", clientComments: "",
      pillar: "Promotion", owner: "",
    });
    await assertWorkspaceCapacity(ctx, args.ownerId);
    await recordCommand(ctx, { ...command, provider: args.provider, resultId: id });
    return { contentId: id, status: "Drafting", repeated: false };
  },
});

/** Não expor diretamente ao cliente: valida ownerId obtido exclusivamente da chave MCP. */
export const scheduleFromMcp = internalMutation({
  args: {
    ownerId: v.id("users"), contentId: v.id("content"),
    accountId: v.id("metaAccounts"), scheduledAt: v.number(),
    mediaUrl: v.optional(v.string()),
    provider: providerValidator, commandId: v.string(), fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.META_PUBLISHING_ENABLED !== "true")
      throw new Error("Publicação Meta desativada até validação das credenciais.");
    const content = await ctx.db.get(args.contentId);
    const account = await ctx.db.get(args.accountId);
    if (!content || !account || content.ownerId !== args.ownerId ||
        account.ownerId !== args.ownerId || content.clientId !== account.clientId ||
        account.status !== "active") throw new Error("Conteúdo ou conta não pertence a esta empresa.");
    const command = {
      ownerId: args.ownerId, clientId: content.clientId,
      operation: "schedule_approved" as const,
      commandId: args.commandId, fingerprint: args.fingerprint,
    };
    const old = await existingCommand(ctx, command);
    if (old) return { postId: old as Id<"metaPosts">, status: "scheduled", repeated: true };
    if (content.status !== "Approved") throw new Error("Conteúdo ainda não aprovado.");
    if (content.platform !== "Facebook" && content.platform !== "Instagram")
      throw new Error("Rede não suportada.");
    if (content.platform === "Instagram" && !account.instagramId)
      throw new Error("Instagram não vinculado.");
    if (!content.caption.trim() || content.caption.length > 2200)
      throw new Error("Legenda inválida.");
    const now = Date.now();
    if (!Number.isFinite(args.scheduledAt) || args.scheduledAt < now + 60_000 ||
        args.scheduledAt > now + 365 * 86400_000)
      throw new Error("Data/hora inválida.");
    if (args.mediaUrl && !/^https:\/\//i.test(args.mediaUrl))
      throw new Error("Mídia deve estar hospedada em HTTPS público.");

    let format: "text" | "image" | "reel";
    if (content.platform === "Instagram") {
      if (!args.mediaUrl || !["Single post", "Reel"].includes(content.format))
        throw new Error("Formato/mídia do Instagram indisponível.");
      format = content.format === "Reel" ? "reel" : "image";
    } else {
      if (["Reel", "Carousel", "Story"].includes(content.format))
        throw new Error("Formato Facebook ainda indisponível.");
      format = args.mediaUrl ? "image" : "text";
    }
    const previous = await ctx.db.query("metaPosts")
      .withIndex("by_content", q => q.eq("contentId", args.contentId)).collect();
    if (previous.some(row => !["cancelled", "failed"].includes(row.status)))
      throw new Error("Este conteúdo já possui agendamento não encerrado.");

    const postId = await ctx.db.insert("metaPosts", {
      ownerId: args.ownerId, clientId: content.clientId, contentId: content._id,
      accountId: account._id, platform: content.platform, format,
      targetPageId: account.pageId, targetInstagramId: account.instagramId,
      caption: content.caption, mediaUrl: args.mediaUrl,
      scheduledAt: args.scheduledAt, createdAt: now, updatedAt: now,
      status: "scheduled",
    });
    const scheduledJobId = await ctx.scheduler.runAt(args.scheduledAt, internal.meta.deliverPost, { postId });
    await ctx.db.patch(postId, { scheduledJobId });
    await ctx.db.patch(content._id, { status: "Scheduled" });
    await recordCommand(ctx, { ...command, provider: args.provider, resultId: postId });
    return { postId, status: "scheduled", repeated: false };
  },
});

const toolCatalog = [
  {
    name: "list_clients",
    description: "Lista empresas deste gestor. Use o clientId correto em todas as outras chamadas.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_draft",
    description: "Cria um rascunho de conteúdo no Social Media OS; NÃO aprova nem agenda.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string" }, platform: { type: "string", enum: ["Facebook", "Instagram"] },
        format: { type: "string", enum: ["Single post", "Reel"] },
        topic: { type: "string" }, caption: { type: "string" },
        assetNote: { type: "string", description: "Referência da mídia, nome do arquivo, ou observação." },
        commandId: { type: "string", description: "Identificador estável e único do pedido. Reutilize o MESMO commandId em tentativas de repetição. Use pelo menos oito caracteres." },
      },
      required: ["clientId", "platform", "format", "topic", "caption", "commandId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_approved",
    description: "Lista conteúdos aprovados de uma empresa para agendamento.",
    inputSchema: {
      type: "object", properties: { clientId: { type: "string" } },
      required: ["clientId"], additionalProperties: false,
    },
  },
  {
    name: "list_accounts",
    description: "Lista Páginas Meta vinculadas à empresa; não retorna tokens.",
    inputSchema: {
      type: "object", properties: { clientId: { type: "string" } },
      required: ["clientId"], additionalProperties: false,
    },
  },
  {
    name: "list_posts",
    description: "Consulta resultados e agendamentos da empresa.",
    inputSchema: {
      type: "object", properties: { clientId: { type: "string" } },
      required: ["clientId"], additionalProperties: false,
    },
  },
  {
    name: "schedule_approved",
    description: "AGENDAMENTO EXTERNO. Só funciona com conteúdo Approved e confirm=true após autorização expressa do usuário. scheduledAt é timestamp Unix em MILISSEGUNDOS no UTC. Não publica imediatamente.",
    inputSchema: {
      type: "object",
      properties: {
        contentId: { type: "string" }, accountId: { type: "string" },
        scheduledAt: { type: "number" },
        mediaUrl: { type: "string" },
        confirm: { type: "boolean", const: true },
        commandId: { type: "string", description: "Identificador único do comando. Reutilize em tentativas repetidas; não crie um novo identificador para reenvios." },
      },
      required: ["contentId", "accountId", "scheduledAt", "confirm", "commandId"],
      additionalProperties: false,
    },
  },
] as const;

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
function rpc(id: unknown, result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status, headers: jsonHeaders });
}
function failure(id: unknown, code: number, message: string, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { status, headers: jsonHeaders });
}
function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Argumentos inválidos.");
  return value as Record<string, unknown>;
}
function stringArg(value: unknown, name: string, max = 250): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Argumento inválido: " + name);
  return value;
}
function originAllowed(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const host = new URL(raw);
    return host.protocol === "https:" && (
      host.hostname === "claude.ai" || host.hostname.endsWith(".claude.ai") ||
      host.hostname === "chatgpt.com" || host.hostname.endsWith(".chatgpt.com") ||
      host.hostname === "chat.openai.com"
    );
  } catch { return false; }
}

export const handleMcp = httpAction(async (ctx, request) => {
  if (process.env.META_MCP_ENABLED !== "true") {
    return new Response("Conector indisponível", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!originAllowed(request.headers.get("Origin")))
    return new Response("Origem não autorizada", { status: 403 });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  const auth = request.headers.get("Authorization") ?? "";
  if (!/^Bearer smos_[A-Za-z0-9_-]{40,}$/.test(auth))
    return new Response("Não autorizado", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  const identity = await ctx.runQuery(internal.metaMcp.validateKey, { digest: await digest(auth.slice(7)) });
  if (!identity) return new Response("Não autorizado", { status: 401 });
  const { ownerId, provider } = identity;

  let call: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
  try {
    const text = await request.text();
    if (text.length > 20000) return failure(null, -32600, "Requisição muito grande.", 413);
    call = JSON.parse(text) as typeof call;
    if (!call || call.jsonrpc !== "2.0" || typeof call.method !== "string") {
      return failure(null, -32600, "Requisição inválida.");
    }
  } catch { return failure(null, -32700, "JSON inválido."); }

  if (call.method === "notifications/initialized")
    return new Response(null, { status: 202 });
  if (call.method === "ping") return rpc(call.id ?? null, {});
  if (call.method === "initialize")
    return rpc(call.id ?? null, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "social-media-os-meta", version: "0.2.0" },
      instructions: "Compatível com Claude e ChatGPT por chaves separadas. Use list_clients, crie rascunhos com commandId único e só agende conteúdos aprovados após autorização expressa. Repita o mesmo commandId em reenvios, nunca invente aprovação.",
    });
  if (call.method === "tools/list")
    return rpc(call.id ?? null, { tools: toolCatalog });
  if (call.method !== "tools/call") return failure(call.id ?? null, -32601, "Método não encontrado.");

  try {
    const params = objectArgs(call.params);
    const name = stringArg(params.name, "name", 100);
    const args = objectArgs(params.arguments ?? {});
    let result: unknown;
    switch (name) {
      case "list_clients":
        result = await ctx.runQuery(internal.metaMcp.clientSummary, { ownerId });
        break;
      case "create_draft": {
        const clientId = stringArg(args.clientId, "clientId");
        const commandId = stringArg(args.commandId, "commandId", 120);
        const platform = stringArg(args.platform, "platform");
        const format = stringArg(args.format, "format");
        if (platform !== "Instagram" && platform !== "Facebook")
          throw new Error("Plataforma inválida.");
        if (format !== "Single post" && format !== "Reel")
          throw new Error("Formato inválido.");
        const topic = stringArg(args.topic, "topic", 250);
        const caption = stringArg(args.caption, "caption", 2200);
        const assetNote = typeof args.assetNote === "string" ? args.assetNote : "";
        const fingerprint = await digest(JSON.stringify({
          operation: "create_draft", clientId, platform, format, topic, caption, assetNote,
        }));
        result = await ctx.runMutation(internal.metaMcp.createDraft, {
          ownerId, provider, commandId, fingerprint,
          clientId: clientId as import("./_generated/dataModel").Id<"clients">,
          platform, format, topic, caption, assetNote,
        });
        break;
      }
      case "list_approved":
        result = await ctx.runQuery(internal.metaMcp.approvedSummary, {
          ownerId, clientId: stringArg(args.clientId, "clientId") as import("./_generated/dataModel").Id<"clients">,
        });
        break;
      case "list_accounts":
        result = await ctx.runQuery(internal.metaMcp.accountSummary, {
          ownerId, clientId: stringArg(args.clientId, "clientId") as import("./_generated/dataModel").Id<"clients">,
        });
        break;
      case "list_posts":
        result = await ctx.runQuery(internal.metaMcp.scheduledSummary, {
          ownerId, clientId: stringArg(args.clientId, "clientId") as import("./_generated/dataModel").Id<"clients">,
        });
        break;
      case "schedule_approved": {
        if (args.confirm !== true) throw new Error("Confirmação explícita obrigatória.");
        if (typeof args.scheduledAt !== "number")
          throw new Error("scheduledAt precisa ser número em milissegundos UTC.");
        const contentId = stringArg(args.contentId, "contentId");
        const accountId = stringArg(args.accountId, "accountId");
        const commandId = stringArg(args.commandId, "commandId", 120);
        const mediaUrl = typeof args.mediaUrl === "string" ? args.mediaUrl : "";
        const fingerprint = await digest(JSON.stringify({
          operation: "schedule_approved", contentId, accountId,
          scheduledAt: args.scheduledAt, mediaUrl,
        }));
        result = await ctx.runMutation(internal.metaMcp.scheduleFromMcp, {
          ownerId, provider, commandId, fingerprint,
          contentId: contentId as import("./_generated/dataModel").Id<"content">,
          accountId: accountId as import("./_generated/dataModel").Id<"metaAccounts">,
          scheduledAt: args.scheduledAt,
          ...(mediaUrl ? { mediaUrl } : {}),
        });
        break;
      }
      default:
        return failure(call.id ?? null, -32602, "Ferramenta desconhecida.");
    }
    return rpc(call.id ?? null, { content: [{ type: "text", text: JSON.stringify(result) }] });
  } catch (error) {
    // Erros de domínio podem detalhar IDs de tabelas ou tokens, então a mensagem
    // aqui é intencionalmente limitada a mensagens definidas abaixo.
    const description = error instanceof Error ? error.message : "";
    const safe = [
      "Cliente não encontrado.", "Conteúdo ainda não aprovado.",
      "Conteúdo ou conta não pertence a esta empresa.", "Rede não suportada.",
      "Instagram não vinculado.", "Legenda inválida.", "Data/hora inválida.",
      "Mídia deve estar hospedada em HTTPS público.",
      "Formato/mídia do Instagram indisponível.", "Formato Facebook ainda indisponível.",
      "Este conteúdo já possui agendamento não encerrado.",
      "Publicação Meta desativada até validação das credenciais.",
    ].includes(description) ? description : "Operação recusada ou entrada inválida.";
    return rpc(call.id ?? null, {
      isError: true, content: [{ type: "text", text: safe }],
    });
  }
});

/** MCP Streamable HTTP stateless transport: no GET event stream is offered. */
export const handleMcpGet = httpAction(async () => new Response(null, {
  status: 405,
  headers: { Allow: "POST", "Cache-Control": "no-store" },
}));
