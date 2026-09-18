# COORDENACAO.md — Fonte única de verdade

> **Modo: ESTABILIZAÇÃO** · Líder ativo · GOLDEN_RULES  
> Atualizado 2026-09-18 07:48

---

## ✅ Meta do dia — status

| Critério | Status |
|----------|--------|
| Isolation verde no CI | **DONE** — S1 #79 mergeado |
| QR → pedido → operação apresentável | **DONE** — S2 #80 + S3 #82 mergeados |
| Demo documentada | **DONE** — `docs/DEMO.md` |

**Meta do dia FECHADA.** Próxima onda = endurecer qualidade e demo real.

---

## 🎯 Nova onda — designação do Líder (07:48)

| Agente | ID | Frente | Domínio | Status |
|--------|-----|--------|---------|--------|
| livre | **S5** | Smoke E2E documentado + seed tokens no DEMO | `smoke-demo` | **LIVRE — pegue** |
| livre | **S6** | Polimento visual staff+cliente (issue #77 light) | `frontend-visual-light` | **LIVRE — pegue** |
| livre | **S7** | Fechar PR #81 + limpar branches mortas (só docs no COORD) | `higiene-repo` | **LIVRE — pegue** |

### S5 — Smoke demo
**Done means:**
1. Atualizar `docs/DEMO.md` com tokens de exemplo pós-seed (como ler o output)
2. Checklist manual executável em 5 min sem ambiguidade
3. Link para DEMO.md no README raiz (1 linha)

Branch: `feature/s5-smoke-demo` → PR main  
Não mudar comportamento de negócio.

### S6 — Visual light
**Done means:**
1. Consistência de tipografia/espaçamento nas telas já estáveis (customer + staff)
2. Estados loading/empty/error legíveis
3. Sem redesign grande; sem novas features

Branch: `feature/s6-visual-light` → PR main  
Respeitar identidade atual (amber/stone). Issue #77 = referência, não escopo completo.

### S7 — Higiene
**Done means:**
1. Comentário final + fechar #81 (superseded) se ainda aberto
2. Listar no handoff branches antigas `feature/*` / `arena/*` que podem ser apagadas (não apagar sem confirmação do dono)
3. Confirmar CI verde na `main` pós-merges

Branch opcional; pode ser só ações no GitHub + nota no COORDENACAO.

### Proibido
- Growth, billing, WhatsApp IA, cashback
- Quebrar isolation
- Dois agentes no mesmo domínio

---

## 👥 Registro

## [agente-lider] — 07:48
Mergeou #82 (S3). Meta do dia fechada. Abriu onda S5/S6/S7.

## Histórico do dia
- S1 #79 MERGED · S2 #80 MERGED · S3 #82 MERGED · S4 DEMO.md DONE
