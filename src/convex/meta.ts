// Meta OAuth + publicações multicliente. Todo acesso público exige sessão ativa.
// Segredos só existem em ações do servidor. Nenhuma publicação ocorre sem
// conteúdo Approved e agendamento explícito.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action, httpAction, internalAction, internalMutation, internalQuery, mutation, query,
} from "./_generated/server";
import { activeUser } from "./activeUser";
import { MetaGraphError, publishMeta, type MetaPublishRequest } from "../data/metaGraph";

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("Configuração Meta ausente: " + name);
  return value;
}
function version(): string {
  const value = setting("META_GRAPH_VERSION");
  if (!/^v\d+\.\d+$/.test(value)) throw new Error("Versão Meta inválida.");
  return value;
}
function toBase64(input: Uint8Array): string {
  let binary = "";
  input.forEach((v) => { binary += String.fromCharCode(v); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
async function digest(value: string): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function encryptionKey() {
  const bytes = fromBase64(setting("META_TOKEN_KEY_B64"));
  if (bytes.length !== 32) throw new Error("META_TOKEN_KEY_B64 precisa ter 32 bytes.");
  return await crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(token),
  );
  return toBase64(iv) + "." + toBase64(new Uint8Array(cipher));
}
async function decryptToken(encrypted: string): Promise<string> {
  const [iv, data] = encrypted.split(".");
  if (!iv || !data) throw new Error("Token criptografado inválido.");
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) as BufferSource }, await encryptionKey(), fromBase64(data) as BufferSource,
  );
  return new TextDecoder().decode(bytes);
}
async function graphJSON(url: URL, token?: string): Promise<Record<string, unknown>> {
  const res = await fetch(url.toString(), {
    headers: token ? { Authorization: "Bearer " + token } : undefined,
  });
  if (!res.ok) throw new Error("Meta recusou autenticação ou consulta (HTTP " + res.status + ").");
  return (await res.json()) as Record<string, unknown>;
}
function redirectResult(kind: "success" | "denied" | "error" | "no-pages"): Response {
  const dest = new URL("/app/meta", setting("META_FRONTEND_ORIGIN"));
  dest.searchParams.set("connection", kind);
  return new Response(null, { status: 302, headers: { Location: dest.toString(), "Cache-Control": "no-store" } });
}
export const verifyClient = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const ownerId = await activeUser(ctx);
    const client = await ctx.db.get(clientId);
    if (!ownerId || !client || client.ownerId !== ownerId) throw new Error("Cliente sem acesso.");
    return { ownerId, clientId };
  },
});

export const reserveState = internalMutation({
  args: {
    ownerId: v.id("users"), clientId: v.id("clients"), digest: v.string(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.ownerId !== args.ownerId) throw new Error("Cliente inválido.");
    await ctx.db.insert("metaOAuthStates", args);
  },
});

export const startConnection = action({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }): Promise<string> => {
    const owner = await ctx.runQuery(internal.meta.verifyClient, { clientId });
    const state = toBase64(crypto.getRandomValues(new Uint8Array(32)));
    await ctx.runMutation(internal.meta.reserveState, {
      ...owner, digest: await digest(state), expiresAt: Date.now() + 10 * 60_000,
    });
    const url = new URL("https://www.facebook.com/" + version() + "/dialog/oauth");
    url.searchParams.set("client_id", setting("META_APP_ID"));
    url.searchParams.set("redirect_uri", setting("META_REDIRECT_URI"));
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", [
      "pages_show_list", "pages_read_engagement", "pages_manage_posts",
      "instagram_basic", "instagram_content_publish",
    ].join(","));
    return url.toString();
  },
});

export const redeemState = internalMutation({
  args: { digest: v.string() },
  handler: async (ctx, { digest: hashed }) => {
    const state = await ctx.db.query("metaOAuthStates").withIndex("by_digest", q => q.eq("digest", hashed)).unique();
    if (!state) return null;
    await ctx.db.delete(state._id);
    if (state.expiresAt <= Date.now()) return null;
    const client = await ctx.db.get(state.clientId);
    if (!client || client.ownerId !== state.ownerId) return null;
    return { ownerId: state.ownerId, clientId: state.clientId };
  },
});

const pendingValidator = v.object({
  pageId: v.string(), pageName: v.string(),
  instagramId: v.optional(v.string()), encryptedToken: v.string(),
});
export const saveCandidates = internalMutation({
  args: {
    ownerId: v.id("users"), clientId: v.id("clients"), pages: v.array(pendingValidator),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.ownerId !== args.ownerId || args.pages.length > 100) throw new Error("Cliente inválido.");
    const previous = await ctx.db.query("metaCandidates")
      .withIndex("by_owner_client", q => q.eq("ownerId", args.ownerId).eq("clientId", args.clientId))
      .collect();
    for (const item of previous) await ctx.db.delete(item._id);
    for (const item of args.pages) {
      await ctx.db.insert("metaCandidates", {
        ...item, ownerId: args.ownerId, clientId: args.clientId, expiresAt: Date.now() + 15 * 60_000,
      });
    }
  },
});

/** Callback público da Meta: state de uso único, dados armazenados apenas criptografados. */
export const oauthCallback = httpAction(async (ctx, request) => {
  try {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!state || !code) return redirectResult("denied");
    const owner = await ctx.runMutation(internal.meta.redeemState, { digest: await digest(state) });
    if (!owner) return redirectResult("error");

    const exchange = new URL("https://graph.facebook.com/" + version() + "/oauth/access_token");
    exchange.searchParams.set("client_id", setting("META_APP_ID"));
    exchange.searchParams.set("client_secret", setting("META_APP_SECRET"));
    exchange.searchParams.set("redirect_uri", setting("META_REDIRECT_URI"));
    exchange.searchParams.set("code", code);
    const auth = await graphJSON(exchange);
    const shortToken = auth.access_token;
    if (typeof shortToken !== "string") throw new Error("Meta não confirmou a autorização.");

    const long = new URL("https://graph.facebook.com/" + version() + "/oauth/access_token");
    long.searchParams.set("grant_type", "fb_exchange_token");
    long.searchParams.set("client_id", setting("META_APP_ID"));
    long.searchParams.set("client_secret", setting("META_APP_SECRET"));
    long.searchParams.set("fb_exchange_token", shortToken);
    const refreshed = await graphJSON(long);
    const userToken = typeof refreshed.access_token === "string" ? refreshed.access_token : shortToken;

    const pagesURL = new URL("https://graph.facebook.com/" + version() + "/me/accounts");
    pagesURL.searchParams.set("fields", "id,name,access_token,tasks,instagram_business_account{id}");
    pagesURL.searchParams.set("limit", "100");
    const pages = await graphJSON(pagesURL, userToken);
    const rawPages = Array.isArray(pages.data) ? pages.data : [];
    const selected = [];
    for (const raw of rawPages) {
      if (!raw || typeof raw !== "object") continue;
      const page = raw as Record<string, unknown>;
      if (typeof page.id !== "string" || typeof page.name !== "string" ||
          typeof page.access_token !== "string") continue;
      // Não oferecer como destino uma Página cuja lista de tarefas explicita
      // ausência da permissão de criar conteúdo. Algumas respostas omitem
      // "tasks"; nesse caso a Graph API ainda validará o direito no envio.
      const tasks = page.tasks;
      if (Array.isArray(tasks) &&
          !tasks.includes("CREATE_CONTENT") && !tasks.includes("MANAGE")) continue;
      const ig = page.instagram_business_account;
      const instagramId = ig && typeof ig === "object" && "id" in ig && typeof ig.id === "string" ? ig.id : undefined;
      selected.push({
        pageId: page.id, pageName: page.name, instagramId,
        encryptedToken: await encryptToken(page.access_token),
      });
    }
    await ctx.runMutation(internal.meta.saveCandidates, { ...owner, pages: selected });
    return redirectResult(selected.length ? "success" : "no-pages");
  } catch {
    // Nunca incluir code, token, app secret ou payload Meta no corpo/log.
    return redirectResult("error");
  }
});

/** Remove tokens transitórios mesmo quando o usuário abandona o OAuth. */
export const cleanupExpiredConnections = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const candidates = await ctx.db.query("metaCandidates")
      .withIndex("by_expiresAt", q => q.lte("expiresAt", now)).take(100);
    const states = await ctx.db.query("metaOAuthStates")
      .withIndex("by_expiresAt", q => q.lte("expiresAt", now)).take(100);
    for (const row of [...candidates, ...states]) await ctx.db.delete(row._id);
    return { candidates: candidates.length, states: states.length };
  },
});

export const listCandidates = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const ownerId = await activeUser(ctx);
    const client = await ctx.db.get(clientId);
    if (!ownerId || !client || client.ownerId !== ownerId) return [];
    return (await ctx.db.query("metaCandidates")
      .withIndex("by_owner_client", q => q.eq("ownerId", ownerId).eq("clientId", clientId))
      .collect())
      .filter(row => row.expiresAt > Date.now())
      .map(row => ({ id: row._id, pageId: row.pageId, pageName: row.pageName, instagramId: row.instagramId }));
  },
});

export const selectAccount = mutation({
  args: { candidateId: v.id("metaCandidates") },
  handler: async (ctx, { candidateId }) => {
    const ownerId = await activeUser(ctx);
    const candidate = await ctx.db.get(candidateId);
    if (!ownerId || !candidate || candidate.ownerId !== ownerId || candidate.expiresAt <= Date.now())
      throw new Error("Conexão não disponível.");
    const client = await ctx.db.get(candidate.clientId);
    if (!client || client.ownerId !== ownerId) throw new Error("Cliente inválido.");
    const existing = await ctx.db.query("metaAccounts")
      .withIndex("by_owner_page", q => q.eq("ownerId", ownerId).eq("pageId", candidate.pageId))
      .unique();
    if (existing && existing.clientId !== candidate.clientId)
      throw new Error("Esta Página já está associada a outro cliente.");
    const row = {
      ownerId, clientId: candidate.clientId, pageId: candidate.pageId,
      pageName: candidate.pageName, instagramId: candidate.instagramId,
      encryptedToken: candidate.encryptedToken, connectedAt: Date.now(),
      status: "active" as const,
    };
    const accountId = existing ? existing._id : await ctx.db.insert("metaAccounts", row);
    if (existing) await ctx.db.patch(existing._id, row);
    await ctx.db.delete(candidateId);
    return accountId;
  },
});

export const listAccounts = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const ownerId = await activeUser(ctx);
    const client = await ctx.db.get(clientId);
    if (!ownerId || !client || client.ownerId !== ownerId) return [];
    return (await ctx.db.query("metaAccounts")
      .withIndex("by_owner_client", q => q.eq("ownerId", ownerId).eq("clientId", clientId))
      .collect())
      .map(row => ({
        id: row._id, pageId: row.pageId, pageName: row.pageName,
        instagramId: row.instagramId, status: row.status, connectedAt: row.connectedAt,
      }));
  },
});

export const disconnectAccount = mutation({
  args: { accountId: v.id("metaAccounts") },
  handler: async (ctx, { accountId }) => {
    const ownerId = await activeUser(ctx);
    const row = await ctx.db.get(accountId);
    if (!ownerId || !row || row.ownerId !== ownerId) throw new Error("Conexão não encontrada.");
    // Desconectar também cancela os agendamentos que usariam esta credencial.
    // Sem isso, reconectar a mesma Página antes do horário poderia reativá-los.
    const pending = await ctx.db.query("metaPosts")
      .withIndex("by_account", q => q.eq("accountId", accountId))
      .collect();
    for (const post of pending) {
      if (post.ownerId !== ownerId || post.status !== "scheduled") continue;
      if (post.scheduledJobId) await ctx.scheduler.cancel(post.scheduledJobId);
      await ctx.db.patch(post._id, { status: "cancelled", updatedAt: Date.now() });
      const content = await ctx.db.get(post.contentId);
      if (content && content.ownerId === ownerId && content.status === "Scheduled")
        await ctx.db.patch(content._id, { status: "Approved" });
    }
    await ctx.db.patch(row._id, { status: "revoked", encryptedToken: "" });
  },
});

export const schedulePost = mutation({
  args: {
    contentId: v.id("content"), accountId: v.id("metaAccounts"),
    scheduledAt: v.number(), mediaUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (process.env.META_PUBLISHING_ENABLED !== "true")
      throw new Error("Publicações automáticas Meta estão desativadas.");
    const ownerId = await activeUser(ctx);
    const content = await ctx.db.get(args.contentId);
    const account = await ctx.db.get(args.accountId);
    if (!ownerId || !content || !account ||
        content.ownerId !== ownerId || account.ownerId !== ownerId ||
        content.clientId !== account.clientId || account.status !== "active")
      throw new Error("Cliente ou conta Meta sem acesso.");
    if (content.status !== "Approved") throw new Error("Aprovação pendente.");
    const platform = content.platform;
    if (platform !== "Facebook" && platform !== "Instagram") throw new Error("Plataforma não suportada.");
    if (platform === "Instagram" && !account.instagramId) throw new Error("Conta Instagram não vinculada.");
    let format: "text" | "image" | "reel";
    if (platform === "Facebook") {
      if (content.format === "Reel" || content.format === "Carousel" || content.format === "Story")
        throw new Error("Formato Facebook ainda não suportado.");
      format = args.mediaUrl ? "image" : "text";
    } else {
      if (content.format !== "Single post" && content.format !== "Reel")
        throw new Error("Formato Instagram ainda não suportado.");
      if (!args.mediaUrl) throw new Error("Instagram exige URL de mídia pública.");
      format = content.format === "Reel" ? "reel" : "image";
    }
    if (args.mediaUrl && !/^https:\/\//i.test(args.mediaUrl))
      throw new Error("Mídia precisa de URL HTTPS.");
    if (!Number.isFinite(args.scheduledAt) ||
        args.scheduledAt < Date.now() + 60_000 ||
        args.scheduledAt > Date.now() + 365 * 24 * 3600_000)
      throw new Error("Informe um horário válido no futuro.");
    const previous = await ctx.db.query("metaPosts")
      .withIndex("by_content", q => q.eq("contentId", args.contentId)).collect();
    if (previous.some(row => !["cancelled", "failed"].includes(row.status)))
      throw new Error("Este conteúdo já possui agendamento/publicação pendente.");
    const now = Date.now();
    const postId = await ctx.db.insert("metaPosts", {
      ownerId, clientId: content.clientId, contentId: args.contentId,
      accountId: args.accountId, platform, format,
      targetPageId: account.pageId, targetInstagramId: account.instagramId,
      caption: content.caption, mediaUrl: args.mediaUrl,
      scheduledAt: args.scheduledAt, createdAt: now, updatedAt: now,
      status: "scheduled",
    });
    const scheduledJobId = await ctx.scheduler.runAt(args.scheduledAt, internal.meta.deliverPost, { postId });
    await ctx.db.patch(postId, { scheduledJobId });
    await ctx.db.patch(content._id, { status: "Scheduled" });
    return postId;
  },
});

export const cancelPost = mutation({
  args: { postId: v.id("metaPosts") },
  handler: async (ctx, { postId }) => {
    const ownerId = await activeUser(ctx);
    const post = await ctx.db.get(postId);
    if (!ownerId || !post || post.ownerId !== ownerId) throw new Error("Agendamento não encontrado.");
    if (post.status !== "scheduled") throw new Error("Publicação já iniciada ou encerrada.");
    if (post.scheduledJobId) await ctx.scheduler.cancel(post.scheduledJobId);
    await ctx.db.patch(postId, { status: "cancelled", updatedAt: Date.now() });
    const content = await ctx.db.get(post.contentId);
    if (content && content.ownerId === ownerId && content.status === "Scheduled")
      await ctx.db.patch(content._id, { status: "Approved" });
    // A função programada permanece, mas claimPost detecta cancelled e não envia.
  },
});

export const listPosts = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const ownerId = await activeUser(ctx);
    const client = await ctx.db.get(clientId);
    if (!ownerId || !client || client.ownerId !== ownerId) return [];
    return await ctx.db.query("metaPosts")
      .withIndex("by_owner_client", q => q.eq("ownerId", ownerId).eq("clientId", clientId))
      .collect();
  },
});

export const claimPost = internalMutation({
  args: { postId: v.id("metaPosts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post || post.status !== "scheduled" || post.scheduledAt > Date.now()) return null;
    if (process.env.META_PUBLISHING_ENABLED !== "true") {
      await ctx.db.patch(postId, { status: "failed", updatedAt: Date.now(), lastError: "Integração desativada." });
      const content = await ctx.db.get(post.contentId);
      if (content && content.ownerId === post.ownerId && content.status === "Scheduled")
        await ctx.db.patch(content._id, { status: "Approved" });
      return null;
    }
    const account = await ctx.db.get(post.accountId);
    const client = await ctx.db.get(post.clientId);
    const content = await ctx.db.get(post.contentId);
    if (!account || !client || !content || account.status !== "active" ||
        account.ownerId !== post.ownerId || account.clientId !== post.clientId ||
        account.pageId !== post.targetPageId || account.instagramId !== post.targetInstagramId ||
        client.ownerId !== post.ownerId || content.ownerId !== post.ownerId ||
        content.clientId !== post.clientId) {
      await ctx.db.patch(postId, { status: "failed", updatedAt: Date.now(), lastError: "Vínculo inválido ou desconectado." });
      return null;
    }
    await ctx.db.patch(postId, { status: "publishing", updatedAt: Date.now() });
    return {
      postId, platform: post.platform, format: post.format, caption: post.caption,
      mediaUrl: post.mediaUrl, pageId: account.pageId,
      instagramId: account.instagramId, encryptedToken: account.encryptedToken,
    };
  },
});

export const completePost = internalMutation({
  args: {
    postId: v.id("metaPosts"), publishedId: v.optional(v.string()),
    outcome: v.union(v.literal("published"), v.literal("failed"), v.literal("uncertain")),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post || post.status !== "publishing") return;
    await ctx.db.patch(post._id, {
      status: args.outcome,
      updatedAt: Date.now(), publishedId: args.publishedId,
      lastError: args.lastError,
    });
    if (args.outcome !== "uncertain") {
      const content = await ctx.db.get(post.contentId);
      if (content && content.ownerId === post.ownerId && content.status === "Scheduled")
        await ctx.db.patch(content._id, {
          status: args.outcome === "published" ? "Published" : "Approved",
        });
    }
  },
});

export const deliverPost = internalAction({
  args: { postId: v.id("metaPosts") },
  handler: async (ctx, { postId }) => {
    const job = await ctx.runMutation(internal.meta.claimPost, { postId });
    if (!job) return;
    try {
      const accessToken = await decryptToken(job.encryptedToken);
      let request: MetaPublishRequest;
      if (job.platform === "Facebook") {
        request = job.format === "image" && job.mediaUrl
          ? { platform: "facebook", format: "image", pageId: job.pageId, caption: job.caption, mediaUrl: job.mediaUrl, accessToken }
          : { platform: "facebook", format: "text", pageId: job.pageId, caption: job.caption, accessToken };
      } else {
        if (!job.instagramId || !job.mediaUrl) throw new Error("Conta/mídia Instagram inválida.");
        request = {
          platform: "instagram", format: job.format === "reel" ? "reel" : "image",
          instagramAccountId: job.instagramId, caption: job.caption,
          mediaUrl: job.mediaUrl, accessToken,
        };
      }
      const result = await publishMeta(request, { version: version() });
      await ctx.runMutation(internal.meta.completePost, {
        postId, outcome: "published", publishedId: result.id,
      });
    } catch (error) {
      // Recusa HTTP 4xx confirmada pela Graph API: não houve autorização para
      // publicar; liberar o conteúdo para correção, sem tentar novamente.
      // Falha de rede, 5xx ou resposta ambígua: a mídia PODE ter sido publicada.
      // Manter o estado incerto e exigir conciliação manual (sem duplicar posts).
      const rejected = error instanceof MetaGraphError &&
        error.status >= 400 && error.status < 500;
      await ctx.runMutation(internal.meta.completePost, {
        postId,
        outcome: rejected ? "failed" : "uncertain",
        lastError: rejected
          ? "A Meta recusou a publicação. Verifique conta, permissões e mídia."
          : "Resultado incerto: conferir na Meta antes de tentar novamente.",
      });
    }
  },
});
