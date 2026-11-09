import { publicMediaUrl } from "./metaGraph";

export type ZernioPlatform = "instagram" | "facebook";

export class ZernioRejected extends Error {}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value) ? value : undefined;
}

async function request(path: string, options: RequestInit = {}) {
  const token = process.env.ZERNIO_API_KEY;
  if (!token) throw new ZernioRejected("A chave do Zernio ainda não foi configurada no Convex.");
  const response = await fetch(`https://zernio.com/api/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  return { status: response.status, ok: response.ok, data: object(await response.json().catch(() => null)) };
}

export async function getOrCreateZernioProfile(key: string): Promise<string> {
  const response = await request("/profiles", {
    method: "POST", headers: { "Idempotency-Key": `smos-profile-${key}` },
    body: JSON.stringify({ name: `SMOS ${key}`, externalId: key }),
  });
  if (response.ok) {
    const profileId = identifier(object(response.data.profile)._id);
    if (profileId) return profileId;
  }
  if (response.status === 409 && response.data.code === "profile_name_conflict") {
    const profileId = identifier(object(response.data.details).existingProfileId);
    if (profileId) return profileId;
  }
  throw new Error("O Zernio não confirmou o perfil de publicação. Tente novamente.");
}

export async function getZernioConnectUrl(platform: ZernioPlatform, profileId: string, callback: string): Promise<string> {
  const query = new URLSearchParams({ profileId, redirect_url: callback });
  if (platform === "instagram") query.set("loginMethod", "instagram_login");
  const response = await request(`/connect/${platform}?${query}`);
  if (!response.ok || typeof response.data.authUrl !== "string")
    throw new Error("O Zernio não iniciou a conexão com a rede social.");
  const url = new URL(response.data.authUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port || ![
    "instagram.com", "www.instagram.com", "facebook.com", "www.facebook.com", "zernio.com", "app.zernio.com", "my.zernio.com",
  ].includes(url.hostname)) throw new Error("Endereço de autorização inválido.");
  return url.toString();
}

export async function getZernioAccount(platform: ZernioPlatform, profileId: string, accountId: string) {
  if (!identifier(accountId)) return null;
  const query = new URLSearchParams({ profileId, platform, limit: "100" });
  const response = await request(`/accounts?${query}`);
  if (!response.ok || !Array.isArray(response.data.accounts))
    throw new Error("O Zernio não confirmou as contas conectadas.");
  const account = response.data.accounts.map(object).find(row => row._id === accountId);
  if (!account || account.platform !== platform || account.isActive !== true || account.needsReconnection === true) return null;
  const reportedProfile = typeof account.profileId === "string" ? account.profileId : object(account.profileId)._id;
  if (reportedProfile !== profileId) return null;
  const { displayName, username } = account;
  const instagramId = object(account.metadata).instagramScopedId;
  const platformUserId = platform === "instagram" && typeof instagramId === "string" ? instagramId : account.platformUserId;
  if (typeof platformUserId !== "string" || !/^\d{5,30}$/.test(platformUserId)) return null;
  const name = platform === "instagram" && typeof username === "string" && username.trim()
    ? `@${username.replace(/^@/, "")}` : displayName;
  return { accountId, platformUserId, name: typeof name === "string" && name.trim() ? name : platformUserId };
}

export async function publishWithZernio(input: {
  postId: string; accountId: string; platform: ZernioPlatform; format: "text" | "image" | "reel";
  caption: string; mediaUrl?: string;
}) {
  if (!input.caption.trim() || input.caption.length > 2200 ||
      ((input.platform === "instagram" || input.format !== "text") && !input.mediaUrl))
    throw new ZernioRejected("Confira a legenda e a mídia da publicação.");
  let mediaUrl: string | undefined;
  try { mediaUrl = input.mediaUrl ? publicMediaUrl(input.mediaUrl) : undefined; }
  catch { throw new ZernioRejected("A mídia precisa estar em HTTPS público."); }
  const response = await request("/posts", {
    method: "POST", headers: { "Idempotency-Key": `smos-post-${input.postId}` },
    body: JSON.stringify({
      content: input.caption, publishNow: true, platforms: [{ platform: input.platform, accountId: input.accountId }],
      ...(mediaUrl ? { mediaItems: [{ type: input.format === "reel" ? "video" : "image", url: mediaUrl }] } : {}),
    }),
  });
  if ([400, 401, 403, 404, 422].includes(response.status)) throw new ZernioRejected("O Zernio recusou a publicação.");
  const post = object(response.data.post);
  const platforms = Array.isArray(post.platforms) ? post.platforms.map(object) : [];
  const target = platforms.find(row => row.platform === input.platform &&
    (row.accountId === input.accountId || object(row.accountId)._id === input.accountId));
  if (post.status === "failed" && target?.status === "failed") throw new ZernioRejected("O Zernio recusou a publicação.");
  if (!response.ok || post.status !== "published" || target?.status !== "published")
    throw new Error("O Zernio não confirmou a publicação.");
  const id = typeof target.platformPostId === "string" && target.platformPostId
    ? target.platformPostId : identifier(post._id);
  if (!id) throw new Error("O Zernio não retornou o identificador da publicação.");
  return id;
}
