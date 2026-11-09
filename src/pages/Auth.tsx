import { useAuth } from "@/hooks/use-auth";
import {
  INVITATION_CODE_LENGTH,
  LEGAL_VERSION,
  MIN_PASSWORD_LENGTH,
  isInvitationCode,
} from "@/data/access";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import logo from "@/assets/logo.svg";
import { Loader2, LockKeyhole, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function safeRedirect(value: string | null, fallback: string) {
  if (
    value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  )
    return value;
  return fallback;
}

function readableError(error: unknown): string {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data === "string" && data.trim()) return data;
  return "Não foi possível autenticar. Verifique o e-mail, a senha e o código de convite.";
}

export default function Auth({
  redirectAfterAuth = "/app/dashboard",
}: AuthProps) {
  const { isLoading: checkingSession, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = safeRedirect(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [mode, setMode] = useState<"signIn" | "signUp" | "recovery">("signIn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!checkingSession && isAuthenticated)
      navigate(redirect, { replace: true });
  }, [checkingSession, isAuthenticated, navigate, redirect]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (mode !== "signIn" && password.length < MIN_PASSWORD_LENGTH) {
      setError(
        `Crie uma senha com pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      );
      return;
    }
    formData.set("email", email);
    formData.set("flow", mode);
    if (mode === "signUp") {
      const inviteCode = String(formData.get("inviteCode") ?? "").trim();
      if (!isInvitationCode(inviteCode)) {
        setError("Confira o código de convite que você recebeu.");
        return;
      }
      formData.set("inviteCode", inviteCode);
      formData.set("legalVersion", LEGAL_VERSION);
      formData.set(
        "acceptTerms",
        formData.get("acceptTerms") === "on" ? "true" : "false",
      );
    }
    if (mode === "recovery") formData.set("newPassword", password);
    setBusy(true);
    setError(null);
    try {
      await signIn(mode === "recovery" ? "recovery" : "password", formData);
      navigate(redirect, { replace: true });
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="grid-paper pointer-events-none absolute inset-0" />
      <Card className="relative w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <Link to="/" className="mx-auto mb-3">
            <img src={logo} alt="Social Media OS" width={64} height={64} />
          </Link>
          <CardTitle className="text-xl">
            {mode === "signIn"
              ? "Entrar no Social Media OS"
              : mode === "recovery"
                ? "Recuperar meu acesso"
                : "Criar minha conta"}
          </CardTitle>
          <CardDescription>
            {mode === "signIn"
              ? "Acesse seu espaço de trabalho com e-mail e senha."
              : mode === "recovery"
                ? "Use a chave de emergência gerada anteriormente em Configurações."
                : "Solicite seu convite ao suporte pelo canal combinado na contratação."}
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span>E-mail</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="nome@empresa.com"
                  className="pl-9"
                  disabled={busy || checkingSession}
                />
              </div>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span>{mode === "recovery" ? "Nova senha" : "Senha"}</span>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  type="password"
                  name="password"
                  required
                  minLength={mode !== "signIn" ? MIN_PASSWORD_LENGTH : 1}
                  maxLength={128}
                  autoComplete={
                    mode === "signIn" ? "current-password" : "new-password"
                  }
                  placeholder="Sua senha"
                  className="pl-9"
                  disabled={busy || checkingSession}
                />
              </div>
              {mode === "signUp" && (
                <p className="text-xs text-muted-foreground">
                  Use pelo menos {MIN_PASSWORD_LENGTH} caracteres. Depois de
                  entrar, gere sua chave de emergência em Configurações.
                </p>
              )}
            </label>
            {mode === "signUp" && (
              <label className="block space-y-1.5 text-sm">
                <span>Código de convite</span>
                <Input
                  type="password"
                  name="inviteCode"
                  required
                  minLength={INVITATION_CODE_LENGTH}
                  maxLength={64}
                  autoComplete="off"
                  placeholder="Código fornecido pelo administrador"
                  disabled={busy || checkingSession}
                />
                <p className="text-xs text-muted-foreground">
                  O administrador fornece o convite por contato privado. Use o
                  mesmo e-mail informado na contratação. Novos códigos têm{" "}
                  {INVITATION_CODE_LENGTH} caracteres, valem por 48 horas e são
                  usados somente no cadastro.
                </p>
              </label>
            )}
            {mode === "recovery" && (
              <label className="block space-y-1.5 text-sm">
                <span>Chave de emergência</span>
                <Input
                  type="password"
                  name="recoveryCode"
                  required
                  minLength={64}
                  maxLength={64}
                  autoComplete="off"
                  disabled={busy}
                />
                <p className="text-xs text-muted-foreground">
                  A chave é de uso único. Após recuperar, gere outra. Sem a
                  chave, procure o suporte.
                </p>
              </label>
            )}
            {mode === "signUp" && (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  name="acceptTerms"
                  required
                  disabled={busy}
                  className="mt-0.5"
                />
                <span>
                  Li e aceito os{" "}
                  <Link to="/termos" target="_blank" className="underline">
                    Termos de Uso
                  </Link>{" "}
                  e a{" "}
                  <Link to="/privacidade" target="_blank" className="underline">
                    Política de Privacidade
                  </Link>
                  .
                </span>
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              className="w-full"
              type="submit"
              disabled={busy || checkingSession}
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              {mode === "signIn"
                ? "Entrar"
                : mode === "recovery"
                  ? "Redefinir senha e entrar"
                  : "Criar conta"}
            </Button>
            {mode === "signIn" && (
              <Button
                type="button"
                variant="link"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode("recovery");
                }}
              >
                Esqueci minha senha — usar chave de emergência
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setError(null);
                setMode(mode === "signIn" ? "signUp" : "signIn");
              }}
              disabled={busy}
            >
              {mode === "signIn"
                ? "Recebi um convite — criar conta"
                : "Já tenho uma conta — entrar"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Ao usar o sistema, você concorda com os{" "}
              <Link to="/termos" className="underline">
                Termos
              </Link>{" "}
              e a{" "}
              <Link to="/privacidade" className="underline">
                Política de Privacidade
              </Link>
              .
            </p>
            <p className="text-center text-xs text-muted-foreground">
              Um produto de David William.
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
