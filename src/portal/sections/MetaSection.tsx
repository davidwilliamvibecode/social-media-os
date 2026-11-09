import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link2, CalendarClock, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/portal/Shared";

/**
 * Painel de contas e publicações orgânicas Meta.
 * Ativado apenas após VITE_META_ENABLED=true e configuração do backend.
 * O estado "Scheduled" do calendário, sozinho, NÃO publica nada.
 */
export function MetaSection() {
  const [searchParams] = useSearchParams();
  const connectionResult = searchParams.get("connection");
  const clients = useQuery(api.portal.listClients) ?? [];
  const content = useQuery(api.portal.listContent) ?? [];
  const [clientChoice, setClientChoice] = useState(() => searchParams.get("client") ?? "");
  const selectedClientId = clients.find((client) => client._id === clientChoice)?._id ?? clients[0]?._id ?? "";
  const clientId = selectedClientId as Id<"clients">;
  const candidates = useQuery(api.meta.listCandidates, selectedClientId ? { clientId } : "skip") ?? [];
  const accounts = useQuery(api.meta.listAccounts, selectedClientId ? { clientId } : "skip") ?? [];
  const posts = useQuery(api.meta.listPosts, selectedClientId ? { clientId } : "skip") ?? [];

  const startConnection = useAction(api.meta.startConnection);
  const selectAccount = useMutation(api.meta.selectAccount);
  const disconnectAccount = useMutation(api.meta.disconnectAccount);
  const schedulePost = useMutation(api.meta.schedulePost);
  const cancelPost = useMutation(api.meta.cancelPost);
  const issueMcpKey = useAction(api.metaMcp.issueKey);
  const revokeMcpKey = useMutation(api.metaMcp.revokeKey);
  const mcpKeys = useQuery(api.metaMcp.listKeys) ?? [];
  const operations = useQuery(
    api.metaMcp.listOperations,
    selectedClientId ? { clientId } : "skip",
  ) ?? [];
  const [provider, setProvider] = useState<"claude" | "chatgpt">("claude");
  const [newMcpKey, setNewMcpKey] = useState("");
  const backendUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "";
  const mcpUrl = backendUrl.replace(/\.convex\.cloud\/?$/, ".convex.site/mcp");


  const [contentChoice, setContentChoice] = useState("");
  const [accountChoice, setAccountChoice] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [localDateTime, setLocalDateTime] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const approved = content.filter(
    (item) => item.clientId === selectedClientId &&
      item.status === "Approved" &&
      (item.platform === "Facebook" || item.platform === "Instagram"),
  );
  const contentItem = approved.find((item) => item._id === contentChoice) ?? approved[0];
  const eligibleAccounts = accounts.filter(
    (account) => account.status === "active" && !account.tokenExpired &&
      (contentItem?.platform === "Instagram" ? Boolean(account.instagramId) : Boolean(account.pageId)),
  );
  const account = eligibleAccounts.find((a) => a.id === accountChoice) ?? eligibleAccounts[0];

  async function connect(channel: "instagram" | "facebook" | "facebookInstagram") {
    if (!selectedClientId || busy) return;
    setBusy(true);
    try {
      const url = await startConnection({ clientId, channel });
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar a Meta.");
      setBusy(false);
    }
  }

  async function schedule() {
    if (!contentItem || !account || !confirmed || !localDateTime || busy) return;
    setBusy(true);
    try {
      const scheduledAt = new Date(localDateTime).getTime();
      if (!Number.isFinite(scheduledAt)) throw new Error("Horário inválido.");
      await schedulePost({
        contentId: contentItem._id,
        accountId: account.id,
        scheduledAt,
        ...(mediaUrl.trim() ? { mediaUrl: mediaUrl.trim() } : {}),
      });
      toast.success("Agendamento registrado no Convex.");
      setConfirmed(false);
      setContentChoice("");
      setMediaUrl("");
      setLocalDateTime("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível agendar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Publicações Meta"
        description="Conecte contas profissionais do Instagram e Páginas do Facebook para agendar conteúdo aprovado."
      />
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Conectar Claude e ChatGPT</h2>
        <p className="text-xs text-muted-foreground">
          As duas IAs consultam o mesmo Social Media OS. Cada IA recebe uma chave
          própria e revogável; trocar a chave de uma não desconecta a outra.
          A possibilidade de cadastrar um conector próprio no ChatGPT depende
          dos recursos habilitados na conta.
        </p>
        <label htmlFor="meta-mcp-url" className="block text-xs">URL MCP compartilhada (Convex)</label>
        <input id="meta-mcp-url" className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs" readOnly value={mcpUrl} />
        <label htmlFor="meta-ai-provider" className="block text-xs">IA que receberá a nova chave</label>
        <select
          id="meta-ai-provider"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as "claude" | "chatgpt");
            setNewMcpKey("");
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="claude">Claude</option>
          <option value="chatgpt">ChatGPT</option>
        </select>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={async () => {
            if (!window.confirm(
              `Criar nova chave para ${provider === "claude" ? "Claude" : "ChatGPT"}? A chave anterior SOMENTE dessa IA será revogada.`
            )) return;
            setBusy(true);
            try {
              const token = await issueMcpKey({ provider });
              setNewMcpKey(token);
              toast.success("Chave gerada. Copie agora: não será exibida novamente.");
            } catch { toast.error("Não foi possível gerar uma chave."); }
            finally { setBusy(false); }
          }}>
          Gerar chave para {provider === "claude" ? "Claude" : "ChatGPT"}
        </Button>
        {newMcpKey && (
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-medium">Chave de {provider === "claude" ? "Claude" : "ChatGPT"}: copie uma única vez. Não compartilhe em chats ou repositórios.</p>
            <input aria-label="Chave de integração da IA" type="password" readOnly
              value={newMcpKey} className="w-full rounded-md border bg-background p-2 text-xs" />
            <Button size="sm" variant="outline" onClick={() => {
              void navigator.clipboard.writeText(newMcpKey)
                .then(() => toast.success("Chave copiada."))
                .catch(() => toast.error("Cópia não permitida neste navegador."));
            }}>Copiar chave</Button>
            <Button size="sm" variant="ghost" onClick={() => setNewMcpKey("")}>Ocultar chave</Button>
          </div>
        )}
        {mcpKeys.filter(key => !key.revokedAt).map(key => (
          <div key={key.id} className="flex items-center justify-between gap-3 text-xs">
            <span>
              {key.provider === "claude" ? "Claude" : key.provider === "chatgpt" ? "ChatGPT" : "Chave legada"}:
              {" "}ativa desde {new Date(key.createdAt).toLocaleString("pt-BR")}
            </span>
            <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
              if (!window.confirm("Revogar esta chave de integração?")) return;
              setBusy(true);
              try { await revokeMcpKey({ id: key.id }); setNewMcpKey(""); toast.success("Acesso revogado."); }
              catch { toast.error("Falha ao revogar."); }
              finally { setBusy(false); }
            }}>Revogar</Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          No serviço compatível com MCP, adicione a URL indicada e configure sua
          respectiva chave em Authorization: Bearer [chave].
          Nunca coloque a chave na URL. A função só responderá após
          META_MCP_ENABLED ser habilitada no Convex.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h2 className="font-semibold text-sm">Cliente e permissões</h2>
        </div>
        <label htmlFor="meta-client" className="block text-xs text-muted-foreground">Empresa</label>
        <select
          id="meta-client"
          value={selectedClientId}
          onChange={(event) => {
            setClientChoice(event.target.value);
            setContentChoice("");
            setAccountChoice("");
            setConfirmed(false);
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {clients.map((client) => (
            <option key={client._id} value={client._id}>{client.name}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Vincule apenas contas da empresa selecionada. Para Instagram, autorize uma conta profissional pelo Login Unificado da Meta.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!selectedClientId || busy} onClick={() => void connect("instagram")}>
            <Link2 className="mr-2 size-4" /> Conectar Instagram
          </Button>
          <Button variant="outline" disabled={!selectedClientId || busy} onClick={() => void connect("facebook")}>
            Conectar Facebook
          </Button>
          <Button variant="outline" disabled={!selectedClientId || busy} onClick={() => void connect("facebookInstagram")}>
            Conectar Facebook e Instagram
          </Button>
        </div>
        {connectionResult === "no-pages" && (
          <p role="status" className="text-sm text-muted-foreground">
            Nenhuma Página apta foi retornada. Confira as permissões e, se selecionou Instagram, o vínculo com uma conta profissional.
          </p>
        )}
        {connectionResult === "no-instagram" && (
          <p role="status" className="text-sm text-muted-foreground">
            Nenhuma conta profissional do Instagram foi compartilhada. Confira a conta e o portfólio selecionados na Meta.
          </p>
        )}
        {connectionResult === "denied" && <p role="status" className="text-sm text-muted-foreground">A conexão com a Meta foi cancelada.</p>}
        {connectionResult === "error" && <p role="status" className="text-sm text-muted-foreground">A Meta não pôde concluir a conexão. Inicie uma nova tentativa.</p>}
        {candidates.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Selecione a conta pertencente a esta empresa</p>
            {candidates.map((candidate) => (
              <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{candidate.pageName}</p>
                  <p className="text-xs text-muted-foreground">
                    {candidate.pageId ? `Página ${candidate.pageId}${candidate.instagramId ? " · Instagram vinculado" : ""}` : "Instagram profissional"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await selectAccount({ candidateId: candidate.id });
                      toast.success("Conta associada a esta empresa.");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Não foi possível associar.");
                    } finally { setBusy(false); }
                  }}
                >
                  Vincular
                </Button>
              </div>
            ))}
          </div>
        )}
        {accounts.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Contas vinculadas</p>
            {accounts.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div>
                  <p className="text-sm font-medium">{item.pageName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.pageId ? (item.instagramId ? "Facebook + Instagram" : "Facebook") : "Instagram"}
                    {" · "}{item.status === "active" ? "Ativa" : "Desconectada"}
                  </p>
                  {item.status === "active" && item.tokenExpiresAt && (
                    <p className="text-xs text-muted-foreground">
                      {item.tokenExpired ? "Autorização expirada. Reconecte o Instagram." :
                        `Autorização até ${new Date(item.tokenExpiresAt).toLocaleDateString("pt-BR")}`}
                    </p>
                  )}
                </div>
                {item.status === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm("Desconectar esta conta? Agendamentos pendentes serão cancelados.")) return;
                      setBusy(true);
                      try {
                        await disconnectAccount({ accountId: item.id });
                        toast.success("Conta desconectada.");
                      } catch { toast.error("Falha ao desconectar."); }
                      finally { setBusy(false); }
                    }}
                  >Desconectar</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" />
          <h2 className="font-semibold text-sm">Agendar conteúdo aprovado</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Apenas posts com status Aprovado no calendário aparecem aqui. A mídia precisa estar em URL HTTPS pública, acessível pela Meta na data da publicação.
        </p>
        <label htmlFor="meta-content" className="block text-xs">Conteúdo</label>
        <select
          id="meta-content"
          value={contentItem?._id ?? ""}
          onChange={(e) => { setContentChoice(e.target.value); setConfirmed(false); }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {approved.map((row) => <option key={row._id} value={row._id}>{row.platform} · {row.topic}</option>)}
        </select>
        <label htmlFor="meta-account" className="block text-xs">Conta de destino</label>
        <select
          id="meta-account"
          value={account?.id ?? ""}
          onChange={(e) => { setAccountChoice(e.target.value); setConfirmed(false); }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {eligibleAccounts.map((item) => <option key={item.id} value={item.id}>{item.pageName}</option>)}
        </select>
        {contentItem && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
            <span className="font-medium">Legenda aprovada:</span> {contentItem.caption || "Sem legenda"}
          </div>
        )}
        <label htmlFor="meta-media" className="block text-xs">URL HTTPS pública de imagem JPG ou vídeo (quando necessário)</label>
        <input
          id="meta-media"
          type="url"
          placeholder="https://.../post.jpg"
          value={mediaUrl}
          onChange={(e) => { setMediaUrl(e.target.value); setConfirmed(false); }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
        <label htmlFor="meta-date" className="block text-xs">Dia e horário (fuso horário deste dispositivo)</label>
        <input
          id="meta-date"
          type="datetime-local"
          value={localDateTime}
          onChange={(e) => { setLocalDateTime(e.target.value); setConfirmed(false); }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>Confirmei empresa, Página, legenda, mídia e horário. Autorizo o agendamento e a publicação automática neste destino.</span>
        </label>
        <Button
          disabled={busy || !contentItem || !account || !localDateTime || !confirmed}
          onClick={schedule}
        >Agendar publicação</Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Histórico de agendamentos</h2>
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum agendamento encontrado para esta empresa.</p>
        ) : posts.map((post) => (
          <div key={post._id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs">
            <div>
              <p className="font-medium">{post.platform} · {post.status}</p>
              <p className="text-muted-foreground">{new Date(post.scheduledAt).toLocaleString("pt-BR")}</p>
              {post.lastError && <p className="text-destructive">{post.lastError}</p>}
              {post.publishedId && <p className="text-muted-foreground">ID Meta: {post.publishedId}</p>}
            </div>
            {post.status === "scheduled" && (
              <Button
                size="sm" variant="outline" disabled={busy}
                onClick={async () => {
                  if (!window.confirm("Cancelar este agendamento?")) return;
                  setBusy(true);
                  try { await cancelPost({ postId: post._id }); toast.success("Agendamento cancelado."); }
                  catch { toast.error("Não foi possível cancelar."); }
                  finally { setBusy(false); }
                }}
              >Cancelar</Button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Histórico de comandos das IAs</h2>
        <p className="text-xs text-muted-foreground">
          Operações registradas de criação e agendamento, com origem identificada.
          Consultas não são gravadas neste histórico.
        </p>
        {operations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum comando de IA registrado para esta empresa.</p>
        ) : operations.slice(0, 30).map(item => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs">
            <span className="font-medium">{item.provider === "claude" ? "Claude" : "ChatGPT"}</span>
            <span>{item.operation === "create_draft" ? "Criou rascunho" : "Agendou publicação"}</span>
            <span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString("pt-BR")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
