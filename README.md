# OmniMark

Aplicação para centralizar contas e vendas de marketplaces por empresa, com controle de acesso por usuário.

## Estrutura

- `apps/web`: interface React e TypeScript.
- `apps/api`: API Fastify, Prisma e PostgreSQL.
- `scripts`: execução local e verificações de integração.

## Instalação

Requisitos: Node.js 22+, npm e Docker Compose. Portas locais: 5173 (painel), 3001 (API) e 5432 (banco).

Execute `npm install` na raiz. Crie `apps/api/.env` a partir de `.env.example`, sem sobrescrever configurações existentes, e configure as variáveis do ambiente.

```sh
docker compose up -d
npm run db:generate
npm exec -w @omnimark/api -- prisma migrate deploy
```

## Execução local

No Windows, com o Docker Desktop ativo, execute `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1`. O inicializador verifica o painel e a API. Logs e identificadores dos processos ficam em `.runtime/`.

Alternativamente, execute `npm run dev` e `npm run dev:web` em terminais separados. Painel: http://localhost:5173.

Os serviços precisam ser iniciados novamente após o encerramento dos processos ou a reinicialização do computador. O Docker Compose atual executa somente o banco.

`scripts/setup-node.ps1` instala Node.js em `.tools/`, com verificação de checksum. `scripts/start-local.ps1` utiliza essa cópia quando disponível.

## Verificação

```sh
npm test
npm run build
node scripts/check-local.mjs
```

A suíte cobre componentes e OAuth. `check-local.mjs` exige os serviços ativos, cria registros temporários e os remove ao terminar. Aguarde pelo menos um minuto entre execuções para respeitar o limite das rotas de autenticação.

## Funcionalidades

A lixeira em Contas permite que proprietários e administradores desconectem uma conta após confirmação. A operação remove do OmniMark a conexão, as credenciais e os pedidos importados (incluindo seus itens), sem alterar a conta ou os pedidos no marketplace. Durante uma sincronização em andamento, a remoção é bloqueada. Para importar novamente, é necessário reconectar a conta. A autorização no painel do marketplace não é revogada por essa remoção local.

- Cadastro, login, logout, perfil e troca de senha.
- Sessões por cookie HttpOnly e senhas protegidas com Argon2.
- Empresas com acesso por vínculo e papel.
- OAuth do Mercado Livre com PKCE e tokens criptografados no servidor.
- Importação manual de pedidos do Mercado Livre em Contas → Atualizar dados, com renovação de tokens, paginação, envios, reembolsos e consulta de devoluções.
- Pedidos e indicadores alimentados pelos registros importados, com identificação de dados indisponíveis e cobertura do período.
- Demonstração isolada com dados fictícios.

## Hospedagem

A imagem definida no `Dockerfile` serve o painel e a API na porta 3000. O build não recebe credenciais. Na inicialização, `prisma migrate deploy` aplica as migrações pendentes; uma falha impede a inicialização da aplicação. Faça backup antes de promover alterações de banco.

No Coolify, use Dockerfile, diretório base `/`, arquivo `/Dockerfile`, porta 3000 e healthcheck HTTP em `/health`. Mantenha os comandos de instalação, build e inicialização personalizados vazios.

Configure as variáveis somente em runtime:

- `DATABASE_URL`: conexão interna com o banco exclusivo do ambiente.
- `WEB_ORIGIN`: `https://teste.omnimark.tech` em homologação; `https://app.omnimark.tech` em produção.
- `ML_REDIRECT_URI`: a origem do ambiente seguida de `/integrations/mercadolivre/callback`, cadastrada também no Mercado Livre.
- `ML_CLIENT_ID`, `SECRET_KEY_ML` e `TOKEN_ENCRYPTION_KEY`: credenciais do ambiente. A chave de criptografia contém 64 caracteres hexadecimais.
- `TRUST_PROXY=true`: somente atrás do proxy do Coolify, sem publicar a porta do contêiner diretamente na internet.

`NODE_ENV=production`, `SERVE_WEB=true` e `PORT=3000` são definidos pela imagem, inclusive na homologação. Não configure volumes sobre `/app`. O PostgreSQL deve ter armazenamento persistente e acesso restrito à rede interna.

Use `develop` na homologação e `main` em produção. O workflow `Checks` valida testes, compilação e build Docker. Para impedir publicação antes da validação, o pipeline de publicação deve aguardar esses checks; Auto Deploy por push, isoladamente, não garante essa ordem. A proteção da `main` e a integração desse bloqueio com a publicação ainda precisam ser configuradas.

## Pendências

### Preparação da conexão Magalu

As rotas públicas `/termos` e `/privacidade` funcionam sem login, inclusive por acesso direto na imagem de produção. Os textos estão identificados como provisórios para revisão de Felipe Galkowski e descrevem o ambiente de homologação. O contato público informado pelo responsável é `felipegalk@outlook.com`; `LEGAL_CONTACT_EMAIL` permite substituí-lo em runtime. Antes de aceitar lojas de terceiros em produção, revise o conteúdo e a retenção real de logs/backups. Estas páginas não afirmam que o serviço já passou por revisão jurídica.

A conexão OAuth do Magalu está disponível em Contas → Conectar conta → Magalu. Esta etapa armazena a autorização; a importação de pedidos Magalu e sua renovação de tokens durante a importação serão implementadas separadamente. O botão de atualização continua desabilitado para esse canal e nenhum pedido fictício é exibido para uma conta real.

Após publicar e revisar as páginas, crie o cliente pelo IDM (PowerShell, em uma linha):

```powershell
.\idm client create --name "OmniMark" --description "Dashboard de vendas e indicadores de marketplaces" --privacy-term "https://teste.omnimark.tech/privacidade" --terms-of-use "https://teste.omnimark.tech/termos" --redirect-uris "https://teste.omnimark.tech/integrations/magalu/callback" --audience "https://api.magalu.com" --scopes "open:order-order-seller:read open:order-delivery-seller:read" --access-token-exp 7200
```

Guarde o Client Secret imediatamente: ele não é recuperável posteriormente. Configure somente nas variáveis de runtime do aplicativo de stage no Coolify:

- `MAGALU_CLIENT_ID`: Client ID gerado pelo IDM.
- `MAGALU_CLIENT_SECRET`: Client Secret gerado pelo IDM; nunca incluir em Git, screenshots ou logs.
- `MAGALU_REDIRECT_URI`: `https://teste.omnimark.tech/integrations/magalu/callback` (igual ao cadastro do cliente).
- `TOKEN_ENCRYPTION_KEY`: mantenha a chave existente do ambiente; trocar essa chave impede a leitura das credenciais já armazenadas, inclusive do Mercado Livre.

O callback exige um estado válido, vinculado à sessão e empresa originais, com expiração de dez minutos e consumo único. Uma visita direta sem parâmetros retorna HTTP 400, como esperado. Tentativas Magalu ficam em tabela própria; a migração é aditiva e não altera credenciais ou tentativas do Mercado Livre. O código é criptografado antes de ser armazenado e trocado por tokens somente após a volta ao painel com a sessão original.

O consentimento solicita apenas leitura de pedidos/entregas e `choose_tenants=true`, para selecionar a organização da loja. O identificador canônico da conta é extraído do `sub` do JWT recebido **diretamente** do endpoint fixo de tokens do ID Magalu; JWTs enviados pelo navegador não são aceitos. A mesma loja não pode ser vinculada a outra empresa. A identificação por tenant e os escopos ainda precisam de validação ponta a ponta com uma loja Magalu autorizada após a criação do cliente.

Documentação usada: [criação do cliente](https://developers.magalu.com/docs/first-steps/create-an-application/create-application/index.html), [consentimento e tokens](https://developers.magalu.com/docs/first-steps/create-an-application/authentication-authorization/index.html), [identificação de tenants no ID Magalu](https://developers.magalu.com/docs/apis_logistic/carrier/first-steps/become_carrier_integrator/index.html).

### Demais pendências

A auditoria de dependências ainda aponta avisos na cadeia Prisma/deepmerge-ts e nas ferramentas de testes. A atualização dessas cadeias e a validação correspondente permanecem pendentes antes da liberação de produção.

A importação consulta até 12 meses e 10 mil pedidos por conta, sem publicar uma lista parcial caso a paginação falhe. Os pedidos são atualizados por conta e identificador externo; uma falha de consulta preserva a sincronização anterior. Frete compartilhado sem conciliação, reembolsos ausentes e devoluções com estado não reconhecido aparecem como indisponíveis. O faturamento inclui o frete cobrado do comprador e não representa lucro ou saldo a receber.

A sincronização ainda é manual e mantém a requisição aberta durante o processamento (até dez minutos), portanto grandes históricos podem ultrapassar o timeout do proxy. Processamento em fila, notificações automáticas e recuperação de senha por e-mail permanecem pendentes. A validação ponta a ponta com pedidos da conta conectada também está pendente.

Para validar em homologação, conecte um vendedor de teste do Mercado Livre e realize compras com outro usuário de teste. Confira os IDs, totais, cancelamentos e reembolsos entre o Mercado Livre e o painel; repita a atualização para verificar que não há duplicação. Uma conta sem pedidos deve produzir uma lista vazia, sem carregar os dados fictícios da demonstração. Consulte a [documentação de testes do Mercado Livre](https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/realizacao-de-testes).

A implantação pública exige HTTPS, segredos próprios, backups e revisão de segurança. Não reutilize as credenciais locais do banco em produção. Há pendências de atualização das ferramentas de desenvolvimento e revisão visual.
