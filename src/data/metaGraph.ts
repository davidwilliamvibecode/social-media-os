/**
 * Adaptador isolado para a API oficial da Meta.
 *
 * Esta biblioteca NÃO agenda posts, NÃO autentica clientes e NÃO publica
 * automaticamente: somente executa uma operação quando chamada por um
 * serviço servidor já autorizado. Nunca a importe em componentes React.
 *
 * Nenhum token deve ser enviado em VITE_* ou persistido no navegador.
 */

export type MetaPublishRequest =
  | {
      platform: "facebook";
      format: "text";
      pageId: string;
      accessToken: string;
      caption: string;
    }
  | {
      platform: "facebook";
      format: "image";
      pageId: string;
      accessToken: string;
      caption: string;
      mediaUrl: string;
    }
  | {
      platform: "instagram";
      format: "image" | "reel";
      instagramAccountId: string;
      accessToken: string;
      caption: string;
      mediaUrl: string;
    };

export type MetaPublishResult = {
  platform: "facebook" | "instagram";
  id: string;
  postId?: string;
};

export type MetaGraphOptions = {
  /** Versão fixada pelo backend (ex.: v25.0), não fornecida pelo cliente. */
  version: string;
  fetchImpl?: typeof fetch;
  /** Ajustável em testes, sem chamadas externas. */
  wait?: (milliseconds: number) => Promise<void>;
  maxChecks?: number;
  checkIntervalMs?: number;
};

type MetaResponse = {
  id?: string;
  post_id?: string;
  status_code?: string;
  error?: { code?: number; error_subcode?: number; type?: string };
};

export class MetaGraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: number,
    public readonly subcode?: number,
  ) {
    super(
      `Meta recusou a operação (HTTP ${status}${code ? `, código ${code}` : ""}${subcode ? `, subcódigo ${subcode}` : ""}).`,
    );
    this.name = "MetaGraphError";
  }
}

function graphId(value: string): string {
  if (!/^\d{5,30}$/.test(value)) {
    throw new Error("Identificador da conta Meta inválido.");
  }
  return value;
}

function publicMediaUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL da mídia inválida.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hostname === "localhost" ||
    /^127\./.test(url.hostname) ||
    /^10\./.test(url.hostname) ||
    /^192\.168\./.test(url.hostname) ||
    /^169\.254\./.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) ||
    url.hostname === "[::1]"
  ) {
    throw new Error("A mídia precisa estar em HTTPS público.");
  }
  return url.toString();
}

function assertCaption(text: string) {
  if (!text.trim() || text.length > 2200) {
    throw new Error("Legenda vazia ou acima do limite conservador de 2.200 caracteres.");
  }
}

function makeClient(options: MetaGraphOptions) {
  if (!/^v\d+\.\d+$/.test(options.version)) {
    throw new Error("Versão da API Meta inválida.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxChecks = options.maxChecks ?? 6;
  const checkIntervalMs = options.checkIntervalMs ?? 3000;
  if (!Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > 30) {
    throw new Error("Quantidade de verificações inválida.");
  }

  async function call(
    id: string,
    edge: string,
    token: string,
    body?: Record<string, string>,
    query?: Record<string, string>,
  ): Promise<MetaResponse> {
    if (!token || token.trim() !== token) throw new Error("Token Meta indisponível.");
    const url = new URL(`https://graph.facebook.com/${options.version}/${graphId(id)}${edge ? `/${edge}` : ""}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}),
      });
    } catch {
      // Uma falha de rede APÓS a requisição pode significar que a Meta publicou.
      // A camada de agendamento deve marcar resultado incerto, sem repetir sozinha.
      throw new Error("Resposta da Meta indisponível; verifique antes de tentar novamente.");
    }
    const data = (await response.json().catch(() => ({}))) as MetaResponse;
    if (!response.ok || data.error) {
      throw new MetaGraphError(response.status, data.error?.code, data.error?.error_subcode);
    }
    return data;
  }

  async function ready(containerId: string, token: string) {
    for (let attempt = 0; attempt < maxChecks; attempt++) {
      const status = await call(containerId, "", token, undefined, {
        fields: "status_code",
      });
      if (status.status_code === "FINISHED") return;
      if (
        status.status_code === "ERROR" ||
        status.status_code === "EXPIRED" ||
        status.status_code === "PUBLISHED"
      ) {
        throw new Error(`Contêiner Meta indisponível (${status.status_code}).`);
      }
      if (attempt < maxChecks - 1) await wait(checkIntervalMs);
    }
    throw new Error("Mídia ainda processando; confirme o estado antes de reenviar.");
  }

  return { call, ready };
}

/**
 * Publica um item autorizado IMEDIATAMENTE. Nunca use este helper do
 * navegador. O agendamento, a aprovação e a proteção contra duplicação
 * pertencem ao backend.
 */
export async function publishMeta(
  item: MetaPublishRequest,
  options: MetaGraphOptions,
): Promise<MetaPublishResult> {
  assertCaption(item.caption);
  const { call, ready } = makeClient(options);

  if (item.platform === "facebook") {
    const id = graphId(item.pageId);
    const response =
      item.format === "text"
        ? await call(id, "feed", item.accessToken, {
            message: item.caption,
          })
        : await call(id, "photos", item.accessToken, {
            caption: item.caption,
            url: publicMediaUrl(item.mediaUrl),
            published: "true",
          });
    if (!response.id) throw new Error("Meta não retornou identificador do post.");
    return { platform: "facebook", id: response.id, postId: response.post_id };
  }

  const igId = graphId(item.instagramAccountId);
  const response = await call(igId, "media", item.accessToken, {
    ...(item.format === "reel" ? { media_type: "REELS", share_to_feed: "true" } : {}),
    [item.format === "reel" ? "video_url" : "image_url"]: publicMediaUrl(item.mediaUrl),
    caption: item.caption,
  });
  if (!response.id) throw new Error("Meta não retornou identificador da mídia.");
  await ready(response.id, item.accessToken);
  const published = await call(igId, "media_publish", item.accessToken, {
    creation_id: response.id,
  });
  if (!published.id) throw new Error("Meta não confirmou o identificador da publicação.");
  return { platform: "instagram", id: published.id };
}
