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

O smoke test exige banco em `localhost` ou `127.0.0.1` e recusa `NODE_ENV=production`. Ele provisiona usuários temporários já verificados diretamente no banco local e testa o login, sem enviar mensagens para endereços fictícios. Cadastro e confirmação são cobertos pelos testes automatizados de autenticação.

## Funcionalidades

A lixeira em Contas permite que proprietários e administradores desconectem uma conta após confirmação. A operação remove do OmniMark a conexão, as credenciais e os pedidos importados (incluindo seus itens), sem alterar a conta ou os pedidos no marketplace. Durante uma sincronização em andamento, a remoção é bloqueada. Para importar novamente, é necessário reconectar a conta. A autorização no painel do marketplace não é revogada por essa remoção local.

- Cadastro com confirmação de e-mail, login, logout, perfil, troca e recuperação de senha.
- Sessões por cookie HttpOnly e senhas protegidas com Argon2.
- Empresas com acesso por vínculo e papel.
- OAuth do Mercado Livre com PKCE e tokens criptografados no servidor.
- Importação automática de pedidos Mercado Livre e Magalu, com renovação de tokens, paginação e tentativas após falhas. No Mercado Livre, consulta também envios, reembolsos e devoluções.
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

## Confirmação de e-mail e recuperação de senha

No Resend, verifique o domínio e crie uma chave com permissão apenas de envio (`Sending access`), restrita ao domínio do projeto. Configure no aplicativo de stage do Coolify, somente em runtime:

```text
RESEND_API_KEY=<chave gerada no Resend>
RESEND_FROM=OmniMark <acesso@omnimark.tech>
```

Mantenha `WEB_ORIGIN=https://teste.omnimark.tech` e a `TOKEN_ENCRYPTION_KEY` existente. A chave de envio não deve ser colocada no frontend, em argumentos de build, no Git ou em logs. Depois de salvar, faça redeploy.

O cadastro cria uma conta pendente e enfileira um código de seis dígitos, válido por dez minutos e até cinco tentativas. Somente depois da confirmação e de um novo login é criada uma sessão. O botão de reenvio tem espera de 60 segundos; o servidor aplica esse limite por endereço, além dos limites por IP. Reenviar invalida o código anterior. Uma nova tentativa de cadastro com o mesmo e-mail pendente não altera a senha ou o nome existentes; se não souber a senha, use a recuperação.

Usuários existentes não são removidos nem marcados como verificados sem comprovação. Suas sessões abertas permanecem válidas até expirar ou sair, e o próximo login pede a confirmação do e-mail. Empresas, permissões, pedidos e credenciais de marketplace são preservados.

“Esqueci minha senha” responde da mesma forma para endereços existentes, desconhecidos ou em espera de reenvio. Para usuários cadastrados, enfileira um link de uso único por 30 minutos, com segredo de 256 bits no fragmento da URL. O painel remove o fragmento imediatamente e envia o segredo apenas por POST ao salvar a nova senha. A redefinição confirma o acesso à caixa de e-mail, encerra as sessões anteriores, invalida códigos/links pendentes e exige novo login. Uma versão de autenticação impede que um login concorrente com a senha antiga crie uma sessão utilizável após a redefinição.

Os códigos são armazenados como HMAC vinculado ao usuário e à tentativa, e os links como hash. Mensagens na fila ficam criptografadas até o envio ou descarte. Um worker consulta a fila a cada cinco segundos, reserva cada mensagem de forma atômica, tenta até três envios e usa uma chave de idempotência fixa no Resend. Falhas registram somente o status HTTP, sem destinatário, código, link ou resposta do provedor. Payloads são apagados após aceitação pelo provedor ou três falhas; os registros técnicos da fila são removidos após sete dias e desafios expirados são limpos periodicamente. “Enviado” significa aceito pelo Resend, não comprovação de entrega na caixa de entrada.

Validação em stage após configurar a chave: cadastre um e-mail de teste sob seu controle, confirme o código, entre, solicite recuperação, abra o link e defina outra senha. Confira que a sessão antiga foi encerrada, que a nova senha entra e que reutilizar o link falha. Não publique os códigos ou links. O envio real depende dessas variáveis e deve ser validado com a sua caixa de e-mail.

## Sincronização automática de pedidos

O servidor inicia a primeira importação após conectar ou reconectar uma loja. Depois de uma importação bem-sucedida, agenda a próxima para cinco minutos depois. Não é preciso manter o navegador aberto nem configurar cron no Coolify. O botão Atualizar dados solicita uma execução adicional e responde HTTP 202; a requisição não fica aberta durante a importação. A tela consulta o andamento a cada 15 segundos enquanto está visível e só relê os pedidos quando a última importação muda.

O padrão já funciona sem novas variáveis. Para personalizar no Coolify, use somente runtime:

```text
ORDER_SYNC_ENABLED=true
ORDER_SYNC_INTERVAL_MINUTES=5
ORDER_SYNC_CONCURRENCY=2
```

O intervalo aceita de 2 a 60 minutos e a concorrência de 1 a 4 lojas por processo. `ORDER_SYNC_ENABLED=false` pausa novas execuções. O intervalo é contado após o término de cada importação; uma importação longa pode atrasar a próxima. Falhas aumentam a espera progressivamente até uma hora, respeitando um `Retry-After` maior do fornecedor. Autorizações revogadas ficam aguardando reconexão, sem tentativas infinitas.

Agendamentos e contadores de falhas ficam no PostgreSQL. Cada execução reserva atomicamente a loja por até 15 minutos, e a gravação confere o proprietário da reserva antes de publicar dados. Outra instância não importa a mesma loja simultaneamente. Após uma queda abrupta, o trabalho pendente volta a ser elegível quando a reserva expira. As importações têm limites de tempo e volume; falhas preservam a importação anterior.

Os conectores atuais importam inicialmente até 12 meses e depois consultam pedidos modificados com sobreposição de 15 minutos. Uma reconciliação completa diária também revisita mudanças de entrega/devolução que não atualizem o pedido. A normalização mantém a cobertura do histórico em importações incrementais.

`apps/api/src/sync-contract.ts` define o contrato dos conectores. Para Shopee, Amazon ou outro canal, implemente a leitura, normalização, renovação e persistência e registre o adaptador em `sync-adapters.ts`. Ele passa a usar o mesmo agendador, reservas e tentativas automaticamente. Shopee e Amazon continuam sem conector real; não são anunciados como sincronizados nem consultados por um adaptador fictício. Cada conector deve salvar somente após ler todas as páginas e validar a identidade da loja.

As fontes usadas para os filtros e formatos estão na [busca de pedidos Mercado Livre](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas), [pedidos Magalu](https://developers.magalu.com/docs/apis/orders/ref/seller-v-1-get-order-list) e [renovação Magalu](https://developers.magalu.com/docs/first-steps/create-an-application/authentication-authorization/index.html).

## Conexão Magalu

As rotas públicas `/termos` e `/privacidade` funcionam sem login, inclusive por acesso direto na imagem de produção. Os textos estão identificados como provisórios para revisão de Felipe Galkowski e descrevem o ambiente de homologação. O contato público informado pelo responsável é `felipegalk@outlook.com`; `LEGAL_CONTACT_EMAIL` permite substituí-lo em runtime. Antes de aceitar lojas de terceiros em produção, revise o conteúdo e a retenção real de logs/backups. Estas páginas não afirmam que o serviço já passou por revisão jurídica.

A conexão OAuth do Magalu está disponível em Contas → Conectar conta → Magalu. Após autorizar a organização da loja, o servidor importa seus pedidos automaticamente, renova os tokens quando necessário e agenda as próximas consultas. O conector usa o total informado no pedido e seu normalizador monetário, evita somar o frete duas vezes e não armazena dados de compradores. Reembolsos e devoluções Magalu continuam identificados como indisponíveis até a conciliação específica desses recursos. A validação com pedidos reais da loja permanece necessária.

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

## Pendências

A auditoria de dependências ainda aponta avisos na cadeia Prisma/deepmerge-ts e nas ferramentas de testes. A atualização dessas cadeias e a validação correspondente permanecem pendentes antes da liberação de produção.

A importação consulta até 12 meses e 10 mil pedidos por conta, sem publicar uma lista parcial caso a paginação falhe. Os pedidos são atualizados por conta e identificador externo; uma falha de consulta preserva a sincronização anterior. Frete compartilhado sem conciliação, reembolsos ausentes e devoluções com estado não reconhecido aparecem como indisponíveis. O faturamento inclui o frete cobrado do comprador e não representa lucro ou saldo a receber.

A sincronização periódica roda em segundo plano. Notificações automáticas por webhook de marketplace e importações de históricos acima de 10 mil pedidos por conta permanecem pendentes. A validação ponta a ponta com pedidos das contas conectadas também está pendente.

Para validar em homologação, conecte um vendedor de teste do Mercado Livre e realize compras com outro usuário de teste. Confira os IDs, totais, cancelamentos e reembolsos entre o Mercado Livre e o painel; repita a atualização para verificar que não há duplicação. Uma conta sem pedidos deve produzir uma lista vazia, sem carregar os dados fictícios da demonstração. Consulte a [documentação de testes do Mercado Livre](https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/realizacao-de-testes).

A implantação pública exige HTTPS, segredos próprios, backups e revisão de segurança. Não reutilize as credenciais locais do banco em produção. Há pendências de atualização das ferramentas de desenvolvimento e revisão visual.
