// Regression tests for the MVP's only supported login mechanism.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { convexTest } from "convex-test";
import { LEGAL_VERSION, invitationDigest } from "../src/data/access";
import { api, internal } from "../src/convex/_generated/api";
import schema from "../src/convex/schema";

const modules = {
  "../src/convex/_generated/api.js": () =>
    import("../src/convex/_generated/api"),
  "../src/convex/access.ts": () => import("../src/convex/access"),
  "../src/convex/auth.ts": () => import("../src/convex/auth"),
  "../src/convex/portal.ts": () => import("../src/convex/portal"),
  "../src/convex/users.ts": () => import("../src/convex/users"),
};

const email = "gestor@example.com";
const password = "Strong-Test-Password-2026!";
const inviteCode = "1".repeat(64);
let testPrivateKeyPem = "";

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const bytes = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const base64 = Buffer.from(bytes).toString("base64");
  const lines = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  testPrivateKeyPem = `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
});
afterAll(() => {
  testPrivateKeyPem = "";
});
beforeEach(() => {
  process.env.JWT_PRIVATE_KEY = testPrivateKeyPem;
  process.env.CONVEX_SITE_URL = "https://social-media-os.example.com";
  process.env.SITE_URL = "https://social-media-os.example.com";
});
afterEach(() => {
  delete process.env.JWT_PRIVATE_KEY;
  delete process.env.CONVEX_SITE_URL;
  delete process.env.SITE_URL;
});

async function signIn(
  t: ReturnType<typeof convexTest>,
  flow: "signUp" | "signIn",
  extra: Record<string, string> = {},
) {
  return t.action(api.auth.signIn, {
    provider: "password",
    params: {
      email,
      password,
      flow,
      acceptTerms: "true",
      legalVersion: LEGAL_VERSION,
      ...extra,
    },
  });
}

describe("password access — single deployment MVP", () => {
  test("signup without invitation is rejected and doesn't create a user", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert("signupInvitations", {
        email,
        digest: await invitationDigest(inviteCode),
        expiresAt: Date.now() + 60_000,
      }),
    );
    await expect(signIn(t, "signUp")).rejects.toThrow();
    expect(
      await t.run(async (ctx) => ctx.db.query("users").collect()),
    ).toHaveLength(0);
  });

  test("signup with wrong invitation is rejected", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert("signupInvitations", {
        email,
        digest: await invitationDigest(inviteCode),
        expiresAt: Date.now() + 60_000,
      }),
    );
    await expect(
      signIn(t, "signUp", { inviteCode: "NoMatch_" }),
    ).rejects.toThrow();
    expect(
      await t.run(async (ctx) => ctx.db.query("users").collect()),
    ).toHaveLength(0);
  });

  test("weak signup password is rejected", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert("signupInvitations", {
        email,
        digest: await invitationDigest(inviteCode),
        expiresAt: Date.now() + 60_000,
      }),
    );
    await expect(
      signIn(t, "signUp", { inviteCode, password: "Seven7!" }),
    ).rejects.toThrow();
    expect(
      await t.run(async (ctx) => ctx.db.query("users").collect()),
    ).toHaveLength(0);
  });

  test("valid invitation creates account; subsequent login does not require invitation", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert("signupInvitations", {
        email,
        digest: await invitationDigest(inviteCode),
        expiresAt: Date.now() + 60_000,
      }),
    );
    const created = await signIn(t, "signUp", { inviteCode });
    expect(created).toBeTruthy();
    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe(email);

    const signedIn = await signIn(t, "signIn");
    expect(signedIn).toBeTruthy();
    expect(
      await t.run(async (ctx) => ctx.db.query("users").collect()),
    ).toHaveLength(1);
  });

  test("wrong password is refused", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert("signupInvitations", {
        email,
        digest: await invitationDigest(inviteCode),
        expiresAt: Date.now() + 60_000,
      }),
    );
    await signIn(t, "signUp", { inviteCode });
    await expect(
      signIn(t, "signIn", { password: "Wrong-Password-2026!" }),
    ).rejects.toThrow();
  });

  test("removed anonymous and email OTP providers cannot sign in", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert("signupInvitations", {
        email,
        digest: await invitationDigest(inviteCode),
        expiresAt: Date.now() + 60_000,
      }),
    );
    for (const provider of ["anonymous", "email-otp"]) {
      await expect(
        t.action(api.auth.signIn, { provider, params: { email } }),
      ).rejects.toThrow();
    }
    expect(
      await t.run(async (ctx) => ctx.db.query("users").collect()),
    ).toHaveLength(0);
  });

  test("invitation is bound to email, expires, and is stored as a hash", async () => {
    const t = convexTest(schema, modules);
    const invitation = await t.mutation(internal.access.createInvite, {
      email,
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("signupInvitations").collect(),
    );
    expect(rows[0].digest).not.toBe(invitation.code);
    expect(JSON.stringify(rows)).not.toContain(invitation.code);
    await expect(
      signIn(t, "signUp", {
        email: "other@example.com",
        inviteCode: invitation.code,
      }),
    ).rejects.toThrow();
    await t.run((ctx) =>
      ctx.db.patch(rows[0]._id, { expiresAt: Date.now() - 1 }),
    );
    await expect(
      signIn(t, "signUp", { inviteCode: invitation.code }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(
      0,
    );
  });

  test("new invite revokes the previous one; accepted version and timestamp are recorded", async () => {
    const t = convexTest(schema, modules);
    const old = await t.mutation(internal.access.createInvite, { email });
    const current = await t.mutation(internal.access.createInvite, { email });
    await expect(
      signIn(t, "signUp", { inviteCode: old.code }),
    ).rejects.toThrow();
    await expect(
      signIn(t, "signUp", { inviteCode: current.code, acceptTerms: "false" }),
    ).rejects.toThrow();
    expect(current.code).toMatch(/^[A-Za-z0-9_-]{8}$/);
    const shortPassword = "First8!a";
    await signIn(t, "signUp", {
      inviteCode: current.code,
      password: shortPassword,
    });
    expect(await signIn(t, "signIn", { password: shortPassword })).toBeTruthy();
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users[0].legalVersion).toBe(LEGAL_VERSION);
    expect(users[0].legalAcceptedAt).toBeGreaterThan(0);
    expect(
      (users[0] as Record<string, unknown>).signupInvitation,
    ).toBeUndefined();
    expect(
      (await t.run((ctx) => ctx.db.query("signupInvitations").collect()))[0]
        .usedAt,
    ).toBeGreaterThan(0);
  });

  test("recovery key changes password, preserves owner/data, revokes sessions and cannot be reused", async () => {
    const t = convexTest(schema, modules);
    const invite = await t.mutation(internal.access.createInvite, { email });
    await signIn(t, "signUp", { inviteCode: invite.code });
    const session = (
      await t.run((ctx) => ctx.db.query("authSessions").collect())
    )[0];
    const asUser = t.withIdentity({
      subject: `${session.userId}|${session._id}`,
    });
    await asUser.mutation(api.portal.saveWorkspace, {
      patch: { agency: "Preservar agência" },
    });
    await expect(
      asUser.action(api.access.issueRecoveryCode, { password: "incorrect" }),
    ).rejects.toThrow();
    const code = await asUser.action(api.access.issueRecoveryCode, {
      password,
    });
    const stored = await t.run((ctx) =>
      ctx.db.query("recoveryCodes").collect(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].digest).not.toBe(code);
    expect(code).toMatch(/^[a-f0-9]{64}$/);
    const newPassword = "Short8!a";
    await expect(
      t.action(api.auth.signIn, {
        provider: "recovery",
        params: { email: "other@example.com", recoveryCode: code, newPassword },
      }),
    ).rejects.toThrow();
    await expect(
      t.action(api.auth.signIn, {
        provider: "recovery",
        params: { email, recoveryCode: code, newPassword: "weak" },
      }),
    ).rejects.toThrow();
    await t.action(api.auth.signIn, {
      provider: "recovery",
      params: { email, recoveryCode: code, newPassword },
    });
    expect(await asUser.query(api.portal.getWorkspace)).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("recoveryCodes").collect()),
    ).toHaveLength(0);
    await expect(
      t.action(api.auth.signIn, {
        provider: "recovery",
        params: { email, recoveryCode: code, newPassword },
      }),
    ).rejects.toThrow();
    await expect(signIn(t, "signIn")).rejects.toThrow();
    await signIn(t, "signIn", { password: newPassword });
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0]._id).toBe(session.userId);
    const workspace = (
      await t.run((ctx) => ctx.db.query("workspaces").collect())
    )[0];
    expect(workspace.ownerId).toBe(session.userId);
    expect(workspace.agency).toBe("Preservar agência");
  });

  test("generating a second recovery key invalidates the first", async () => {
    const t = convexTest(schema, modules);
    const invite = await t.mutation(internal.access.createInvite, { email });
    await signIn(t, "signUp", { inviteCode: invite.code });
    const session = (
      await t.run((ctx) => ctx.db.query("authSessions").collect())
    )[0];
    const asUser = t.withIdentity({
      subject: `${session.userId}|${session._id}`,
    });
    const old = await asUser.action(api.access.issueRecoveryCode, { password });
    const current = await asUser.action(api.access.issueRecoveryCode, {
      password,
    });
    expect(current).not.toBe(old);
    await expect(
      t.action(api.auth.signIn, {
        provider: "recovery",
        params: { email, recoveryCode: old, newPassword: password },
      }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("recoveryCodes").collect()),
    ).toHaveLength(1);
  });
});
