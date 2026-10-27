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
- Importação automática de pedidos Mercado Livre, Magalu e Shopee, com renovação de tokens, paginação e tentativas após falhas. No Mercado Livre, consulta também envios, reembolsos e devoluções.
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

O servidor inicia a primeira importação após conectar ou reconectar uma loja. Depois de uma importação bem-sucedida, agenda a próxima para cinco minutos depois. Não é preciso manter o navegador aberto nem configurar cron no Coolify. A tela consulta o andamento a cada 15 segundos enquanto está visível e só relê os pedidos quando a última importação muda. O botão Renomear permite organizar as contas pelo nome, sem solicitar consultas ao marketplace.

O padrão já funciona sem novas variáveis. Para personalizar no Coolify, use somente runtime:

```text
ORDER_SYNC_ENABLED=true
ORDER_SYNC_INTERVAL_MINUTES=5
ORDER_SYNC_CONCURRENCY=2
```

O intervalo aceita de 2 a 60 minutos e a concorrência de 1 a 4 lojas por processo. `ORDER_SYNC_ENABLED=false` pausa novas execuções. O intervalo é contado após o término de cada importação; uma importação longa pode atrasar a próxima. Falhas aumentam a espera progressivamente até uma hora, respeitando um `Retry-After` maior do fornecedor. Autorizações revogadas ficam aguardando reconexão, sem tentativas infinitas.

Agendamentos e contadores de falhas ficam no PostgreSQL. Cada execução reserva atomicamente a loja por até 15 minutos, e a gravação confere o proprietário da reserva antes de publicar dados. Outra instância não importa a mesma loja simultaneamente. Após uma queda abrupta, o trabalho pendente volta a ser elegível quando a reserva expira. As importações têm limites de tempo e volume; falhas preservam a importação anterior.

Os conectores atuais importam inicialmente até 12 meses e depois consultam pedidos modificados com sobreposição de 15 minutos. Uma reconciliação completa diária também revisita mudanças de entrega/devolução que não atualizem o pedido. A normalização mantém a cobertura do histórico em importações incrementais.

Na Magalu, o histórico é dividido em intervalos de até 89 dias, respeitando o limite de 90 dias por consulta informado pela API. Cada intervalo começa sua própria paginação; pedidos repetidos nas fronteiras inclusivas são consolidados pelo código do pedido. O limite de 10 mil pedidos e o limite global de páginas continuam valendo para a importação completa. Só são gravados pedidos e cobertura depois de todos os intervalos terminarem com sucesso. O diagnóstico de um GET usa o primeiro desses intervalos.

### Diagnóstico Magalu no stage

As consultas de pedidos enviam `Authorization: Bearer ...` e `X-Tenant-Id: GENPUB.<uuid>`. Em produção, o UUID é o da organização autorizada. No sandbox, é o vendedor fictício retornado pelo onboarding; a identidade da autorização pessoal é armazenada e validada separadamente. Não há variável de ambiente adicional para esse cabeçalho.

Nos Runtime Logs do Coolify, procure `ORDER_SYNC_FAILED` com `marketplace: MAGALU`. O diagnóstico preserva o status HTTP do provedor, campos e códigos de erro reconhecidos nos formatos `detail` e `details`, além do `X-Request-ID` quando for um UUID válido. Mensagens livres, valores enviados e dados de compradores não são registrados.

Para reproduzir somente a primeira consulta da sincronização, execute no terminal do container do stage:

```sh
node /app/apps/api/dist/magalu-diagnose.js
```

O comando exige `WEB_ORIGIN=https://teste.omnimark.tech` e exatamente uma conta Magalu conectada no ambiente Magalu ativo. Faz no máximo um GET, descarta pedidos retornados e exibe somente o diagnóstico seguro. Em respostas de erro, inclui `providerMessage` com as mensagens de validação após remover credenciais conhecidas, tokens, links, e-mails e identificadores; campos `input` e objetos de compradores não são copiados. Essas mensagens livres não são adicionadas aos logs automáticos. Não importa pedidos, não altera registros ou agendamentos e não renova tokens. Se a autorização estiver vencida, aguarde a renovação pela rotina automática. Uma resposta 200 confirma apenas que a primeira consulta foi aceita, sem validar a importação completa.

`apps/api/src/sync-contract.ts` define o contrato dos conectores. Mercado Livre, Magalu e Shopee usam o mesmo agendador, reservas e tentativas. Para Amazon ou outro canal, implemente a leitura, normalização, renovação e persistência e registre o adaptador em `sync-adapters.ts`. Amazon continua sem conector real. Cada conector só publica os pedidos após concluir e validar toda a consulta.

### Conexão Shopee

Em Contas → Conectar conta → Shopee, autorize diretamente uma loja brasileira por vez. O retorno de uma conta principal com várias lojas ainda não é aceito. A conexão vincula o consentimento à sessão e à empresa, verifica a identidade da loja/aplicativo pela resposta de renovação e criptografa os tokens. Reconectar preserva o nome e o histórico. A integração começa pelo sandbox; a validação externa e os dados reais ainda precisam ser comprovados.

Configure no Coolify somente em runtime:

- `SHOPEE_PARTNER_ID` e `SHOPEE_PARTNER_KEY`: credenciais de teste do aplicativo, sem expor a chave no frontend, Git ou logs.
- `SHOPEE_ENVIRONMENT=sandbox` para loja de teste; `production` somente com credenciais e autorização reais.
- `SHOPEE_REDIRECT_URI=https://teste.omnimark.tech/integrations/shopee/callback`. O domínio de retorno de teste cadastrado na Shopee deve ser `https://teste.omnimark.tech`. Preserve a `TOKEN_ENCRYPTION_KEY` e a `WEB_ORIGIN` do stage.

A migração `20261026000100_shopee_oauth` cria as tentativas de autorização e permite valores monetários ausentes no banco, sem modificar valores existentes. A primeira importação e a reconciliação diária consultam doze meses em janelas de 14 dias (limite do fornecedor: 15). As incrementais usam `update_time` com sobreposição de 15 minutos. A listagem percorre cursores e os detalhes são buscados em lotes de até 50 pedidos. Há limite global de 10 mil pedidos e nenhuma publicação parcial. Tokens rotacionados são gravados imediatamente sob a reserva, mesmo se a importação de pedidos falhar depois.

O total Shopee exibido é `total_amount`, pago pelo comprador, já incluindo frete e promoções segundo a API. `actual_shipping_fee` é custo logístico e não é somado como frete do comprador. A divisão do frete, descontos de pedido, preços individuais de combos, reembolsos, devoluções, taxas e repasses ficam indisponíveis quando não comprovados pelos recursos consultados. Totais ausentes ficam nulos, inclusive em pedidos ainda não pagos; não são estimados a partir dos itens. Dados de compradores não são solicitados nos campos opcionais nem persistidos. Lojas de ambientes inativos são excluídas dos pedidos e indicadores.

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

Em produção, o consentimento solicita apenas leitura de pedidos/entregas e `choose_tenants=true`, para selecionar a organização da loja. O identificador canônico da autorização é extraído do `sub` do JWT recebido **diretamente** do endpoint fixo de tokens do ID Magalu; JWTs enviados pelo navegador não são aceitos. A mesma autorização no mesmo ambiente não pode ser vinculada a outra empresa. A identificação por tenant e os escopos ainda precisam de validação ponta a ponta com uma loja Magalu autorizada após a criação do cliente.

Documentação usada: [criação do cliente](https://developers.magalu.com/docs/first-steps/create-an-application/create-application/index.html), [consentimento e tokens](https://developers.magalu.com/docs/first-steps/create-an-application/authentication-authorization/index.html), [identificação de tenants no ID Magalu](https://developers.magalu.com/docs/apis_logistic/carrier/first-steps/become_carrier_integrator/index.html).

## Sandbox Magalu no stage

O sandbox usa as APIs oficiais de teste da Magalu. Configure `MAGALU_ENVIRONMENT=sandbox` somente em runtime no Coolify, mantendo as credenciais e a chave de criptografia existentes. O padrão `production` consulta lojas reais. A migração adiciona o ambiente às contas e tentativas OAuth; as contas existentes permanecem em produção. O agendador e as consultas de pedidos ignoram contas Magalu de outro ambiente, que continuam visíveis em Contas como “Outro ambiente”. Não é necessário apagar contas ou pedidos para alternar o ambiente.

Para um client já criado, atualize as audiences e acrescente as permissões de catálogo no PowerShell, substituindo o UUID:

```powershell
.\idm client update --uuid "UUID_DO_SEU_CLIENT" --audience "https://api.magalu.com https://api-sandbox.magalu.com https://services.magalu.com"
.\idm client add-scope --client-uuid "UUID_DO_SEU_CLIENT" --scopes "open:order-logistics-seller:read open:portfolio-skus-seller:read open:portfolio-skus-seller:write open:portfolio-prices-seller:read open:portfolio-prices-seller:write open:portfolio-stocks-seller:read open:portfolio-stocks-seller:write" --reason "Criar catalogo ficticio e testar importacao de pedidos no sandbox Magalu para o TCC OmniMark"
```

O comando `update` não aceita `--scopes`; as permissões adicionais são cadastradas com `add-scope`. Os dois escopos de leitura de pedidos/entregas do cadastro original também são necessários.

Adicionar escopos não adiciona a audiência de sandbox. Se ela estiver ausente no token, a API de pedidos pode responder 401 mesmo com onboarding aceito. O callback confere a audiência antes do onboarding e da gravação da conexão e exibe uma mensagem específica para atualizar o client. Tokens já emitidos precisam ser substituídos por uma nova autorização depois da alteração do client.

Depois do deploy, use Contas → Conectar conta → Magalu e autorize novamente, agora no sandbox. A conta pessoal do ID Magalu pode ser usada neste ambiente. O callback solicita as nove permissões de teste e prepara o vendedor fictício pelo endpoint fixo de onboarding. O identificador desse vendedor é salvo separadamente da identidade pessoal da autorização. O painel identifica a conta e os pedidos como fictícios e informa que eles podem compor os indicadores durante os testes.

Para criar o catálogo, execute no Terminal do aplicativo de stage no Coolify:

```sh
node /app/apps/api/dist/magalu-sandbox-seed.js --catalog
```

Se a resposta for `product_submitted`, aguarde o processamento da Magalu e repita `--catalog`. Quando retornar `catalog_submitted`, o preço de R$ 99,90 e o estoque de 100 unidades foram enviados. Aguarde o processamento antes de criar um pedido:

```sh
node /app/apps/api/dist/magalu-sandbox-seed.js --order
```

Cada execução de `--order` cria um novo pedido fictício. O comando solicita sua aprovação quando a resposta contém o código do pedido e os IDs das entregas e não repete automaticamente gravações. A rota de aprovação do sandbox resolve o campo `code` do pedido, embora a documentação chame o parâmetro da URL de `id`; usar o UUID retornado em `id` produz `ORDER_NOT_FOUND`. Se a aprovação ficar pendente, use o código e os IDs das entregas retornados para solicitar a aprovação do mesmo pedido:

```sh
node /app/apps/api/dist/magalu-sandbox-seed.js --approve CODIGO_DO_PEDIDO ID_DA_ENTREGA
```

Os comandos exigem o domínio de stage, modo sandbox e exatamente uma conta Magalu de sandbox conectada. Nunca gravam na API de produção. Usam o SKU estável `OMNIMARK-SANDBOX-001` e a imagem pública `/sandbox-product.jpg`; não importam pedidos diretamente no banco nem exibem dados de compradores ou credenciais. A importação usa a rotina automática existente. Os retornos de criação/aprovação indicam aceitação da operação, e a confirmação dos dados depende das consultas posteriores à Magalu.

Para usar uma loja real futuramente, configure `MAGALU_ENVIRONMENT=production` e conecte sua organização vendedora. As contas de sandbox ficam fora das consultas e dos indicadores. A validação ponta a ponta do onboarding, catálogo e pedido de sandbox depende da nova autorização no stage e permanece necessária após o deploy.

Fontes: [visão geral do sandbox](https://developers.magalu.com/docs/apis/sandbox/overview/index.html), [catálogo de teste](https://developers.magalu.com/docs/apis/sandbox/products/), [criação de pedidos fictícios](https://developers.magalu.com/docs/apis/sandbox/orders/createorder/index.html) e [aprovação de pedidos](https://developers.magalu.com/docs/apis/sandbox/orders/orderstatus/index.html).

## Pendências

A auditoria de dependências ainda aponta avisos na cadeia Prisma/deepmerge-ts e nas ferramentas de testes. A atualização dessas cadeias e a validação correspondente permanecem pendentes antes da liberação de produção.

A importação consulta até 12 meses e 10 mil pedidos por conta, sem publicar uma lista parcial caso a paginação falhe. Os pedidos são atualizados por conta e identificador externo; uma falha de consulta preserva a sincronização anterior. Frete compartilhado sem conciliação, reembolsos ausentes e devoluções com estado não reconhecido aparecem como indisponíveis. O faturamento inclui o frete cobrado do comprador e não representa lucro ou saldo a receber.

A sincronização periódica roda em segundo plano. Notificações automáticas por webhook de marketplace e importações de históricos acima de 10 mil pedidos por conta permanecem pendentes. A validação ponta a ponta com pedidos das contas conectadas também está pendente.

Para validar em homologação, conecte um vendedor de teste do Mercado Livre e realize compras com outro usuário de teste. Confira os IDs, totais, cancelamentos e reembolsos entre o Mercado Livre e o painel; repita a atualização para verificar que não há duplicação. Uma conta sem pedidos deve produzir uma lista vazia, sem carregar os dados fictícios da demonstração. Consulte a [documentação de testes do Mercado Livre](https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/realizacao-de-testes).

A implantação pública exige HTTPS, segredos próprios, backups e revisão de segurança. Não reutilize as credenciais locais do banco em produção. Há pendências de atualização das ferramentas de desenvolvimento e revisão visual.
