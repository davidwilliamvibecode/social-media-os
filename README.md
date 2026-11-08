# Social Media OS — MVP de gestão de clientes e conteúdo

Um produto de David William.

Aplicação React + TypeScript + Vite + Convex para **um gestor de social media por conta**, com vários clientes cadastrados no seu espaço. Clientes não possuem login e não veem o painel.

## O que já existe

- Cadastro e acompanhamento de clientes, estratégia e onboarding
- Planejamento e calendário de conteúdo, tarefas, aprovações e solicitações
- Reuniões, registros de entregas e financeiro manual
- Exportação/importação de backup JSON do workspace
- CSV dos dados reais em Configurações, com filtro por cliente; planilha de referência de 29 abas separada.

**Publicação automática Meta (código em preparação):** existe uma integração opcional com Facebook Pages e Instagram profissional, incluindo OAuth, agendamento Convex e conector Claude. Ela permanece **desativada por padrão**, sem testes reais de postagem ou aprovação comercial da Meta; não ofereça publicação automática a clientes até validar a implantação descrita em [integração Meta](docs/integracao-meta-publicacoes.md). **Não inclui** métricas conectadas às redes sociais, portal do cliente, cobrança automática, campanhas por e-mail ou sincronização da planilha com o banco. O acesso inicial usa **entrega assistida do convite**, sem domínio próprio ou serviço de e-mail. A integração Resend é opcional e permanece sem configuração de envio; consulte [convites-resend.md](docs/convites-resend.md).

## Arquitetura única

- Frontend: Cloudflare Pages (uma única branch `main`, um único endereço público).
- Backend e banco: **um único deployment Convex**, com autenticação Convex Auth e dados isolados por `ownerId`.
- Login: e-mail/senha, convites individuais de uso único emitidos pelo operador via função interna `access:createInvite` e entregues por contato privado; recuperação com chave de emergência gerada pelo gestor.
- Sem domínio próprio obrigatório para a URL `*.pages.dev`.
- Recuperação por chave de emergência previamente gerada em Configurações. Sem reset ou verificação automática por e-mail.

## Operação e implantação

Consulte [docs/implantacao-mvp.md](docs/implantacao-mvp.md) para a configuração exata de Convex, Cloudflare Pages, ações necessárias, testes de segurança e entrega do primeiro cliente.

## Fluxo de uso

1. Operador confere a identidade do novo gestor pelo contato combinado na contratação, gera o convite pela função interna `access:createInvite` e o entrega por esse canal privado. O código é exigido apenas no cadastro; os próximos acessos usam e-mail e senha.
2. Gestor abre `/auth`, cria a conta com e-mail, senha de 12+ caracteres e convite.
3. Gestor cadastra o primeiro cliente e utiliza painel, calendário, tarefas e financeiro.
4. Gere sua chave de emergência, faça backups JSON e exporte relatórios CSV reais em Configurações.
5. Cancelamento, suporte e recebimento de assinatura são feitos **fora do app**.

## Desenvolvimento

```bash
bun install --frozen-lockfile
# Backend: configurar CONVEX_DEPLOY_KEY e variáveis de Convex Auth
bunx convex deploy
bun run lint
bun test
bun run build
```

Os tipos em `src/convex/_generated` são gerados pelo CLI Convex; o CI usa uma instância Convex local e temporária para validar o build e os testes sem segredos de produção. A publicação real precisa de autorização no Convex. Não inclua chaves em `VITE_*`, commits ou issues.

## Segurança

- Backend exige autenticação em mutations, filtra listagens por `ownerId` e valida referências de clientes nas escritas.
- As importações de JSON são validadas, limitadas e transacionais; os IDs de origem não viram identidades de destino.
- A chave privada `.env.keys` foi removida da branch principal; **rotacione-a se foi utilizada, pois o histórico do Git é público**.
- Antes de vender, rode todos os testes, verifique o login de duas contas distintas e valide backup/restauração.
- Atualize e revise os textos legais e informe os dados reais de contato do responsável.

Este repositório não é evidência de que o deploy está ativo. O lançamento só é confirmado depois do build, deploy e smoke test em `*.pages.dev`.

## Correções comerciais e operação

Consulte [correcoes-auditoria.md](docs/correcoes-auditoria.md) e [primeiro-acesso.md](docs/primeiro-acesso.md). Capacidade do piloto: 1.000 registros e 500 KB de JSON compacto por conta. As gravações excedentes são recusadas sem apagar dados. Termos finais e identificação comercial permanecem pendentes.
