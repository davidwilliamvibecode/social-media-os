# Integração direta da Meta com Social Media OS + Claude

**Atualização: 8 de novembro de 2026.** O código foi integrado somente à branch `main`. Nenhuma conta Meta foi conectada, nenhum token real foi coletado e nenhuma publicação real foi feita. A implantação no Convex/Cloudflare ainda depende das configurações descritas abaixo. **Não considerar comercialmente validado antes dos testes reais e da aprovação de permissões da Meta.**

## Visão geral do sistema

A mesma instalação Social Media OS poderá organizar vários gestores, com diversos clientes por gestor. O backend Convex valida `ownerId` e `clientId` em conexões, rascunhos, consultas e publicações.

1. O gestor cadastra uma empresa em `Clientes`.
2. No painel `Publicações Meta`, escolhe essa empresa e usa **Conectar conta Meta**, via Facebook Login oficial.
3. Depois do OAuth, seleciona uma Página Facebook daquela empresa; uma conta Instagram profissional vinculada pode ser disponibilizada junto.
4. O gestor/Claude prepara o conteúdo no calendário e passa pelo status **Aprovado**.
5. O gestor ou Claude agenda com data, horário, Página, legenda e mídia aprovada.
6. O Convex executa job persistente no horário e publica via Graph API.
7. O histórico guarda status e ID da Meta. Em falhas de resposta após o envio, mantém **incerto**, sem repetir para evitar duplicação.

**Escopo de publicações implantado no backend:** Facebook Page texto/foto e Instagram profissional imagem única/Reel. Stories, carrosséis e vídeos Facebook não foram implementados. O conector do Canva pode ajudar com a criação do conteúdo, mas uma URL de mídia HTTPS pública acessível pela Meta é necessária nas publicações com imagem/vídeo.

## Código adicionado

- `src/data/metaGraph.ts`: adaptador de publicação na API Meta; tokens em header, erros sanitizados.
- `src/convex/meta.ts`: OAuth de Páginas, criptografia AES-GCM de tokens em repouso, conexão por cliente, agendamento persistente, verificação de status e proteção contra duplicação.
- `src/convex/metaMcp.ts`: conector MCP remoto protegido por chave individual; criação de rascunhos e agendamentos aprovados.
- `src/convex/http.ts`: endpoints `GET /meta/oauth/callback` e `POST /mcp`.
- `src/convex/schema.ts`: tabelas de tokens, Páginas, postagens e chaves MCP, sempre vinculadas ao gestor.
- Proteções complementares: destino Meta fixado no agendamento para evitar postagem em outra Página após reconexão, cancelamento do job Convex, limpeza horária de autorizações OAuth vencidas e apagamento dos tokens quando uma conta é desconectada.
- Testes adicionais: agendamento e cancelamento, tentativa de publicar na empresa errada, alteração da Página, revogação e expiração de tokens.

- `src/portal/sections/MetaSection.tsx`: painel de contas e publicações e geração/revogação de chave Claude.
- `tests/meta-graph.test.ts`, `tests/meta-tenancy.test.ts` e `tests/no-session.test.ts`: verificações simuladas de API, segurança e isolamento.

### Flags de segurança

Não ativar sem terminar a implantação e os testes reais:

| Local | Nome | Valor para ativar |
| --- | --- | --- |
| Cloudflare Pages (build) | `VITE_META_ENABLED` | `true` (exibe a interface) |
| Convex (backend) | `META_PUBLISHING_ENABLED` | `true` (autoriza agendamento e execução real) |
| Convex (backend) | `META_MCP_ENABLED` | `true` (habilita conector Claude) |

**Default com flags ausentes é seguro: desativado.** Não declarar testes reais concluídos a partir dos testes simulados.

### Variáveis obrigatórias no Convex (nunca expor)

- `META_APP_ID`: App ID da Meta.
- `META_APP_SECRET`: segredo do aplicativo Meta.
- `META_GRAPH_VERSION`: versão da Graph API compatível e autorizada (formato `vXX.X`).
- `META_REDIRECT_URI`: URL exata do callback no Convex, como `https://SEU-DEPLOYMENT.convex.site/meta/oauth/callback`.
- `META_FRONTEND_ORIGIN`: origem exata do site Social Media OS (sem barra final), como `https://SEU-PROJETO.pages.dev`.
- `META_TOKEN_KEY_B64`: chave AES-GCM de **32 bytes**, em codificação Base64URL, gerada localmente por gerador criptográfico seguro. Guarde cópia em gerenciador de segredos; perda impede descriptografar tokens antigos.
- Flags opcionais acima para habilitação controlada.

Jamais inserir `META_APP_SECRET`, `META_TOKEN_KEY_B64` ou tokens de Páginas em variáveis `VITE_*`, issues, pull requests, e-mails ou chats.

## Configuração preparada para ESTE deployment

Os endereços abaixo já constam da instalação documentada em `docs/implantacao-mvp.md`. São **endereços públicos, não segredos**. Confirme que o deployment ainda é o de produção antes de concluir o formulário na Meta.

| Campo | Valor |
| --- | --- |
| Aplicativo a criar no Meta for Developers | **Social Media OS** |
| Origem do site / `META_FRONTEND_ORIGIN` | `https://social-media-os-b0c.pages.dev` |
| Callback de Facebook Login / `META_REDIRECT_URI` | `https://charming-leopard-770.convex.site/meta/oauth/callback` |
| Backend Convex (funções) | `https://charming-leopard-770.convex.cloud` |
| Endpoint MCP para o Claude | `https://charming-leopard-770.convex.site/mcp` |
| Permissões Meta a solicitar | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` |

**Como criar o aplicativo:** no Meta for Developers, crie um app com caso de uso de integração empresarial / Facebook Login e acesso a Páginas e Instagram profissional. Associe o app à organização Meta correta quando solicitado. Insira o callback exato em **Facebook Login → Configurações → URIs de redirecionamento OAuth válidas**. Configure o nome de exibição e contato com dados reais do responsável. A interface de criação e a nomenclatura dos casos de uso podem mudar; selecione as opções efetivamente oferecidas que permitam solicitar as cinco permissões acima.

**Fases de habilitação:** (1) configuração do app e credenciais no Convex; (2) login de teste e escolha de Página própria com `VITE_META_ENABLED=true`, mantendo publicação desativada; (3) testes reais controlados com `META_PUBLISHING_ENABLED=true`; (4) teste do conector Claude com `META_MCP_ENABLED=true`; (5) somente após aprovação Meta para outras empresas, liberação comercial.

**Atenção sobre Claude Free:** um conector MCP personalizado disponível no plano gratuito. A tela atual do Claude oferece autenticação por *cabeçalhos de solicitação*, incluindo `Authorization: Bearer …`. A chave criada no Social Media OS deve ser inserida apenas no campo seguro de conexão, jamais em mensagens. O conector é independente dos plugins Canva e GitHub do diretório.

## Etapas manuais para conectar empresas

1. Acesse https://developers.facebook.com/apps/ e crie um aplicativo do tipo adequado a Facebook Login e publicação.
2. Cadastre a URI exata do callback do Convex e os domínios permitidos. O uso de `*.pages.dev` na interface não elimina a necessidade de URI HTTPS válida e configuração da Meta.
3. Solicite apenas as permissões necessárias, conforme revisão atual da Meta: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`.
4. Para teste inicial, use uma Página de teste sob sua administração e uma conta Instagram profissional vinculada. As credenciais são concedidas por Facebook Login; clientes **não compartilham senhas**.
5. Antes de conectar contas comerciais de empresas externas, obtenha o nível de acesso/avaliação exigido pela Meta (App Review, Advanced Access e eventual verificação do negócio).
6. Configure segredos somente no Convex e habilite `VITE_META_ENABLED=true` no build Cloudflare Pages para visualizar a tela de conexão.
7. Mantenha `META_PUBLISHING_ENABLED` desativado até concluir teste de OAuth, separação entre empresas, aprovação, cancelamento, agendamento e publicação de teste.

## Claude e ChatGPT — conectores independentes para a mesma central

O Claude Free oferece **um conector MCP remoto personalizado**, conforme https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp. O ChatGPT pode utilizar o **mesmo endpoint MCP** quando a conta/workspace oferecer conexão personalizada com autenticação e ferramentas de escrita. A disponibilidade desse recurso deve ser validada na própria conta; o código preparado não comprova acesso ao conector na interface ChatGPT.

1. No Social Media OS, abra `Publicações Meta`, selecione **Claude** e gere sua chave. Depois selecione **ChatGPT** e gere outra chave. Cada uma é exibida uma vez. Trocar uma chave não revoga a da outra. As chaves antigas sem identificação de IA não autenticam mais: será necessário substituí-las.
2. Depois de ativar `META_MCP_ENABLED=true` e publicar o backend, abra **Claude → Personalizar → Conectores → Adicionar conector personalizado**.
3. Informe `https://SEU-DEPLOYMENT.convex.site/mcp`.
4. Selecione autenticação compatível com cabeçalho personalizado e configure `Authorization` com valor `Bearer SUA-CHAVE`. Não coloque a chave no URL.
5. Habilite o conector no Projeto Social Media Studio.

Ferramentas oferecidas:
- `list_clients`: lista empresas do gestor.
- `create_draft`: cria rascunho de post para uma empresa.
- `list_approved`: lista conteúdos aprovados de determinada empresa.
- `list_accounts`: lista as Páginas vinculadas, sem credenciais.
- `list_posts`: consulta agendamentos e resultados.
- `schedule_approved`: agenda conteúdo já aprovado, para conta correta, e exige `confirm=true`.

**Nenhuma das IAs recebe os tokens da Meta.** Cada chave MCP acessa exclusivamente os clientes do gestor autenticado; sua revogação é independente. Configure as chaves apenas nos campos seguros dos respectivos conectores, nunca em conversas, URLs, arquivos versionados ou logs.

### Comandos das duas IAs e proteção contra duplicação

- `create_draft` e `schedule_approved` exigem `commandId`: identificador único e estável de 8 a 120 caracteres alfanuméricos, underscore, hífen, ponto ou dois-pontos.
- Se uma tentativa falhar ou precisar ser repetida, **reutilize o mesmo `commandId`**. Alterar os dados mantendo o identificador será recusado.
- As IAs usam o mesmo banco Convex. Para um mesmo gestor e conteúdo, `schedule_approved` não cria outro agendamento se já existir um em curso; o reenvio idêntico retorna o registro existente.
- Rascunhos com conteúdo exatamente equivalente enviados por Claude e ChatGPT num intervalo de 10 minutos utilizam o mesmo documento de conteúdo, evitando duplicação acidental.
- Os registros de escrita bem-sucedida são salvos em `metaAiOperations` com **gestor, empresa, IA, comando, identificador do resultado e data**. O histórico fica disponível na seção `Publicações Meta`. Consultas de leitura e tentativas recusadas não são registradas nesse histórico.
- Não são aprovadas publicações pelo conector: o agendamento só ocorre para conteúdos anteriormente marcados como **Aprovado** no sistema e mediante `confirm=true` fornecido após autorização explícita.
- O backend Graph API permanece desativado por padrão (`META_PUBLISHING_ENABLED=false`). Não habilitar por conta de qualquer IA sem configuração e testes reais.

## Verificações mínimas para lançar com vários clientes

- [ ] GitHub CI: build, lint, testes de segurança e testes de Graph API simulados aprovados.
- [ ] Convex backend publicado com variáveis secretas em produção.
- [ ] Interface Cloudflare Pages publicada, com o botão Meta visível.
- [ ] OAuth real validado com Página/Instagram próprios.
- [ ] Post de teste realmente publicado pelo sistema e conferido na plataforma Meta.
- [ ] Dois gestores: nenhum acessa contas, rascunhos ou postagens do outro.
- [ ] Duas empresas do mesmo gestor: impossível escolher Página errada.
- [ ] Cancelamento antes do horário impede publicação.
- [ ] Falha de rede após envio não causa postagem duplicada.
- [ ] Chaves MCP independentes criadas, testadas e revogadas para Claude e ChatGPT (se o plano habilitar conector ChatGPT).
- [ ] Duas IAs executam comandos com `commandId` repetido e não criam rascunhos/agendamentos duplicados.
- [ ] Histórico de operações identifica IA e empresa corretas sem vazar credenciais.
- [ ] Revisão das permissões Meta aprovada para contas de empresas externas.
- [ ] Operação com limites/custos do Convex observados e suporte definido.

## Links oficiais

- Meta Developer: https://developers.facebook.com/
- API Instagram: https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api
- Permissões Meta: https://developers.facebook.com/docs/permissions/
- Convex scheduling: https://docs.convex.dev/scheduling/scheduled-functions
- Claude MCP: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
