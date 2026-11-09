# Primeiro acesso e suporte — Social Media OS

## Instalação

- Aplicação: https://social-media-os-b0c.pages.dev/auth
- Convex exclusivo: `david-william/social-media-os/charming-leopard-770`.
- Código e publicação: exclusivamente `main` de `1993dwsf-dev/social-media-os`.

## Convite individual

O procedimento atual é **assistido**, seguindo a solução sem domínio documentada no Barber OS: o operador entrega o código pelo contato privado combinado com o cliente. Não há disparo automático de e-mail. O Social Media OS usa exclusivamente seu próprio Convex e seus próprios convites; não utiliza credenciais, códigos ou dados do Barber OS.

1. No dashboard Convex do projeto correto, abra a função **interna** `access:createInvite`.
2. Confirme a identidade e o vínculo com o e-mail pelo contato combinado na contratação. Informe somente o e-mail do gestor contratado, em `{"email":"gestor@exemplo.com"}`.
3. Execute a função e entregue o código retornado, junto do endereço de cadastro, diretamente ao destinatário por esse canal privado. Não registre o código em issues, logs, prints, documentos públicos ou grupos. Não peça a senha do cliente.
4. O gestor escolhe “Recebi um convite — criar conta”, informa o mesmo e-mail, sua própria senha de 8 a 128 caracteres, convite e aceite dos documentos.
5. O novo convite tem 8 caracteres, vale 48 horas, é vinculado ao e-mail e é consumido na mesma transação da criação da conta. Um novo convite para o mesmo e-mail invalida o anterior.

O antigo `SOCIAL_MEDIA_OS_SIGNUP_CODE` compartilhado não libera novos cadastros. Contas existentes continuam usando suas senhas e conservam os mesmos IDs e registros. O convite individual não é uma verificação automática de propriedade do e-mail.

Não é necessário configurar domínio, Resend, Brevo ou SMTP para este procedimento. A integração opcional de e-mail permanece descrita em [convites-resend.md](convites-resend.md), sem envio ativo. Referência do procedimento assistido no Barber OS: [acesso-manual-primeiro-cliente.md](https://github.com/1993dwsf-dev/barber-os/blob/e8d7f46d7aacf4420af39d41067a79e7b26911f9/docs/acesso-manual-primeiro-cliente.md). Os códigos de autenticação do Barber OS e o convite de cadastro deste sistema têm finalidades distintas; não se deve transferir códigos entre produtos nem marcar verificação de e-mail manualmente.

## Onboarding do primeiro pagante

1. Concluir identificação do responsável, canal de suporte, contrato e documentos legais antes de cobrar. As páginas atuais continuam identificadas como minutas.
2. Criar o convite individual e acompanhar o primeiro login.
3. Em Configurações, salvar o perfil e gerar uma **chave de emergência**, confirmando a senha atual. O usuário deve guardar essa chave em local seguro, separado do dispositivo.
4. Cadastrar um cliente fictício, um conteúdo, uma tarefa e um lançamento. Reentrar e confirmar persistência.
5. Exportar JSON e CSV real em Configurações. A página “Planilha do gestor” continua sendo um modelo estático separado.
6. Se demonstrar a base fictícia, usar uma conta vazia: o backend recusa exemplos em espaços com registros e preserva o perfil existente.

A conta é individual. Clientes cadastrados são registros; não possuem login. Não há equipe com permissões compartilhadas, publicação automática em redes, métricas conectadas ou cobrança integrada.

## Recuperar senha sem serviço de e-mail

1. Na entrada, escolher “Esqueci minha senha — usar chave de emergência”.
2. Informar e-mail da conta, a chave previamente guardada e nova senha forte.
3. O sistema consome a chave, altera a senha da conta original e revoga sessões antigas. Os dados continuam com o mesmo proprietário.
4. Após recuperar, gerar uma nova chave em Configurações. A anterior não pode ser reutilizada.

A chave tem 256 bits aleatórios; só seu hash fica armazenado. Não é incluída nos backups operacionais. Confirmar a senha é necessário para emitir ou substituir a chave. O suporte nunca deve pedir a senha ou a chave do usuário por mensagem.

Sem chave, sessão ativa ou backup, é necessária análise técnica específica com comprovação de identidade; não apague nem recrie contas para tentar recuperar acesso. Não há reset ou verificação automática por e-mail. Se uma recuperação falhar após consumir a chave, procure suporte; não prometa reutilização dela.

## Backups, restauração e capacidade do piloto

- JSON usa uma única leitura consistente do backend, com todas as coleções e perfil. Não depende do carregamento parcial da interface.
- Capacidade suportada: **1.000 registros somados entre as sete coleções e 500.000 bytes (500 KB) de JSON compacto**, incluindo perfil e metadados. Novas gravações que excedam a capacidade são revertidas na própria transação. Dados antigos não são apagados.
- Se uma base legada já exceder a capacidade, não limpe nem exclua dados para contornar o bloqueio: procure o suporte para uma exportação administrativa e plano de migração. O limite do piloto não é uma estratégia para grandes carteiras.
- Restauração valida formato e relações, cria IDs novos e associa os registros à conta atual. Primeiro teste em uma conta vazia.
- Importação acrescenta dados. A interface mostra o arquivo e exige confirmação; o backend exige `allowMerge: true` quando a conta já tem registros. Não há deduplicação automática ao confirmar uma importação adicional.
- Guarde o JSON fora do aplicativo. Ele contém dados pessoais e financeiros em texto legível.
- CSV real: escolher coleção e cliente em Configurações. Arquivo UTF-8 com BOM, separador `;`, valores decimais com vírgula e proteção de textos contra fórmulas de planilhas. CSV é relatório; JSON é o formato de restauração.

## Suporte e operação

Limpar o cache pode encerrar o login, mas não apaga o Convex. “Limpar espaço” apaga registros operacionais e exige confirmação. Conta, sessões e chave de recuperação são separadas dos registros do workspace.

Cobrança e cancelamento permanecem manuais e externos. O piloto não oferece bloqueio automático por inadimplência. Mantenha registro dos contratos e não compartilhe credenciais entre pessoas.
