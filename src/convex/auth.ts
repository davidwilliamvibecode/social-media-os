import {
  convexAuth,
  invalidateSessions,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { ConvexError, type Value } from "convex/values";
import {
  LEGAL_VERSION,
  codeDigest,
  invitationDigest,
  isInvitationCode,
  normalizedEmail,
  validatePassword,
} from "../data/access";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";

const invitedPassword = Password({
  profile(params): Record<string, Value> & { email: string } {
    const email = normalizedEmail(params.email);
    if (params.flow !== "signUp") return { email };
    if (
      params.legalVersion !== LEGAL_VERSION ||
      params.acceptTerms !== "true"
    ) {
      throw new ConvexError(
        "Leia e aceite os termos e a privacidade antes de criar a conta.",
      );
    }
    const inviteCode =
      typeof params.inviteCode === "string" ? params.inviteCode.trim() : "";
    if (!isInvitationCode(inviteCode))
      throw new ConvexError("Convite inválido ou expirado.");
    return { email, signupInvitation: inviteCode, legalVersion: LEGAL_VERSION };
  },
  validatePasswordRequirements: validatePassword,
});

const recovery = ConvexCredentials({
  id: "recovery",
  authorize: async (params, ctx) => {
    const email = normalizedEmail(params.email);
    validatePassword(params.newPassword);
    const code =
      typeof params.recoveryCode === "string" ? params.recoveryCode.trim() : "";
    const userId = await ctx.runMutation(internal.access.consumeRecovery, {
      email,
      digest: await codeDigest(code),
    });
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: params.newPassword },
    });
    await invalidateSessions(ctx, { userId });
    return { userId };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [invitedPassword, recovery],
  callbacks: {
    createOrUpdateUser: async (ctx, { existingUserId, provider, profile }) => {
      const db = (ctx as MutationCtx).db;
      if (existingUserId) return existingUserId;
      if (provider.id !== "password")
        throw new ConvexError("Cadastro indisponível.");
      const email = normalizedEmail(profile.email);
      const digest = await invitationDigest(
        String(profile.signupInvitation ?? ""),
      );
      const invite = await db
        .query("signupInvitations")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (
        !invite ||
        invite.digest !== digest ||
        invite.usedAt ||
        invite.expiresAt <= Date.now()
      ) {
        throw new ConvexError("Convite inválido ou expirado.");
      }
      if (profile.legalVersion !== LEGAL_VERSION)
        throw new ConvexError("Atualize a página e aceite os termos atuais.");
      await db.patch(invite._id, { usedAt: Date.now() });
      return await db.insert("users", {
        email,
        legalVersion: LEGAL_VERSION,
        legalAcceptedAt: Date.now(),
      });
    },
  },
});
