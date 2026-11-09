import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { convexTest } from "convex-test";
import { invitationDigest } from "../src/data/access";
import { sendInvitationEmail } from "../src/data/invitation-email";
import { internal } from "../src/convex/_generated/api";
import schema from "../src/convex/schema";

const modules = {
  "../src/convex/_generated/api.js": () =>
    import("../src/convex/_generated/api"),
  "../src/convex/access.ts": () => import("../src/convex/access"),
};
const config = {
  apiKey: "re_test_placeholder_only",
  from: "convites@example.com",
};
const previous = {
  apiKey: process.env.RESEND_API_KEY,
  from: process.env.RESEND_FROM_EMAIL,
};
const accepted = () => Response.json({ id: "email-test-id" });
function requestBody(options?: RequestInit) {
  return JSON.parse(String(options?.body)) as {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
  };
}

beforeEach(() => {
  process.env.RESEND_API_KEY = config.apiKey;
  process.env.RESEND_FROM_EMAIL = config.from;
});
afterEach(() => {
  mock.restore();
  if (previous.apiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previous.apiKey;
  if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = previous.from;
});

describe("convites enviados pelo Resend", () => {
  test("sem configuração não envia nem substitui um convite anterior", async () => {
    const t = convexTest(schema, modules);
    const earlier = await t.mutation(internal.access.createInvite, {
      email: "gestor@example.com",
    });
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(accepted());
    delete process.env.RESEND_API_KEY;
    await expect(
      t.action(internal.access.sendInvite, { email: "gestor@example.com" }),
    ).rejects.toThrow("Configure RESEND_API_KEY");
    const rows = await t.run((ctx) =>
      ctx.db.query("signupInvitations").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].digest).toBe(await invitationDigest(earlier.code));
    expect(fetch).not.toHaveBeenCalled();
  });

  test("recusa destinatário inválido antes de emitir ou enviar", async () => {
    const t = convexTest(schema, modules);
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(accepted());
    await expect(
      t.action(internal.access.sendInvite, { email: "invalid" }),
    ).rejects.toThrow("e-mail válido");
    expect(
      await t.run((ctx) => ctx.db.query("signupInvitations").collect()),
    ).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("envia o convite correto de 48 horas; banco e retorno não expõem o código", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.access.createInvite, {
      email: "gestor@example.com",
    });
    const other = await t.mutation(internal.access.createInvite, {
      email: "outro@example.com",
    });
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(accepted());
    const before = Date.now();
    const result = await t.action(internal.access.sendInvite, {
      email: " GESTOR@example.com ",
    });
    const [url, options] = fetch.mock.calls[0];
    const body = requestBody(options);
    const code = body.text.match(/código de convite: ([A-Za-z0-9_-]{8})/)?.[1];
    expect(code).toBeDefined();
    const digest = await invitationDigest(code!);
    expect(url).toBe("https://api.resend.com/emails");
    expect(body.to).toEqual(["gestor@example.com"]);
    expect(body.from).toBe("Social Media OS <convites@example.com>");
    expect(body.text).toContain("https://social-media-os-b0c.pages.dev/auth");
    expect(body.html).toContain(code!);
    expect(body.html).not.toContain(`?code=${code}`);
    const headers = new Headers(options?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${config.apiKey}`);
    expect(headers.get("Idempotency-Key")).toBe(
      `social-media-os/invite/${digest}`,
    );
    expect(options?.redirect).toBe("error");
    const rows = await t.run((ctx) =>
      ctx.db.query("signupInvitations").collect(),
    );
    expect(rows).toHaveLength(2);
    const invitation = rows.find((row) => row.email === "gestor@example.com")!;
    expect(invitation.digest).toBe(digest);
    expect(invitation.expiresAt).toBeGreaterThanOrEqual(
      before + 48 * 60 * 60 * 1000,
    );
    expect(invitation.expiresAt).toBeLessThanOrEqual(
      Date.now() + 48 * 60 * 60 * 1000,
    );
    expect(rows.find((row) => row.email === "outro@example.com")!.digest).toBe(
      await invitationDigest(other.code),
    );
    expect(result).toEqual({
      status: "accepted",
      emailId: "email-test-id",
      expiresAt: invitation.expiresAt,
    });
    expect(JSON.stringify(rows)).not.toContain(code!);
    expect(JSON.stringify(result)).not.toContain(code!);
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  test("rejeição do Resend não vira sucesso nem expõe a resposta do provedor", async () => {
    const t = convexTest(schema, modules);
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ message: `private ${config.apiKey}` }, { status: 403 }),
    );
    let error = "";
    try {
      await t.action(internal.access.sendInvite, {
        email: "gestor@example.com",
      });
    } catch (failure) {
      error = String(failure);
    }
    expect(error).toContain("não confirmou");
    expect(error).not.toContain(config.apiKey);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  for (const status of [429, 503]) {
    test(`falha HTTP ${status} repete com o mesmo convite e chave de idempotência`, async () => {
      const t = convexTest(schema, modules);
      const fetch = spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(accepted());
      expect(
        (
          await t.action(internal.access.sendInvite, {
            email: "gestor@example.com",
          })
        ).status,
      ).toBe("accepted");
      expect(fetch).toHaveBeenCalledTimes(2);
      const [first, second] = fetch.mock.calls.map(([, options]) => options!);
      expect(first.body).toBe(second.body);
      expect(new Headers(first.headers).get("Idempotency-Key")).toBe(
        new Headers(second.headers).get("Idempotency-Key"),
      );
      expect(
        await t.run((ctx) => ctx.db.query("signupInvitations").collect()),
      ).toHaveLength(1);
    });
  }

  test("resposta perdida pode ser repetida sem criar outro código", async () => {
    const t = convexTest(schema, modules);
    const fetch = spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error(`network ${config.apiKey}`))
      .mockResolvedValueOnce(accepted());
    expect(
      (
        await t.action(internal.access.sendInvite, {
          email: "gestor@example.com",
        })
      ).status,
    ).toBe("accepted");
    expect(fetch.mock.calls[0][1]?.body).toBe(fetch.mock.calls[1][1]?.body);
  });

  test("falha persistente encerra em três tentativas sem revelar credenciais", async () => {
    const t = convexTest(schema, modules);
    const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
      new Error(`network ${config.apiKey}`),
    );
    await expect(
      t.action(internal.access.sendInvite, { email: "gestor@example.com" }),
    ).rejects.toThrow("não confirmou");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("HTTP 200 sem identificação do envio não é tratado como aceitação", async () => {
    const t = convexTest(schema, modules);
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({}),
    );
    await expect(
      t.action(internal.access.sendInvite, { email: "gestor@example.com" }),
    ).rejects.toThrow("não confirmou");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("escapa o destinatário no HTML do e-mail", async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(accepted());
    await sendInvitationEmail(config, "<teste>@example.com", {
      code: "Ab3_cd-E",
      expiresAt: Date.now() + 48 * 60 * 60 * 1000,
    });
    const body = requestBody(fetch.mock.calls[0][1]);
    expect(body.html).toContain("&lt;teste&gt;@example.com");
    expect(body.html).not.toContain("<teste>");
  });

  test("configuração do remetente não permite nome livre ou múltiplos endereços", async () => {
    const t = convexTest(schema, modules);
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(accepted());
    process.env.RESEND_FROM_EMAIL = "a@example.com,b@example.com";
    await expect(
      t.action(internal.access.sendInvite, { email: "gestor@example.com" }),
    ).rejects.toThrow("somente o e-mail remetente");
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await t.run((ctx) => ctx.db.query("signupInvitations").collect()),
    ).toHaveLength(0);
  });
});
