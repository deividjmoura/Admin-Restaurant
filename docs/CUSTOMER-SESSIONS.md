# Autorização de mesa/QR — contrato customer

Implementado em 2026-09-21, após a separação de contextos. **Mudança incompatível**
para clientes que usavam IDs como credenciais. Migration: `0023_customer_access`.

## Entrada e identidade

1. Browser abre `https://burger.BASE_DOMAIN/m/:qrToken` (ou custom domain).
2. `GET /api/tables/by-token/:qrToken`, no mesmo host, valida loja ativa/mesa e
   resolve uma sessão aberta. Resposta existente ganha:

```json
{
  "customerSession": {
    "token": "JWT_ASSINADO",
    "expiresAt": "2026-09-21T18:00:00.000Z"
  },
  "session": { "id": "UUID_DA_SESSAO", "status": "open", "cartVersion": 0 }
}
```

3. Nas operações customer: `Authorization: Bearer JWT_ASSINADO`. Nunca enviar
   token por query ou substituir por `sessionId`. Body e path são apenas alvos,
   não provas de acesso. O backend resolve o storeId pelo host independentemente.

Claims: `type=customer`, `iss=restaurant:qr`, `aud=restaurant:table-customer`,
`storeId`, `tableId`, `sessionId`, `qrHash` (SHA-256 do QR atual), `iat`, `exp`.
Sem `sub` de usuário, sem role de staff. Assinatura HS256 com segredo da API;
verificação exige algoritmo/issuer/audience/tipo. Tokens de store/platform não
servem como customer, e customer não serve como cookie/login de staff.

Bearer e cookie staff válidos no mesmo request são recusados, evitando fallback
acidental de privilégio. O frontend customer usa `credentials: 'omit'` e não
busca `/api/me` ao entrar em `/m/*`.

## Superfície autorizada

| Endpoint | Customer | Staff (sem bearer) |
|---|---|---|
| `GET /api/sessions/:id/cart` | Somente sessão do token | `orders.read` |
| `POST/PATCH/DELETE /api/sessions/:id/cart/items[/:itemId]` | Somente sessão e item dela | `orders.create` |
| `POST /api/sessions/:id/cart/checkout` | Somente sessão do token | `orders.create` |
| `POST /api/orders` | TABLE; sessão omitida é derivada do token, diferente é 404 | `orders.create` |
| `GET /api/orders/:id` | Somente pedido TABLE da sessão | `orders.read` |
| `POST /api/orders/:id/cancel` | Próprio pedido, janela/status originais | `orders.status.write` |
| `POST /api/payments` | Somente pedido/sessão do token; ambos devem concordar | `payments.create` |
| `GET /api/payments/:id` | Todos os alvos do pagamento devem estar na sessão | `payments.read` |

Customer cria **PENDING**, nunca confirma ou estorna. Rotas staff de pagamento,
relatório, cozinha, permissões, admin e plataforma não aceitam customer. O shape
público de pagamento continua reduzido, sem metadata/provider/idempotency key.
Cardápio e configurações públicas mínimas continuam públicos no host da loja.

Nova permissão staff `orders.create`: semeada para OWNER, MANAGER e STAFF; KITCHEN
não a recebe. Mapeamentos atuais continuam sendo verificados no banco.

## Validade e revogação

- Credencial dura no máximo **1 hora**, limitada também ao prazo absoluto da
  sessão (`opened_at + TABLE_SESSION_TTL_HOURS`, padrão 6h).
- Em cada request, verificar sessão aberta/não expirada e mesa ativa, com QR igual
  ao da emissão. Alterar QR, desativar mesa, encerrar ou expirar sessão revoga o
  acesso de todos os browsers imediatamente para requisições posteriores.
- Sessão expirada com consumo continua aberta para o caixa, **não** para customer.
- Mesmo QR pode abrir uma nova sessão depois do fechamento (fluxo presencial
  existente), mas a credencial antiga nunca dá acesso à nova sessão/histórico.
- QR físico continua sendo uma credencial de entrada compartilhada. Quem possui
  uma cópia válida pode entrar na mesa; a aplicação não prova presença física.
  Não publicar QR em logs/analytics. Regenerá-lo revoga cópias anteriores.

### Erros

| Situação | Status |
|---|---|
| Sem autenticação, JWT inválido/expirado, QR revogado/mesa inativa | 401 |
| Sessão expirada por tempo/marcação | 401 `CUSTOMER_SESSION_EXPIRED` |
| Sessão encerrada | 409 `SESSION_CLOSED` |
| Token de outra loja no host, credenciais mistas, customer em rota staff | 403 |
| Pedido/pagamento/carrinho/item de outra mesa ou loja sob token local válido | 404 |
| Chave de idempotência de outro alvo/payload | 409 `IDEMPOTENCY_KEY_REUSED`, sem dados |
| Sem tenant no apex/platform em rota de loja | 400 |

## Atomicidade e replay

Mutações recebem o contexto customer verificado por opção interna, não pelo body.
Dentro da transação, antes de escrever ou devolver replay:

1. Verificar escopo de sessão e revalidar credencial/estado.
2. Bloquear a sessão (`FOR UPDATE`) e mesa (`FOR SHARE`), serializando com
   fechamento, desativação e troca de QR. Revalidar também expiração após esperar.
3. Verificar alvos e regras de negócio; gravar e fazer commit.
4. Só então auditar/publicar eventos e responder.

Pagamentos agora são criados transacionalmente, inclusive resolução de conflito
concorrente por `ON CONFLICT DO NOTHING`. Replay exige igualdade de `orderId`,
`sessionId`, método e centavos; nenhuma resposta de conflito contém pagamento
alheio. Pedido compara sessão inclusive `null`, bloqueando replay TABLE↔DELIVERY.
Autorização é anterior à idempotência: credencial revogada não recupera dados por
chave antiga. Staff/repositórios internos não se tornam customers implicitamente.

## Frontend e proteção de credenciais

`frontend/src/api/customer-session.js` centraliza troca, transporte e cache por
QR em `sessionStorage` (por aba/origem). Não há token global/localStorage. É bearer
acessível ao JS: prevenção de XSS continua necessária, como para outras aplicações
que guardam tokens em memória/storage. Nunca inserir HTML arbitrário.

Token expirado pode ser renovado para a mesma sessão. Se a troca resolve outra
sessão, nenhuma mutação pendente é enviada: o usuário precisa voltar à entrada da
mesa. Revogação limpa o cache e bloqueia renovação implícita. Não há retry
automático de POST; checkout preserva sua chave em falha de rede para retry
explícito. Respostas customer e QR são `Cache-Control: no-store`; meta/header
`Referrer-Policy: no-referrer`; logger redige URLs de troca QR. Configurar também
CDN/ingress/analytics para não registrar QR, Authorization ou respostas da troca.

## Fronteira delivery

Esta entrega protege **mesa/QR**, não cria uma identidade customer de delivery.
As rotas dedicadas `/api/delivery/orders` e tracking continuam um contrato
independente. Elas não retornam TABLE pelo ID nem pela chave de idempotência.
O JWT de mesa não permite acessar delivery através de `/api/orders/:id` ou
`/api/payments`. Consumidores delivery desses endpoints genéricos antes anônimos
precisam migrar para staff/backend autorizado; não enviar um token de mesa como
atalho. Evoluir autenticação de delivery exige credencial própria por pedido/
cliente e migração do tracking dedicado, separadamente.

## Deploy e rollback

1. Aplicar `npm run db:migrate` (inclui 0023) em ambiente de homologação primeiro.
2. Atualizar SPA e API juntas, retirando todas as instâncias antigas que aceitavam
   IDs anônimos. CORS adiciona `Authorization` aos headers permitidos, mantendo
   allowlists/contextos existentes; proxy deve preservar Authorization e Host.
3. Clients antigos precisam reentrar pelo QR; seus UUIDs em cache não dão acesso.
4. Validar múltiplas mesas e fechamento/rotação usando a suíte abaixo.
5. Rollback da 0023 é `migrations/rollback/0023_customer_access.sql` em transação,
   junto da versão de código correspondente. Retirar a proteção reabre o acesso
   por ID; não usar rollback de auth como mitigação de incidente.

```sh
export DATABASE_URL=postgres://... # banco descartável
npm run test:suite                # guarda mínima 204; zero falhas/ignorados
npm run test:unit                 # inclui transporte/cache/revogação frontend
npm run web:build
```

`test/isolation/customer-session.test.js`: matriz de leitura/mutação de mesas,
credenciais mistas, expiração, QR/mesa, RBAC, replay concorrente, fechamento e logs.
`test/isolation/customer-client.test.js`: isolamento por QR, omit/bearer, renovação,
revogação sem replay e preservação de credencial em falha de rede.
