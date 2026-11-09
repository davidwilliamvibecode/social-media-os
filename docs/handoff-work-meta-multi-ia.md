# Handoff para ChatGPT Work — Social Media OS + Claude + ChatGPT + Meta

**Última revisão da central multi-IA:** novembro/2026. Este documento é instrução de implantação, não confirmação de funcionamento em produção.

## Estado confirmado no GitHub

- Repositório: `davidwilliamvibecode/social-media-os`, **somente main**.
- Uma instalação Convex Production documentada: `charming-leopard-770`.
- Uma instalação Cloudflare Pages: `https://social-media-os-b0c.pages.dev`.
- CI obrigatória: `bun run audit`, `bun run lint`, `bun run build`, `bun test`.
- Integração Meta no código (`src/convex/meta.ts`, `src/data/metaGraph.ts`): OAuth, agendamento persistente, publicação Facebook/Instagram em formatos limitados.
- Endpoint MCP compartilhado em `src/convex/metaMcp.ts`, `POST https://charming-leopard-770.convex.site/mcp`.
- Proteções novas para **duas IAs**: chave por gestor+provedor (`claude` ou `chatgpt`), rotação/revogação independente, isolamento por `ownerId`/`clientId`, rascunhos idempotentes em intervalo curto, agendamento único por conteúdo e `commandId` estável. Registro de escritas por IA e cliente em `metaAiOperations`.
- Testes relevantes: `tests/meta-dual-ai.test.ts` e `tests/meta-mcp-http.test.ts`.

## Próximas operações em Work

1. Confirmar que o último commit da **main** passou em CI.
2. Acessar o projeto Convex Production atual (não outro) e verificar se o backend novo foi de fato implantado. Uma rota MCP 404 indica implantação ausente/desatualizada; **não tratar CI como deploy**.
3. Em Meta for Developers, localizar ou criar um app sob a conta autorizada, configurar Facebook Login e callback exato: `https://charming-leopard-770.convex.site/meta/oauth/callback`.
4. Configurar no Convex os segredos `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, `META_REDIRECT_URI`, `META_FRONTEND_ORIGIN` e `META_TOKEN_KEY_B64`. Nunca inserir valores em chat, GitHub ou variáveis `VITE_*`.
5. Publicar o backend no Convex e habilitar SOMENTE a interface de configuração no Cloudflare Pages, `VITE_META_ENABLED=true`, após verificar compatibilidade.
6. Confirmar a autenticação da Meta em conta de teste própria e verificar que cada Página fica vinculada ao cliente correto.
7. Configurar `META_MCP_ENABLED=true` somente depois de auditar o endpoint implantado. Criar a chave `claude` e testar uma consulta e criação de rascunho. Criar a chave `chatgpt` e testar no ChatGPT **se a conta/workspace disponibilizar um conector personalizado de escrita autenticado**; do contrário, documentar o bloqueio de produto e não prometer ativação.
8. Validar a independência das chaves, rotação, revogação, idempotência e auditoria em ambiente com dados fictícios.
9. Somente com aprovação expressa do titular, testar publicação em Página/Instagram próprios; até então, manter `META_PUBLISHING_ENABLED` ausente/false.
10. Verificar App Review/Advanced Access e requisitos oficiais da Meta antes de conectar empresas externas.

## Limites e segurança

- Nunca usar TinyFish, Metricool, automações pagas, novo domínio, novas branches ou projetos duplicados.
- Não criar/editar contas empresariais reais sem aprovação.
- Não copiar tokens para prompts ou relatórios.
- MCP não transmite tokens Meta; guarda hashes das credenciais MCP e tokens Meta cifrados.
- `commandId` é obrigatório nos comandos de escrita MCP, deve ser único por operação e repetido em reenvios. Dois provedores usam o mesmo banco de dados e o mesmo endpoint.
- Aprovação do conteúdo no sistema e `confirm=true` são requisitos do agendamento MCP. A confirmação recebida pelo modelo deve corresponder a autorização genuína do usuário.
- Escopo inicial: texto/foto em Página Facebook; imagem única e Reel em Instagram profissional. Não alegar suporte a Stories, carrosséis, mídia automática do Canva ou analytics conectado.
- Quando houver dúvida se uma publicação foi feita após timeout, não repetir a chamada: marcar resultado incerto e verificar na Meta.
- Se houver falha em deploy, registrar erro real; não alterar configuração de produção para tentar contornar proteção.
- Devolver uma tabela objetiva: etapa, ação feita, evidência, pendência, se houve alteração em produção.

Referência técnica detalhada: `docs/integracao-meta-publicacoes.md`.
