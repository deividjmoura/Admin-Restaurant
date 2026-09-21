# Entradas, contratos e implantação

Implementação: 2026-09-21. Migration: `0022_entry_contexts.sql` + `0023_customer_access.sql`.

## Contratos HTTP

Todos os erros seguem `{ error: { code, message } }`. Não há seleção de loja
por `store_id` enviado pelo cliente. O cookie `ar_session` é **host-only**, sem
`Domain`, `HttpOnly`, `SameSite=Lax` por padrão e `Secure` em produção.

| Método / endpoint | Host / credencial | Contrato |
|---|---|---|
| `POST /api/auth/platform/login` | apex/www/app/platform; sem tenant | `{email,password}` → `{user:{id,email,name,type:'platform',role:'PLATFORM_OWNER'},tenant:null}` + cookie |
| `POST /api/auth/store/login` | subdomínio/custom domain ativo | `{email,password}` → `{user:{id,email,name,type:'store',role},tenant:{id,slug,name}}` + cookie |
| `POST /api/auth/logout` | host da sessão | Revoga `jti` no banco e limpa cookie; `{ok:true}` |
| `GET /api/me` | loja + sessão store + membership ativa | Apenas identidade e tenant atuais; nunca lista as outras memberships |
| `GET /api/platform/me` | app/platform + sessão platform | Identidade da plataforma |
| `GET /api/auth/me` | compatibilidade contextual | Equivalente ao `me` do host, sem login genérico |
| `POST /api/leads` | apex/www, sem auth | `{name,email,businessName,message?}` → `201 {ok:true}` |
| `GET /api/public/health` | qualquer host, sem banco/tenant | `{status:'ok'}` |
| `GET /api/platform/stores` | app/platform + PLATFORM_OWNER | `{stores,limit,offset}`; `?limit=1..100&offset=0..1000000` |
| `POST /api/platform/stores` | idem | criação transacional descrita abaixo; `201 {store}` |
| `GET /api/platform/stores/:id` | idem | `{store}` ou 404 |
| `PATCH /api/platform/stores/:id` | idem | `{slug?,name?,customDomain?,status?}`; `{store}` |
| `DELETE /api/platform/stores/:id` | idem | Suspensão lógica, **não apaga** histórico; `{store}` |
| `GET /api/platform/metrics` | idem | `{metrics:{stores,active,pending,suspended,leads}}` |
| `GET /api/platform/leads` | idem | `{leads,limit,offset}`; mesma paginação de stores |

### Provisionamento de loja

```json
{
  "slug": "burger",
  "name": "Burger House",
  "status": "pending",
  "customDomain": null,
  "ownerEmail": "dono@example.com",
  "ownerName": "Responsável",
  "ownerPassword": "uma-senha-inicial-longa"
}
```

- Status padrão `pending`; `active` libera operação; `suspended` bloqueia loja,
  login, QR e carrinho. Plataforma continua vendo todos os status.
- Senha mínima 12 caracteres, obrigatória **somente para uma identidade nova**.
  Conta existente mantém senha, nome e privilégios globais; recebe apenas o
  vínculo OWNER desta loja. Conta inativa é recusada.
- Store, identidade nova, membership e RBAC são criados na **mesma transação**.
  Conflito de slug/domínio/e-mail → 409, sem OWNER órfão.
- Campos desconhecidos são rejeitados. Slugs `www`, `app`, `platform` reservados;
  domínio próprio não pode ser URL, conter porta/path ou pertencer a BASE_DOMAIN.
- Nesta entrega o provisionamento é por **criação de conta**, não convite por
  e-mail. Entrega da senha inicial é operacional, por canal seguro. Não existe
  integração SMTP nem promessa de envio automático.
- Domínio próprio precisa ser verificado pelo operador e ter DNS/TLS configurados
  antes da ativação. Cadastro no banco não provisiona infraestrutura.
- Sem exclusão física de tenants pela API, deliberadamente: pedidos, pagamentos e
  auditoria precisam permanecer íntegros.

### Marketing

Leads são texto simples, com trim e e-mail normalizado; HTML/controle e campos
extras (inclusive `store_id`) são rejeitados. Body máximo 8 KiB. Não são customers
de loja e não entram no CRM do tenant. O formulário não envia e-mail: os contatos
ficam disponíveis em **Contatos comerciais** no painel platform.

### Sessões e autorização

```text
platform: sub + jti + type=platform + role=PLATFORM_OWNER + exp
store:    sub + jti + type=store + storeId + role + exp
```

`auth_sessions` guarda somente identificador, usuário, validade e revogação,
nunca o JWT bruto. Login antigo `/api/auth/login` foi removido (404), assim como
aceitação de JWT antigo sem `type`. Todas as sessões antigas precisam relogar.

`is_super_admin` é legado: migration copia os administradores existentes para
`is_platform_owner`, mas o código de autorização **não usa mais o bypass**.
Membership e role são conferidas novamente no banco em cada acesso staff. Um
usuário membro de A e B precisa fazer login em cada host; JWT de A em B → 403.
Platform owner também pode ter membership explícita, mas precisa de token store
emitido no host da loja para operar nela.

Os papéis operacionais existentes são preservados: OWNER, MANAGER, KITCHEN e
STAFF (garçom/caixa pelo RBAC atual). Não foram inventados papéis novos sem matriz
de permissões/migration correspondente.

### Customer / QR (atualizado — migration 0023)

O token aleatório do QR permite trocar a entrada da mesa por uma credencial JWT
`type=customer`, audience própria, `storeId`, `tableId`, `sessionId`, hash do QR e
validade de até 1h (nunca além da validade da sessão). O UUID da sessão/pedido/
pagamento **não é mais credencial**. Leia o contrato completo em
[CUSTOMER-SESSIONS.md](./CUSTOMER-SESSIONS.md).

Carrinho, criação/leitura/cancelamento de pedidos e criação/leitura de pagamentos
exigem `Authorization: Bearer <customerToken>` ou cookie staff + permissão.
Escopo de outra mesa/loja → 404; token de outra loja no host → 403.
Sessão fechada, expirada, QR regenerado ou mesa desativada invalidam o acesso.
Escritas revalidam a credencial sob lock da sessão na mesma transação, antes de
qualquer replay. Pagamentos vinculam replay também aos alvos, método e valor.

O frontend envia `credentials: omit`, guarda tokens por QR em sessionStorage e
não repete mutações automaticamente após revogação. Esta proteção cobre **mesa/QR**;
o contrato específico de delivery é independente (ver limites no documento).

## Deploy seguro (ordem)

1. Backup e verificação de colisões: `SELECT id,slug FROM stores WHERE lower(slug)
   IN ('www','app','platform');`. Renomear essas lojas de maneira planejada antes
   de ativar o novo roteamento. A constraint nova protege novas gravações, mas é
   `NOT VALID` para não destruir dados legados. Depois: `ALTER TABLE stores
   VALIDATE CONSTRAINT stores_reserved_slug;`.
2. Configurar `BASE_DOMAIN` e `VITE_BASE_DOMAIN` com o mesmo domínio (sem esquema,
   porta ou barra). Remover `VITE_TENANT_SLUG`, query/localStorage de seleção e
   `VITE_API_URL` de deploy antigo; usar URLs relativas `/api`.
3. Aplicar `npm run db:migrate` **antes** da nova API. Não faça rollout misturando
   instâncias antigas com bypass e novas instâncias; invalide sessões/reinicie
   todas. Backfill de flag global é automático.
4. Provisionar PLATFORM_OWNER: definir `PLATFORM_OWNER_EMAIL`,
   `PLATFORM_OWNER_NAME`, `PLATFORM_OWNER_PASSWORD` no ambiente seguro e executar
   `npm run platform:bootstrap`. Conta existente mantém a senha; esse comando
   concede a flag, não cria membership nem lojas demo. Remover senha de bootstrap
   do ambiente após uso. `db:seed` continua sendo opção para ambiente demonstrativo.
5. Build SPA: `npm ci --prefix frontend && npm run web:build`. Servir o build para
   apex, app, wildcard e domínios próprios; fallback SPA para rotas não `/api`.
6. Proxy `/api/*` para API **preservando Host original** (`proxy_set_header Host
   $http_host` no nginx). Não confiar em `X-Forwarded-Host` enviado pelo cliente.
   API usa `headers.host`; `TRUST_PROXY` controla apenas metadados do proxy
   confiável (especialmente IP/rate-limit), não permite trocar tenant.
7. DNS/TLS: apex e wildcard para ingress; app/platform e custom domains atendidos
   pelo mesmo ingress. Configure redirect **308** `www` → apex na borda. A SPA
   também faz redirect canônico como fallback. `/` da API é apenas metadado
   estático; a landing é servida pelo frontend, não pelo Fastify.
8. Configurar `JWT_SECRET` (>=32), `COOKIE_SECRET`, `CORS_ORIGIN` explícita, sem `*`.
   `CORS_MARKETING_ORIGINS`, `CORS_PLATFORM_ORIGINS`, `CORS_STORE_ORIGINS` podem
   acrescentar origens por contexto. Uma origem listada de outro contexto é
   rejeitada; loja A não é origem confiável na loja B. POST/PATCH/DELETE de
   origem não autorizada são bloqueados **antes** de efeitos (CORS não basta
   para prevenir CSRF). Cookies sem Domain compartilhado entre subdomínios.
9. Validar roteiro abaixo antes de liberar tráfego.

### Header / query de tenant

Ordem: host subdomínio → custom domain → header → query opt-in SSE. Apex/www/app/
platform retornam sem tenant **antes** dos fallbacks, inclusive em dev.

Produção: fallback desabilitado por padrão. Exceção de transporte controlado exige
`TENANT_FALLBACK_HOSTS` **e** `TENANT_FALLBACK_ORIGINS`, além de CORS. `?tenant=`
ainda exige `allowTenantQuery: true` na rota. O host resolvido sempre vence header
ou query conflitante. Não usar exceção como arquitetura principal.

Dev: `demo.localhost:5173` (loja), `app.localhost:5173` (platform),
`localhost:5173` (marketing). Vite preserva Host e usa proxy local. Em host de dev
alternativo pode-se configurar `VITE_DEV_TENANT_SLUG`; não funciona em build de
produção nem em host marketing/platform. `/dev` e launcher só existem no build DEV.

## Verificação

```sh
export DATABASE_URL=postgres://...   # banco descartável
npm run db:migrate
npm run test:suite                  # 204 testes, zero fail/skip
npm run test:unit
npm run web:build
```

- Marketing: `/` não mostra painéis; `/login` orienta loja vs plataforma; formulário
  gera lead. `/api/me` sem tenant → 400. Cabeçalho de tenant no apex não muda isso.
- Platform: login → lista/cria/edita/suspende loja, vê métricas e leads. Conta sem
  flag → 401. Mesmo token no host de loja → 403.
- Store: login exige membership; cookie de A no host B → 403 mesmo quando usuário
  tem membership em ambas. Mesmo cookie em `/api/platform/stores` → 403.
- QR: só funciona no host da loja da mesa; host B → 404, apex → 400. Suspensão
  bloqueia login e QR imediatamente.
- Logout: replay do cookie anterior em `/api/me` → 401.
- CORS: origem não listada/cross-context não recebe ACAO; mutações → 403.

CI executa os testes de host apex/platform/store, custom domain e capacidades QR
na suíte completa; guarda mínima elevada a **204**, sem aceitar skipped.

## Operação, limites e rollback

- Rate-limit e contador de identidade são **por processo**, como na base anterior.
  Para múltiplas réplicas, adicionar rate-limit distribuído no ingress/Redis.
- Agendar limpeza de sessões expiradas: `DELETE FROM auth_sessions WHERE
  expires_at < now();`. Definir retenção/consentimento para leads antes de produção.
- Ainda não há convite por e-mail, reset/troca obrigatória da senha inicial,
  provisionamento DNS/TLS automático ou MFA para platform owner.
- Customer QR foi endurecido conforme CUSTOMER-SESSIONS.md. O tracking específico
  de delivery continua um contrato separado; ele não acessa recursos de mesa.
- Rollback: exportar leads antes, parar API, executar manualmente
  `migrations/rollback/0023_customer_access.sql` e depois
  `migrations/rollback/0022_entry_contexts.sql` em transação e reverter código/build.
  A flag antiga foi preservada. Isso perde sessões e leads e **reintroduz** o
  modelo de autenticação antigo: não usar rollback parcial como mitigação de
  segurança. Migrations antigas não foram alteradas.
