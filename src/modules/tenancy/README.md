# Tenancy

`request.isMarketing`, `request.isPlatform`, `request.store` e `request.storeId`
são resolvidos no hook onRequest a partir de **headers.host**, nunca de
X-Forwarded-Host nem de store_id do body/query.

Com `BASE_DOMAIN=seudominio.com`:

- apex/www → marketing, sem tenant; app/platform → platform, sem tenant.
- `{slug}.seudominio.com` → findBySlug; outro host → custom_domain exato.
- Status diferente de active bloqueia a entrada store (403).
- Hosts reservados nunca aceitam header/query como fallback, nem em dev.
- Fallback de dev em host não reservado: X-Tenant-Slug. Em produção, somente com
  TENANT_FALLBACK_HOSTS + TENANT_FALLBACK_ORIGINS. Query exige adicionalmente
  `config.allowTenantQuery: true` (SSE).
- Host resolvido sempre vence header/query conflitantes.

Store staff: `requireTenant` + `requireStoreAccess` / `requirePermission`.
Sem tenant → 400; token de outro contexto/loja → 403; recurso de outra loja → 404.
Platform tem guard próprio, nunca bypass de acesso à loja.

```sh
# Mesmo em dev, testar primeiro pelo host:
curl -H 'Host: demo.localhost' http://127.0.0.1:3000/api/menu
# Alternativa de transporte em dev: 127.0.0.1 NÃO é o apex localhost:
curl -H 'X-Tenant-Slug: demo' http://127.0.0.1:3000/api/menu
```

[Arquitetura e operação](../../../docs/ENTRY-CONTEXTS.md).
