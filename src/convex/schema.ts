import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove
      legalVersion: v.optional(v.string()),
      legalAcceptedAt: v.optional(v.number()),

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    signupInvitations: defineTable({
      email: v.string(),
      digest: v.string(),
      expiresAt: v.number(),
      usedAt: v.optional(v.number()),
    }).index("by_email", ["email"]),
    recoveryCodes: defineTable({
      userId: v.id("users"),
      digest: v.string(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_digest", ["digest"]),

    // ---- Social Media OS: manager workspace -----------------------------------
    // Every row is scoped to the signed-in manager through `ownerId`.

    clients: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      contactName: v.string(),
      email: v.string(),
      phone: v.string(),
      website: v.string(),
      industry: v.string(),
      packageName: v.string(),
      monthlyFee: v.number(),
      startDate: v.string(),
      status: v.string(), // ClientStatus
      socials: v.object({
        instagram: v.optional(v.string()),
        tiktok: v.optional(v.string()),
        linkedin: v.optional(v.string()),
        youtube: v.optional(v.string()),
        facebook: v.optional(v.string()),
        pinterest: v.optional(v.string()),
        other: v.optional(v.string()),
      }),
      notes: v.string(),
      onboarding: v.object({
        company: v.optional(v.string()),
        contact: v.optional(v.string()),
        brand: v.optional(v.string()),
        socialAccounts: v.optional(v.string()),
        audience: v.optional(v.string()),
        objectives: v.optional(v.string()),
        competitors: v.optional(v.string()),
        contentPreferences: v.optional(v.string()),
        approvalPreferences: v.optional(v.string()),
        importantDates: v.optional(v.string()),
        brandAssets: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
      strategy: v.array(
        v.object({
          key: v.string(),
          title: v.string(),
          items: v.array(v.string()),
        }),
      ),
      kpis: v.array(
        v.object({
          name: v.string(),
          baseline: v.string(),
          target: v.string(),
          actual: v.string(),
          unit: v.string(),
          deadline: v.string(),
        }),
      ),
      createdAt: v.number(),
    }).index("by_owner", ["ownerId"]),

    content: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      date: v.string(),
      platform: v.string(),
      format: v.string(),
      topic: v.string(),
      caption: v.string(),
      assetNote: v.string(),
      status: v.string(), // ContentStatus
      managerNotes: v.string(),
      clientComments: v.string(),
      pillar: v.string(),
      owner: v.string(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_client", ["clientId"]),

    tasks: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      title: v.string(),
      project: v.string(),
      category: v.string(),
      priority: v.string(), // Priority
      status: v.string(), // TaskStatus
      startDate: v.string(),
      dueDate: v.string(),
      completedAt: v.string(),
      dependsOn: v.string(),
      notes: v.string(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_client", ["clientId"]),

    requests: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      title: v.string(),
      category: v.string(),
      priority: v.string(),
      dateSubmitted: v.string(),
      status: v.string(), // RequestStatus
      assignedTo: v.string(),
      dueDate: v.string(),
      comments: v.string(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_client", ["clientId"]),

    meetings: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      title: v.string(),
      date: v.string(),
      time: v.string(),
      agenda: v.string(),
      participants: v.string(),
      status: v.string(), // MeetingStatus
      notes: v.string(),
      actionItems: v.string(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_client", ["clientId"]),

    deliverables: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      name: v.string(),
      category: v.string(),
      description: v.string(),
      date: v.string(),
      status: v.string(), // FileStatus
      relatedContent: v.string(),
      relatedProject: v.string(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_client", ["clientId"]),

    finance: defineTable({
      ownerId: v.id("users"),
      clientId: v.optional(v.id("clients")),
      date: v.string(),
      type: v.string(), // FinanceType
      amount: v.number(),
      category: v.string(),
      description: v.string(),
      status: v.string(), // FinanceStatus
      dueDate: v.string(),
      paidDate: v.string(),
      // "invoice" marks entries generated from a client's recurring monthly fee.
      kind: v.optional(v.string()),
    })
      .index("by_owner", ["ownerId"])
      .index("by_client", ["clientId"]),

    // Tabela legada do antigo login por código, preservada para não excluir
    // dados históricos. O login por senha não usa captcha nem grava grants;
    // os endpoints antigos de Turnstile foram removidos.
    turnstileGrants: defineTable({
      identifier: v.string(), // e-mail normalizado
      token: v.string(), // token do widget (auditoria)
      createdAt: v.number(),
      expiresAt: v.number(),
      usedAt: v.optional(v.number()),
    }).index("by_identifier", ["identifier"]),

    // Conexões Meta e publicações: separação por gestor e cliente.
    // Todos os tokens são criptografados por AES-GCM antes de chegar ao banco.
    metaOAuthStates: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      digest: v.string(),
      expiresAt: v.number(),
    }).index("by_digest", ["digest"]),

    metaCandidates: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      pageId: v.string(),
      pageName: v.string(),
      instagramId: v.optional(v.string()),
      encryptedToken: v.string(),
      expiresAt: v.number(),
    }).index("by_owner_client", ["ownerId", "clientId"]),

    metaAccounts: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      pageId: v.string(),
      pageName: v.string(),
      instagramId: v.optional(v.string()),
      encryptedToken: v.string(),
      connectedAt: v.number(),
      status: v.union(v.literal("active"), v.literal("revoked")),
    })
      .index("by_owner_client", ["ownerId", "clientId"])
      .index("by_owner_page", ["ownerId", "pageId"]),

    metaPosts: defineTable({
      ownerId: v.id("users"),
      clientId: v.id("clients"),
      contentId: v.id("content"),
      accountId: v.id("metaAccounts"),
      platform: v.union(v.literal("Facebook"), v.literal("Instagram")),
      format: v.union(v.literal("text"), v.literal("image"), v.literal("reel")),
      caption: v.string(),
      mediaUrl: v.optional(v.string()),
      scheduledAt: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
      status: v.union(
        v.literal("scheduled"),
        v.literal("publishing"),
        v.literal("published"),
        v.literal("uncertain"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      publishedId: v.optional(v.string()),
      lastError: v.optional(v.string()),
    })
      .index("by_owner", ["ownerId"])
      .index("by_owner_client", ["ownerId", "clientId"])
      .index("by_content", ["contentId"]),

    workspaces: defineTable({
      ownerId: v.id("users"),
      managerName: v.string(),
      agency: v.string(),
      email: v.string(),
      currency: v.string(),
      weekStart: v.string(),
      approvalTurnaroundDays: v.number(),
      notifyEmail: v.boolean(),
      notifyApprovals: v.boolean(),
      notifyFinance: v.boolean(),
      density: v.string(),
    }).index("by_owner", ["ownerId"]),
  },
  {
    // Production was audited before enabling database-level validation.
    schemaValidation: true,
  },
);

export default schema;
