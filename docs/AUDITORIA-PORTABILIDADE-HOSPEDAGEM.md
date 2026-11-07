# Auditoria de portabilidade e hospedagem — Admin-Restaurant

- Base: `main` SHA `d79278a92d4007235f72877ed351a21e16f93a28`
- Data: 07/11/2026
- Decisão obrigatória: `docs/DECISAO-ARQUITETURA-PORTABILIDADE-HOSPEDAGEM.md`
- Resultado: portabilidade parcial; não comprovada por instalação limpa nem por deploy em dois provedores.

## 1. Vercel atual

Evidências:
- Existe `frontend/vercel.json`, com rewrite de todas as rotas para `/index.html`.
- Frontend tem Vite build (`frontend/package.json`) e SPA React.
- O status do commit auditado reportou contexto `Vercel: success`.

Interpretação:
- A configuração é compatível com hospedagem de frontend SPA estático.
- Não há evidência nesta consulta de que Fastify esteja hospedado no Vercel; o arquivo é do frontend e só contém rewrite.
- Não foi possível verificar o painel Vercel, domínio, root directory, env vars, build settings, deploy URL ou se o deploy atual está saudável ponta a ponta.
- Preservar o projeto/configuração Vercel. Não alterar o rewrite sem necessidade comprovada.

## 2. Backend e processos long-running

- Backend é Fastify 5 em `src/server.js`, iniciado com `node src/server.js`.
- O servidor inicia worker persistente via `startWorker()` e o encerra em shutdown.
- Há SSE/realtime em módulos dedicados.
- Esse perfil requer processo Node persistente, suporte a conexões HTTP long-lived e worker contínuo. Uma hospedagem puramente estática do frontend não substitui o backend.
- Arquitetura sugerida: frontend SPA no Vercel se conveniente; API Fastify + worker em runtime de aplicação compatível, com PostgreSQL e Redis/broker compartilhados quando necessário. Não é escolha de fornecedor; pode ser Railway, AWS, VPS ou outro.

## 3. Banco e migrations

- PostgreSQL via pacote `pg` e `DATABASE_URL`.
- `scripts/migrate.js`, `scripts/seed.js` e migrations SQL versionadas.
- Config fail-closed exige DATABASE_URL em produção.
- Não foi executado banco local nesta auditoria; backup/restore não foi validado operacionalmente.
- Necessário testar instalação limpa, migrations em banco vazio, seed de desenvolvimento, backup, restauração e upgrade de versão.

## 4. Cache e realtime

- `src/infrastructure/redis.js` tenta importar dinamicamente `redis`/ `ioredis`, mas ambos não aparecem nas dependências do `package.json` principal.
- Sem Redis/client, cache e pub/sub usam Map/handlers em memória.
- Isso funciona somente dentro do mesmo processo e não oferece consistência entre réplicas, nem durabilidade após restart.
- Para múltiplas instâncias, adicionar e configurar um cliente/broker compartilhado de modo explícito; manter fallback em memória somente para dev/teste unitário, com aviso claro e readiness que informe a limitação.
- SSE conectado a várias instâncias precisa de pub/sub comum para entregar eventos independentemente da instância que recebeu a mutação.

## 5. Configuração e domínio

- `src/config.js` valida NODE_ENV, JWT_SECRET, COOKIE_SECRET e exige CORS_ORIGIN/FRONTEND_ORIGIN + DATABASE_URL em produção.
- BASE_DOMAIN pode ser configurado e tenant resolver aceita subdomínio e custom domain.
- Hostnames de localhost são contemplados pelos testes de resolução.
- Não foi validado browser com `admin.localhost`, `loja1.localhost`, `loja2.localhost`; manter esse teste no plano local.
- OAuth callback, cookies, SameSite/Secure, proxy trust e CORS devem ser conferidos por ambiente real.

## 6. Classificação de dependências

| Componente | Estado | Classificação |
|---|---|---|
| Frontend React/Vite | build independente, rewrite SPA | Portável |
| Vercel | configuração atual de frontend | Adaptador/deploy opcional |
| Backend Fastify | processo Node | Portável, requer runtime persistente |
| PostgreSQL | `pg` + DATABASE_URL + migrations | Portável |
| Redis | cliente não declarado no manifest; fallback em memória | Dependência configurável com lacuna de instalação |
| Jobs worker | iniciado dentro do processo API | Acoplamento operacional; avaliar processo worker separado para escalar |
| SSE | realtime no backend + pub/sub opcional | Exige afinidade ou broker compartilhado em multi-instância |
| Uploads/arquivos | nenhuma camada de storage de objetos evidenciada na árvore principal | A confirmar; disco local não deve ser presumido persistente |
| Domínio/TLS | variável/base domain e configuração de proxy | Configuração de infraestrutura |
| Logs/metrics/health | módulos próprios | Portável; integrações externas a confirmar |

## 7. Plano de validação

1. Instalação limpa de root e frontend com versões Node compatíveis e lockfiles.
2. Subir PostgreSQL local, aplicar migrations e seed sem serviço de nuvem.
3. Iniciar API e frontend em processos separados.
4. Validar hostnames locais e duas lojas simultâneas.
5. Validar cookies, CORS, login, OAuth e headers de proxy.
6. Testar SSE e jobs com e sem Redis; comprovar que fallback é explicitamente single-process.
7. Testar upload/download e reinício de processo para identificar persistência de arquivos.
8. Validar build/deploy do frontend no Vercel sem mover o backend para funções serverless por acidente.
9. Implantar API/worker em segundo ambiente de teste sem mudar regras de negócio.
10. Executar backup/restore e smoke tests pós-restore.

## 8. Conclusão

A existência do Vercel não atrapalha a estratégia local-first nem obriga migração. O Vercel pode continuar hospedando a SPA. O backend Fastify, worker e realtime precisam de ambiente apropriado para processo persistente e coordenação compartilhada se houver múltiplas réplicas. O projeto não está comprovadamente independente de provedor até que instalação local, deploy em segundo ambiente e backup/restore sejam executados.
