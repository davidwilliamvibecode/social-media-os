import { describe, expect, test } from "bun:test";
import { MetaGraphError, publishMeta } from "../src/data/metaGraph";

type Captured = { url: URL; method: string; body: URLSearchParams; authorization: string };

function mockFetch(
  replies: Array<{ status?: number; data: Record<string, unknown> }>,
) {
  const calls: Captured[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: new URLSearchParams(String(init?.body ?? "")),
      authorization: headers.get("Authorization") ?? "",
    });
    const reply = replies[index++];
    if (!reply) throw new Error("Chamada inesperada");
    return Response.json(reply.data, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("Meta Graph: publicação isolada sem chamadas reais", () => {
  test("publica texto em Página Facebook, mantendo token fora da URL", async () => {
    const m = mockFetch([{ data: { id: "12345_98765" } }]);
    const result = await publishMeta(
      {
        platform: "facebook",
        format: "text",
        pageId: "123456789",
        caption: "Texto aprovado",
        accessToken: "SEGREDO-TOKEN",
      },
      { version: "v25.0", fetchImpl: m.fetchImpl },
    );
    expect(result).toEqual({ platform: "facebook", id: "12345_98765", postId: undefined });
    expect(m.calls[0].url.pathname).toBe("/v25.0/123456789/feed");
    expect(m.calls[0].body.get("message")).toBe("Texto aprovado");
    expect(m.calls[0].url.toString()).not.toContain("SEGREDO-TOKEN");
    expect(m.calls[0].authorization).toBe("Bearer SEGREDO-TOKEN");
  });

  test("envia foto à Página Facebook via /photos", async () => {
    const m = mockFetch([{ data: { id: "12345", post_id: "111_222" } }]);
    const result = await publishMeta(
      {
        platform: "facebook",
        format: "image",
        pageId: "123456789",
        caption: "Foto de teste",
        mediaUrl: "https://cdn.exemplo.com/foto.jpg",
        accessToken: "TOKEN",
      },
      { version: "v25.0", fetchImpl: m.fetchImpl },
    );
    expect(result.postId).toBe("111_222");
    expect(m.calls[0].url.pathname).toBe("/v25.0/123456789/photos");
    expect(m.calls[0].body.get("url")).toBe("https://cdn.exemplo.com/foto.jpg");
  });

  test("publica foto Instagram somente após contêiner FINISHED", async () => {
    const m = mockFetch([
      { data: { id: "222222222" } },
      { data: { status_code: "IN_PROGRESS" } },
      { data: { status_code: "FINISHED" } },
      { data: { id: "444444444" } },
    ]);
    const waits: number[] = [];
    const result = await publishMeta(
      {
        platform: "instagram",
        format: "image",
        instagramAccountId: "111111111",
        caption: "Conteúdo aprovado",
        mediaUrl: "https://assets.exemplo.com/post.jpg",
        accessToken: "TOKEN",
      },
      {
        version: "v25.0",
        fetchImpl: m.fetchImpl,
        wait: async (ms) => { waits.push(ms); },
      },
    );
    expect(result).toEqual({ platform: "instagram", id: "444444444" });
    expect(m.calls.map((c) => c.url.pathname)).toEqual([
      "/v25.0/111111111/media",
      "/v25.0/222222222",
      "/v25.0/222222222",
      "/v25.0/111111111/media_publish",
    ]);
    expect(m.calls[3].body.get("creation_id")).toBe("222222222");
    expect(waits).toEqual([3000]);
  });

  test("rejeita URL insegura, sem chamar a Meta", async () => {
    const m = mockFetch([]);
    await expect(publishMeta(
      {
        platform: "instagram",
        format: "image",
        instagramAccountId: "111111111",
        caption: "Teste",
        mediaUrl: "http://localhost/foto.jpg",
        accessToken: "TOKEN",
      },
      { version: "v25.0", fetchImpl: m.fetchImpl },
    )).rejects.toThrow("HTTPS público");
    expect(m.calls).toHaveLength(0);
  });

  test("erro Meta retorna somente status e códigos, jamais tokens", async () => {
    const m = mockFetch([
      { status: 403, data: { error: { code: 200, error_subcode: 10, message: "TOKEN-SIGILOSO" } } },
    ]);
    try {
      await publishMeta(
        {
          platform: "facebook",
          format: "text",
          pageId: "123456789",
          caption: "Teste",
          accessToken: "TOKEN-SIGILOSO",
        },
        { version: "v25.0", fetchImpl: m.fetchImpl },
      );
      throw new Error("Deveria falhar");
    } catch (error) {
      expect(error).toBeInstanceOf(MetaGraphError);
      expect(String(error)).not.toContain("TOKEN-SIGILOSO");
    }
  });
});
