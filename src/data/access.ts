export const LEGAL_VERSION = "2026-11-01-minuta";
export const MIN_PASSWORD_LENGTH = 8;
export const INVITATION_CODE_LENGTH = 8;

const INVITATION_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LONG_CODE_PATTERN = /^[a-f0-9]{64}$/;

export function normalizedEmail(value: unknown): string {
  const email =
    typeof value === "string"
      ? value.normalize("NFKC").trim().toLowerCase()
      : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Informe um e-mail válido.");
  return email;
}

export function validatePassword(
  password: unknown,
): asserts password is string {
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > 128
  ) {
    throw new Error(
      `A senha precisa ter de ${MIN_PASSWORD_LENGTH} a 128 caracteres.`,
    );
  }
}

export function randomAccessCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomInvitationCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(INVITATION_CODE_LENGTH))]
    .map((byte) => INVITATION_ALPHABET[byte & 63])
    .join("");
}

export function isInvitationCode(code: string): boolean {
  // Older invites retain their original digest and expiration date.
  return /^[A-Za-z0-9_-]{8}$/.test(code) || LONG_CODE_PATTERN.test(code);
}

export function invitationDigest(code: string): Promise<string> {
  if (!isInvitationCode(code)) throw new Error("Convite inválido ou expirado.");
  return hashCode(code);
}

export function codeDigest(code: string): Promise<string> {
  if (!LONG_CODE_PATTERN.test(code))
    throw new Error("Código inválido ou expirado.");
  return hashCode(code);
}

async function hashCode(code: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
