import { invitationDigest, normalizedEmail } from "./access";

const AUTH_URL = "https://social-media-os-b0c.pages.dev/auth";
const SEND_ERROR =
  "O Resend não confirmou o envio. Confira os registros no Resend antes de emitir outro convite.";

export function invitationEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const rawFrom = process.env.RESEND_FROM_EMAIL?.trim() ?? "";
  if (!apiKey.startsWith("re_") || /\s/.test(apiKey) || !rawFrom)
    throw new Error(
      "Configure RESEND_API_KEY e RESEND_FROM_EMAIL no Convex do Social Media OS.",
    );
  if (/[<>,;\r\n]/.test(rawFrom))
    throw new Error(
      "RESEND_FROM_EMAIL deve conter somente o e-mail remetente.",
    );
  const from = normalizedEmail(rawFrom);
  return { apiKey, from };
}

function escaped(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

/** Called only by the operator's internal action, never by frontend code. */
export async function sendInvitationEmail(
  config: ReturnType<typeof invitationEmailConfig>,
  email: string,
  invite: { code: string; expiresAt: number },
): Promise<string> {
  const digest = await invitationDigest(invite.code);
  const text = [
    "Seu acesso ao Social Media OS foi liberado.",
    `Abra ${AUTH_URL} e escolha “Recebi um convite — criar conta”.`,
    `Use este e-mail: ${email}`,
    `Seu código de convite: ${invite.code}`,
    "O convite é pessoal, válido por 48 horas e pode ser usado uma única vez.",
    "Crie sua própria senha e leia os Termos e a Política de Privacidade no cadastro.",
    "Se você não esperava este convite, ignore esta mensagem.",
    "Social Media OS — um produto de David William.",
  ].join("\n\n");
  const body = JSON.stringify({
    from: `Social Media OS <${config.from}>`,
    to: [email],
    subject: "Seu convite para o Social Media OS",
    text,
    html: `<div lang="pt-BR" style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:auto">
<h1>Seu acesso ao Social Media OS</h1>
<p>Seu acesso foi liberado para <strong>${escaped(email)}</strong>.</p>
<p><a href="${AUTH_URL}">Abrir cadastro</a> e escolher “Recebi um convite — criar conta”.</p>
<p>Copie seu código de convite:</p>
<p style="font-family:monospace;overflow-wrap:anywhere">${invite.code}</p>
<p>Convite pessoal, válido por <strong>48 horas</strong> e de uso único.</p>
<p>Crie sua própria senha e leia os Termos e a Política de Privacidade no cadastro.</p>
<p>Se você não esperava este convite, ignore esta mensagem.</p>
<p>Social Media OS — um produto de David William.</p></div>`,
  });

  // Retry only transient failures. An identical key/body prevents duplicate
  // messages when Resend accepted a request whose response was lost.
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let retry: boolean;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `social-media-os/invite/${digest}`,
        },
        body,
        signal: controller.signal,
      });
      if (response.ok) {
        const result: unknown = await response.json();
        if (
          result &&
          typeof result === "object" &&
          "id" in result &&
          typeof result.id === "string" &&
          result.id.length > 0
        )
          return result.id;
        retry = true;
      } else {
        retry = response.status === 429 || response.status >= 500;
      }
    } catch {
      // Do not forward provider bodies/errors: they may contain credentials
      // or the invitation. A network failure leaves delivery unconfirmed.
      retry = true;
    } finally {
      clearTimeout(timeout);
    }
    if (!retry || attempt === 2) throw new Error(SEND_ERROR);
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error(SEND_ERROR);
}
