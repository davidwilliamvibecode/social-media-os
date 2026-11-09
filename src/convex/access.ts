import { retrieveAccount } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  codeDigest,
  invitationDigest,
  normalizedEmail,
  randomAccessCode,
  randomInvitationCode,
} from "../data/access";
import {
  invitationEmailConfig,
  sendInvitationEmail,
} from "../data/invitation-email";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { activeUser } from "./activeUser";

/** Operator-only, via the Convex dashboard/CLI. Never available to app users. */
export const createInvite = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email: rawEmail }) => {
    const email = normalizedEmail(rawEmail);
    const old = await ctx.db
      .query("signupInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    for (const row of old) await ctx.db.delete(row._id);
    const code = randomInvitationCode();
    const expiresAt = Date.now() + 48 * 60 * 60 * 1_000;
    await ctx.db.insert("signupInvitations", {
      email,
      digest: await invitationDigest(code),
      expiresAt,
    });
    return { code, expiresAt };
  },
});

/** Operator-only: create the invitation and send it without exposing the code. */
export const sendInvite = internalAction({
  args: { email: v.string() },
  handler: async (
    ctx,
    { email: rawEmail },
  ): Promise<{ status: "accepted"; emailId: string; expiresAt: number }> => {
    const email = normalizedEmail(rawEmail);
    // Fail before replacing an existing invitation if configuration is missing.
    const config = invitationEmailConfig();
    const invite = await ctx.runMutation(internal.access.createInvite, {
      email,
    });
    let emailId: string;
    try {
      emailId = await sendInvitationEmail(config, email, invite);
    } catch {
      throw new ConvexError(
        "O Resend não confirmou o envio. Confira os registros no Resend antes de emitir outro convite.",
      );
    }
    // Acceptance by the API is not proof of arrival in the recipient's inbox.
    return { status: "accepted", emailId, expiresAt: invite.expiresAt };
  },
});

export const recoveryAccount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await activeUser(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    return user?.email ? { userId, email: user.email } : null;
  },
});

export const storeRecovery = internalMutation({
  args: { digest: v.string() },
  handler: async (ctx, { digest }) => {
    const userId = await activeUser(ctx);
    if (!userId) throw new ConvexError("Entre novamente.");
    const existing = await ctx.db
      .query("recoveryCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("recoveryCodes", {
      userId,
      digest,
      createdAt: Date.now(),
    });
  },
});

export const issueRecoveryCode = action({
  args: { password: v.string() },
  handler: async (ctx, { password }): Promise<string> => {
    const account = await ctx.runQuery(internal.access.recoveryAccount, {});
    if (!account || password.length > 128)
      throw new ConvexError("Não foi possível confirmar o acesso.");
    const result = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: account.email, secret: password },
    });
    if (result.user._id !== account.userId)
      throw new ConvexError("Não foi possível confirmar o acesso.");
    const code = randomAccessCode();
    await ctx.runMutation(internal.access.storeRecovery, {
      digest: await codeDigest(code),
    });
    return code;
  },
});

/** Atomic consumption: two simultaneous resets cannot use the same key. */
export const consumeRecovery = internalMutation({
  args: { email: v.string(), digest: v.string() },
  handler: async (ctx, { email, digest }) => {
    const row = await ctx.db
      .query("recoveryCodes")
      .withIndex("by_digest", (q) => q.eq("digest", digest))
      .unique();
    const user = row ? await ctx.db.get(row.userId) : null;
    if (!row || !user || user.email !== email)
      throw new ConvexError("Código inválido ou expirado.");
    await ctx.db.delete(row._id);
    return row.userId;
  },
});
