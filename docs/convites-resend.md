# Convites por e-mail — Resend

**Estado atual:** integração opcional, sem envio ativo. Como o operador não possui domínio próprio, o acesso inicial usa entrega assistida do convite conforme [primeiro-acesso.md](primeiro-acesso.md). Não é necessário contratar domínio ou configurar um serviço de e-mail para esse procedimento. Aceitação da API, recebimento e cadastro por e-mail ainda não foram testados com uma conta Resend configurada para este sistema.

O operador informa um e-mail no Convex e executa a ação interna `access:sendInvite`. O sistema cria o convite individual e envia a mensagem em português com código e link de cadastro. Não existe uma rota pública para enviar convites nem um cadastro aberto.

## Configuração no único backend do Social Media OS

1. No Resend, adicionar e verificar um domínio sobre o qual o operador tenha controle do DNS. Usar os registros fornecidos pelo próprio painel. Para destinatários reais, o domínio de testes do Resend não substitui um domínio verificado. O endereço do aplicativo pode continuar em `pages.dev`.
2. Criar uma API key de envio restrita ao domínio escolhido.
3. No Convex, selecionar o projeto `social-media-os`, produção `charming-leopard-770`, e abrir **Settings > Environment Variables**. Salvar apenas neste backend:
   - `RESEND_API_KEY`: a chave privada do Resend.
   - `RESEND_FROM_EMAIL`: somente o endereço remetente do domínio verificado, sem nome de exibição. O nome da mensagem será “Social Media OS”.
4. Não colocar a chave em `VITE_*`, no frontend, em commits, logs, prints ou mensagens de suporte. Não copiar configurações do Barber OS.

## Liberar um cliente

1. Em **Functions**, escolher a ação interna `access:sendInvite`.
2. Informar `{"email":"gestor@exemplo.com"}` e executar.
3. O retorno `status: "accepted"`, `emailId` e `expiresAt` indica que a API do Resend aceitou a mensagem. O código não aparece nesse retorno.
4. Confirmar o evento de entrega no painel do Resend. A aceitação da API não garante chegada à caixa de entrada; a validação inicial inclui receber a mensagem e cadastrar uma conta com o código recebido.

O destinatário abre `https://social-media-os-b0c.pages.dev/auth`, escolhe “Recebi um convite — criar conta”, usa o mesmo e-mail, copia o código, cria a própria senha e aceita os documentos. O novo convite tem 8 caracteres, vale 48 horas e só pode ser utilizado uma vez. O banco guarda apenas o digest do código. O link não inclui o código em sua URL.

As tentativas automáticas por falha de rede, HTTP 429 ou 5xx usam o mesmo corpo e chave de idempotência do Resend, no máximo três vezes. Uma falha permanente interrompe a operação e não é apresentada como envio aceito. Erros do provedor não são repassados com o conteúdo original.

Se a resposta de rede se perder, o envio pode ter sido aceito. Conferir os registros no Resend antes de emitir outro convite. Executar a ação novamente cria um novo código e invalida o anterior, assim como a emissão manual. A configuração ausente ou inválida é recusada antes de substituir convites existentes.

## Emissão manual e recuperação

`access:createInvite` continua disponível somente para o operador como alternativa de entrega privada. Não envia e-mail.

Login de contas existentes e recuperação por chave de emergência continuam funcionando. Esta integração envia convites; não adiciona reset automático de senha, campanhas ou notificações gerais.

## Validação da integração

- Os testes automatizados usam respostas simuladas da API. Validam conteúdo, destinatário, vínculo com o digest real, prazo, retorno sem código, proteção da configuração, falhas e idempotência.
- Verificação local em 02/11/2026: **105 testes aprovados**, incluindo 11 testes desta integração; build TypeScript/Vite aprovado e lint sem erros (9 avisos de Fast Refresh já existentes). A API de envio foi incluída no inventário que valida a visibilidade interna das funções.
- A configuração e a entrega real dependem da conta Resend, do domínio verificado e das variáveis privadas. Não declarar o envio funcionando antes do teste real de recebimento e cadastro.

Documentação oficial: [enviar e-mail](https://resend.com/docs/api-reference/emails/send-email), [domínios verificados](https://resend.com/docs/dashboard/domains/introduction) e [idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys).
