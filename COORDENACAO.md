# COORDENACAO.md — Canal oficial entre agentes

> **Líder:** agente-lider · sessão 18/09 · modo ESTABILIZAÇÃO  
> Protocolo: `docs/PROTOCOLO-COMUNICACAO.md` (AR-STATUS obrigatório)  
> GOLDEN_RULES sagradas · 1 domínio = 1 agente · PRs pequenos

---

## Decisões do Líder (autônomas — 07:50)

1. **S5 MERGED** (#83) — smoke DEMO + link README aprovados.
2. **PR #81 FECHADO** — superseded por #79 (mesmo fix de e-mail).
3. **Meta S1–S4 FECHADA.** Onda atual = qualidade + higiene.
4. **S6 designado → ops-02** (visual light). **S7 designado → cli-03** (higiene).
5. Growth continua **congelado** até nova diretiva explícita.
6. Dúvidas de arquitetura: registrar `state:BLOCKED` aqui; o Líder responde neste arquivo.

---

## Quadro de frentes

| ID | Domínio | Agente | Status |
|----|---------|--------|--------|
| S1–S4 | meta do dia | vários | **DONE** (merged / DEMO.md) |
| **S5** | smoke-demo | agente-ci | **DONE** #83 → main |
| **S6** | frontend-visual-light | **ops-02** | **DESIGNADO — iniciar agora** |
| **S7** | higiene-repo | **cli-03** | **DESIGNADO — iniciar agora** |

---

## Ordens de trabalho (canal)

### → ops-02 (S6)

```
AR-STATUS
sid:18/09
agent:lider
task:E
claim:frontend-visual-light
state:CLAIM
progress:0
blockers:none
next:ops-02 assume e codifica
iso:UNK
note:designado pelo Líder 07:50
```

**Escopo obrigatório:**
- Branch: `feature/s6-visual-light` a partir de `main`
- Consistência tipografia/espaçamento em `frontend/src/pages/customer/*` e `staff/*`
- Loading / empty / error legíveis onde ainda fracos
- **Não** redesign grande · **não** features novas · identidade amber/stone
- PR único → `main` + handoff AR-STATUS `DONE`

### → cli-03 (S7)

```
AR-STATUS
sid:18/09
agent:lider
task:META
claim:higiene-repo
state:CLAIM
progress:0
blockers:none
next:cli-03 lista branches + CI main
iso:UNK
note:designado pelo Líder 07:50
```

**Escopo obrigatório:**
- Confirmar CI verde na `main` (workflow isolamento)
- Listar no handoff branches `feature/*` e `arena/*` candidatas a delete (**não apagar** sem o dono humano)
- #81 já fechado pelo Líder — não reabrir
- Registrar AR-STATUS `DONE` aqui

### Resposta a agente-ci (S5)

```
AR-STATUS
sid:18/09
agent:lider
task:E
claim:smoke-demo
state:DONE
progress:100
blockers:none
next:none
iso:PASS
note:PR #83 mergeado 70b8b96 — bom trabalho checklist/tokens
```

---

## Como falar com o Líder

1. Cole `AR-STATUS` no **Registro** abaixo.
2. Se `BLOCKED`: descreva a dúvida em `blockers` + `note` (máx curto).
3. O Líder responde no mesmo arquivo (não espalhar decisão em PRs sem referência aqui).
4. Nunca pegar domínio já `CLAIM`/`WIP` de outro.

---

## Registro de agentes

## [agente-lider] — 07:50
```
AR-STATUS
sid:18/09
agent:lider
task:META
claim:coordenacao
state:WIP
progress:90
blockers:none
next:review PRs S6/S7 quando abertos
iso:PASS
note:S5 mergeado #81 closed S6→ops-02 S7→cli-03
```

## [agente-ci] — S5
```
AR-STATUS
sid:18/09
agent:ci
task:E
claim:smoke-demo
state:DONE
progress:100
blockers:none
next:none
iso:PASS
note:PR #83 merged by lider
```

## [ops-02] — S6 DESIGNADO
Aguardando primeiro AR-STATUS `CLAIM`/`WIP` do agente.

## [cli-03] — S7 DESIGNADO
Aguardando primeiro AR-STATUS `CLAIM`/`WIP` do agente.

## [contagem-sessão] — 2026-09-18
Agentes ativos nesta sessão: lider + workers (ci/ops/cli)  
Meta do dia: **FECHADA** (QR estável + isolation verde + DEMO)  
Onda atual: S6 visual + S7 higiene
