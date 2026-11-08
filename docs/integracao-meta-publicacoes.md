# Integração direta Meta Graph API + Social Media OS + Claude

**Situação em 2026-11-08:** implementação iniciada, **não habilitada para publicação real**. O módulo `src/data/metaGraph.ts` contém chamadas servidor-servidor para publicar texto/foto em Páginas Facebook e foto/Reel em Instagram profissional, com testes simulados. Nenhum token foi criado, conectado ou publicado.

## Objetivo

Reaproveitar o app atual, com gestores isolados por `ownerId`, clientes por `clientId` e fluxo de aprovação existente. Permitir criar/aprovar conteúdo e agendar publicações para **várias empresas**, sem Metricool. Posteriormente, um único conector MCP remoto protegido permitirá que Claude crie rascunhos e solicite agendamentos no mesmo backend.

## Arquitetura aprovada para implementação

1. **OAuth oficial da Meta**. O gestor acessa o aplicativo, seleciona um cliente, usa Facebook Login, concede acesso apenas às Páginas autorizadas e escolhe explicitamente qual Página/Instagram pertence àquele cliente. Não coletar senhas.
2. **Credenciais separadas**. Metadados de Página/IG por `ownerId + clientId`. Tokens de Página criptografados no servidor em repouso, nunca em `VITE_*`, respostas do navegador, GitHub, logs ou backup JSON.
3. **Mídia validada**. Antes da aprovação, verificar formato, tipo MIME e URL HTTPS pública temporariamente acessível pela Meta; armazenar ativos em storage apropriado quando necessário.
4. **Aprovação**. Só agendar conteúdo de um cliente cujo status final esteja **Approved**, com canal, mídia, legenda, destino e fuso horário confirmados. Salvar um snapshot imutável da publicação aprovada.
5. **Agendamento durável**. `ctx.scheduler.runAt` do Convex executa um job por conta+conteúdo no horário UTC. Não é necessário cron externo para publicações avulsas.
6. **Publicação controlada**. Um job bloqueia atomicamente duplicações antes da chamada externa. Quando há timeout após envio, registrar estado **incerto** e reconciliar antes de qualquer tentativa de repetição.
7. **Auditoria**. Registrar somente metadados: cliente, plataforma, data, estado, ID da mídia, erros sanitizados. Reconectar quando token expirar ou for revogado.
8. **Conector Claude**. Publicar servidor MCP remoto autenticado com `list_clients`, `draft_post`, `list_pending`, `schedule_approved_post` e `get_publication_status`. Todas as operações devem usar o mesmo `ownerId` e conferir `clientId`. Não permitir postagem sem aprovação explícita.

### Dependências externas para ativar

- Criar aplicativo em https://developers.facebook.com/apps/
- Configurar o produto Facebook Login e uma URL de callback HTTPS do backend.
- Configurar identificador/segredo do app e chave de criptografia **apenas em variáveis secretas do backend Convex**.
- Autorizações necessárias, conforme modalidade: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` e `instagram_content_publish`. Verificar permissões e recursos atuais diretamente no painel Meta.
- Contas do Instagram **profissionais**, vinculadas à Página quando usado Facebook Login; perfis pessoais não são suportados para publicação via esta modalidade.
- Em acesso a empresas que não são administradoras/testadoras do app, solicitar **acesso avançado/App Review** e eventual verificação do negócio, conforme requisitos atuais da Meta.
- Não é possível concluir o teste de publicação real sem uma Página/Instagram de teste autorizados e credenciais aprovadas.

### Escopo inicial

- Facebook Pages: textos e imagens.
- Instagram profissional: imagem única e Reel.
- Carrosséis, Stories, múltiplas imagens e relatórios de insights entram apenas após validar os fluxos centrais.
- Nada será publicado enquanto a aprovação e integração OAuth não estiverem completas.

### Estado do código

- `src/data/metaGraph.ts`: biblioteca de execução, **não ligada à UI nem ao scheduler**.
- `tests/meta-graph.test.ts`: testes locais sem chamadas à Meta.
- OAuth, armazenamento criptografado, scheduling com guarda de duplicações, MCP e UI: **pendentes**.

## Passos para validação

1. CI: lint, build e testes simulados.
2. Configuração da Meta (sem tokens em conversa).
3. Login OAuth em conta própria e Página de teste.
4. Agendar e cancelar publicação fictícia na própria Página.
5. Publicação real de teste, conferindo ID, horário, URL e status.
6. Duas contas distintas: confirmar que gestor A não acessa contas/postagens do gestor B.
7. Dois clientes do mesmo gestor: impedir que a mídia do cliente A seja publicada na Página do cliente B.
8. Falhas: expiração de token, URL de mídia inválida, API indisponível, duplicação e cancelamento.
9. App Review para uso comercial por terceiros.
10. Só liberar clientes após todos os testes acima.

## Conector do Claude gratuito

A Anthropic permite um conector MCP personalizado no Free:
https://support.claude.com/pt/articles/11175166-comece-com-conectores-personalizados-usando-mcp-remoto

O conector precisará de autenticação independente e escopo estrito. Não basta o plugin `Meta Ads`: campanhas pagas e posts orgânicos são produtos distintos.

## Referências oficiais

- https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api
- https://docs.convex.dev/scheduling/scheduled-functions
- https://developers.facebook.com/docs/permissions/
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
