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

## Limitações

A importação de pedidos possui implementação inicial na API, com renovação de tokens durante a sincronização, mas ainda depende de integração com a interface e validação com dados reais. Notificações, recuperação de senha por e-mail e implantação em nuvem ainda não estão disponíveis.

A implantação pública exige HTTPS, segredos próprios, backups e revisão de segurança. Não reutilize as credenciais locais do banco em produção. Há pendências de atualização das ferramentas de desenvolvimento e revisão visual.
