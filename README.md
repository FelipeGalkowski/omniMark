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

- Cadastro, login, logout, perfil e troca de senha.
- Sessões por cookie HttpOnly e senhas protegidas com Argon2.
- Empresas com acesso por vínculo e papel.
- OAuth do Mercado Livre com PKCE e tokens criptografados no servidor.
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

A auditoria de dependências ainda aponta avisos na cadeia Prisma/deepmerge-ts e nas ferramentas de testes. A atualização dessas cadeias e a validação correspondente permanecem pendentes antes da liberação de produção.

A importação de pedidos possui implementação inicial na API, com renovação de tokens durante a sincronização, mas ainda depende de integração com a interface e validação com dados reais. Notificações, recuperação de senha por e-mail e implantação em nuvem ainda não estão disponíveis.

A implantação pública exige HTTPS, segredos próprios, backups e revisão de segurança. Não reutilize as credenciais locais do banco em produção. Há pendências de atualização das ferramentas de desenvolvimento e revisão visual.
