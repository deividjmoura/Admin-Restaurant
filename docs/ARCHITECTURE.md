# Arquitetura — Admin-Restaurant

## Princípio fundamental

A aplicação é **SaaS multi-tenant desde o primeiro momento**.

Não existe fase “single-tenant depois adaptamos”.

Toda entidade de negócio pertencente a uma loja carrega `store_id`.
Toda query, cache, evento, fila e assinatura realtime é scoped por tenant.

## Isolamento em camadas

1. **Banco** — `store_id` + foreign keys + índices compostos
2. **Backend** — middleware de resolução de tenant + autorização
3. **Cache** — chaves sempre `*:store:{id}:*`
4. **Realtime** — canais `store:{id}:...` com auth na assinatura
5. **Filas** — jobs carregam `store_id` e workers respeitam
6. **Frontend** — nunca é camada de segurança

## Resolução de tenant

```
loja1.seudominio.com  →  store = loja1
```

- Subdomínio é a fonte principal de verdade para o cliente final.
- Usuário autenticado (staff) tem `store_id` no contexto da sessão/JWT.
- `SUPER_ADMIN` pode operar cross-tenant apenas em rotas administrativas explícitas e auditáveis.

Nunca confiar em `store_id` enviado pelo cliente quando o domínio já define o tenant.

## Papéis

| Papel         | Escopo              |
|---------------|---------------------|
| SUPER_ADMIN   | Plataforma          |
| OWNER         | Loja (tudo)         |
| MANAGER       | Loja (quase tudo)   |
| KITCHEN       | Pedidos / status    |
| STAFF         | Operacional básico  |

## Checklist antes de qualquer feature (Regra de Ouro)

1. Qual é o tenant dessa operação?
2. Quem pode executar?
3. Quais dados podem ser acessados?
4. Existe possibilidade de concorrência?
5. A operação precisa ser idempotente?
6. Precisa de transação?
7. Precisa de evento?
8. Precisa de cache?
9. Pode ser assíncrona?
10. Como será monitorada?
11. Como será testada?
12. O que acontece se falhar?

## Prioridades

```
segurança > integridade dos dados > correção > manutenibilidade > performance > complexidade
```

## Referência de domínio

Comportamento de pedidos, mesas, cardápio e fluxos operacionais inspira-se no projeto [lanchonete-qr-semi-final](https://github.com/deividjmoura/lanchonete-qr-semi-final), reescrito sob esta arquitetura.

**Não portamos** features legadas não utilizadas (ex.: ponto da carne).
