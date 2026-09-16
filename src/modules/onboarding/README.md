# onboarding

Cadastro self-service de um novo tenant (issue #60, epic #58).

## Fluxo

1. `POST /api/signup` — dono cria a loja (`storeName`, `slug`, `ownerName`,
   `ownerEmail`, `password`).
   - `store` nasce com `status = 'pending'` (valor já suportado pelo CHECK
     de `stores.status` desde a migration 0002).
   - `user` nasce com `email_verified_at = NULL`.
   - Store, user, vínculo `OWNER` e seed mínimo (1 categoria + 1 mesa)
     nascem na mesma transação — nunca existe tenant "fantasma" sem owner.
   - Um token de verificação é gerado; **apenas o hash (sha256) é
     persistido** em `signup_verifications`.
2. `POST /api/signup/verify` — confirma o token, marca o e-mail como
   verificado e ativa a store (`pending` → `active`) se ainda pendente.
3. `POST /api/signup/resend` — reemite o token (invalidando o anterior).
   Responde de forma genérica mesmo quando o e-mail não existe, para não
   permitir enumeração de contas.

## Decisão pendente: envio de e-mail

Ainda não há provider de e-mail transacional integrado na plataforma. Por
ora, o envio é registrado via `audit` e logado; em ambiente que não seja
`production`, o token volta na resposta HTTP (`verification.devToken`) para
permitir testar o fluxo local/E2E sem inbox real.

**TODO:** plugar um provider real (Resend, SES, Postmark...) — ver anotação
`TODO(#59-infra)` em `signup-routes.js`. Quando isso existir, remover o
retorno de `devToken` também fora de produção, se desejado.

## Segurança

- Slugs reservados (`www`, `api`, `admin`, ...) ficam em `reserved_slugs` e
  bloqueiam o cadastro antes de tocar em `stores`.
- Token de verificação: 32 bytes aleatórios, TTL configurável via
  `SIGNUP_VERIFICATION_TTL_HOURS` (default 24h), single-use.
- Resposta de `/api/signup/resend` não revela se o e-mail existe.
