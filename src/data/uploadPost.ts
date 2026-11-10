import { publicMediaUrl } from "./metaGraph";

type Platform = "instagram" | "facebook";

export class UploadPostRejected extends Error {}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function socialId(value: unknown): value is string {
  return typeof value === "string" && /^\d{5,30}$/.test(value);
}

async function request(path: string, options: RequestInit = {}) {
  const key = process.env.UPLOAD_POST_API_KEY;
  if (!key) throw new UploadPostRejected("A conexão de redes sociais ainda precisa ser ativada no servidor.");
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Apikey ${key}`);
  if (typeof options.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(`https://api.upload-post.com${path}`, {
    ...options, headers, signal: AbortSignal.timeout(12_000), redirect: "error",
  });
  return { status: response.status, ok: response.ok, data: object(await response.json().catch(() => null)) };
}

function matchesProfile(response: Awaited<ReturnType<typeof request>>, profile: string) {
  return response.ok && response.data.success === true && object(response.data.profile).username === profile;
}

export async function getUploadPostConnectUrl(platform: Platform, profile: string, callback: string): Promise<string> {
  const profilePath = `/api/uploadposts/users/${encodeURIComponent(profile)}`;
  const existing = await request(profilePath);
  if (existing.status === 404) {
    const created = await request("/api/uploadposts/users", { method: "POST", body: JSON.stringify({ username: profile }) });
    if (created.status === 403 && created.data.error_code === "PROFILE_LIMIT_REACHED")
      throw new Error("O limite de empresas do plano de publicação foi atingido.");
    const confirmed = created.status === 409 ? await request(profilePath) : created;
    if (!matchesProfile(confirmed, profile)) throw new Error("Não foi possível criar o perfil de publicação.");
  } else if (!matchesProfile(existing, profile)) {
    throw new Error("Não foi possível consultar o perfil de publicação.");
  }
  const response = await request(`/api/uploadposts/oauth/${platform}/start`, {
    method: "POST", body: JSON.stringify({ profile, redirect_url: callback }),
  });
  if (!response.ok || response.data.success !== true || response.data.platform !== platform ||
      typeof response.data.authorize_url !== "string") throw new Error("Não foi possível iniciar a conexão com a rede social.");
  const url = new URL(response.data.authorize_url);
  const host = `${platform}.com`;
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      (url.hostname !== host && url.hostname !== `www.${host}`)) throw new Error("Endereço de autorização inválido.");
  return url.toString();
}

export async function getUploadPostDestinations(platform: Platform, profile: string): Promise<Array<{ id: string; name: string }>> {
  if (platform === "instagram") {
    const response = await request(`/api/uploadposts/users/${encodeURIComponent(profile)}`);
    if (response.status === 404) return [];
    if (!matchesProfile(response, profile)) throw new Error("Não foi possível verificar a conta conectada.");
    const account = object(object(object(response.data.profile).social_accounts).instagram);
    if (!socialId(account.username) || account.reauth_required === true) return [];
    const name = typeof account.handle === "string" && account.handle.trim()
      ? `@${account.handle.replace(/^@/, "")}` : account.display_name;
    return [{ id: account.username, name: typeof name === "string" && name.trim() ? name : account.username }];
  }
  const response = await request(`/api/uploadposts/users/facebook-page?${new URLSearchParams({ profile_username: profile })}`);
  if (response.status === 404) return [];
  if (!response.ok || response.data.success !== true || !Array.isArray(response.data.pages))
    throw new Error("Não foi possível consultar as Páginas autorizadas.");
  const pinned = response.data.selected_page_id;
  return response.data.pages.flatMap(raw => {
    const page = object(raw);
    return socialId(page.id) && (pinned == null || pinned === page.id) && typeof page.name === "string" && page.name.trim()
      ? [{ id: page.id, name: page.name }] : [];
  });
}

export async function publishWithUploadPost(input: {
  postId: string; profile: string; platform: Platform; destinationId?: string;
  format: "text" | "image" | "reel"; caption: string; mediaUrl?: string;
}) {
  const { postId, profile, platform, destinationId, format, caption } = input;
  if (!destinationId || !caption.trim() || caption.length > 2200 ||
      (platform === "instagram" && format === "text") || (format !== "text" && !input.mediaUrl))
    throw new UploadPostRejected("Confira o destino, a legenda e a mídia da publicação.");

  let mediaUrl: string | undefined;
  try { mediaUrl = format !== "text" && input.mediaUrl ? publicMediaUrl(input.mediaUrl) : undefined; }
  catch { throw new UploadPostRejected("A mídia precisa estar em HTTPS público."); }
  const destinations = await getUploadPostDestinations(platform, profile).catch(() => {
    throw new UploadPostRejected("Não foi possível verificar o destino da publicação.");
  });
  if (!destinations.some(destination => destination.id === destinationId))
    throw new UploadPostRejected("O destino aprovado não está mais autorizado.");

  const requestId = `smos-${postId}`;
  const form = new FormData();
  form.set("user", profile);
  form.append("platform[]", platform);
  form.set("title", caption);
  form.set("request_id", requestId);
  form.set("async_upload", "true");
  if (platform === "facebook") form.set("facebook_page_id", destinationId);
  if (format === "reel" && mediaUrl) {
    form.set("video", mediaUrl);
    form.set("media_type", "REELS");
  }
  if (format === "image" && mediaUrl) form.append("photos[]", mediaUrl);
  const path = { text: "/api/upload_text", image: "/api/upload_photos", reel: "/api/upload" }[format];
  const submitted = await request(path, { method: "POST", body: form, headers: { "Idempotency-Key": requestId } })
    .catch(() => null);
  if (submitted && [400, 401, 403, 404, 413, 415, 422, 429].includes(submitted.status))
    throw new UploadPostRejected("O serviço recusou a publicação.");

  const statusPath = `/api/uploadposts/status?${new URLSearchParams({ request_id: requestId })}`;
  // Consultar o mesmo envio, mesmo se a resposta do POST se perdeu.
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 8_000));
    const status = await request(statusPath).catch(() => null);
    if (!status?.ok || !Array.isArray(status.data.results)) continue;
    const result = status.data.results.map(object).find(row => row.platform === platform);
    if (result?.skipped === true || result?.status === "skipped" || result?.status === "failed" ||
        (status.data.status === "failed" && result?.success === false && result.status !== "retryable"))
      throw new UploadPostRejected("O serviço recusou a publicação.");
    if (status.data.status === "completed" && result?.success === true) {
      const id = result.platform_post_id || result.post_url;
      if (typeof id === "string" && id) return id;
    }
  }
  throw new Error("O serviço não confirmou o resultado da publicação.");
}
