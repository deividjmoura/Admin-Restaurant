-- 0022_cash_sessions.sql
-- Sessão de caixa (abertura/fechamento/reconciliação) + ledger de movimentações.
-- Issues #107 (sessão), #108 (movimentações), #109 (pagamento combinado/estorno),
-- #110 (relatório e fechamento).
--
-- Princípios (GOLDEN_RULES):
--   * store_id obrigatório em tudo + índice por loja;
--   * dinheiro em NUMERIC, nunca float;
--   * ledger APPEND-ONLY: correção entra como novo movimento (ADJUSTMENT),
--     nunca UPDATE — espelho do que 0018 fez com audit_logs;
--   * idempotência por (store_id, idempotency_key) e por (payment_id, type):
--     o mesmo pagamento não pode gerar duas entradas de caixa;
--   * uma única sessão ABERTA por operador/loja (parcial unique index), do mesmo
--     jeito que 0021 garantiu uma sessão aberta por mesa.

-- ---------------------------------------------------------------------------
-- 1) Sessão de caixa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  operator_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'closed')),
  -- Fundo de troco informado na abertura (conta como entrada).
  opening_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  -- Preenchidos no fechamento: esperado (calculado), contado (operador) e a
  -- diferença (contado - esperado) que alimenta a reconciliação.
  -- `expected` pode ficar negativo se houver mais sangria do que dinheiro
  -- entrou: é anomalia e precisa aparecer no fechamento, não ser escondida.
  expected_amount   NUMERIC(12,2),
  counted_amount    NUMERIC(12,2) CHECK (counted_amount IS NULL OR counted_amount >= 0),
  difference_amount NUMERIC(12,2),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ,
  notes             TEXT,
  idempotency_key   TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_cash_sessions_closed_at CHECK (
    (status = 'open'   AND closed_at IS NULL) OR
    (status = 'closed' AND closed_at IS NOT NULL)
  ),
  CONSTRAINT ck_cash_sessions_close_amounts CHECK (
    status = 'open' OR expected_amount IS NOT NULL
  )
);

-- Uma sessão ABERTA por operador/loja (corrida de duplo clique → 23505 → 409).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_sessions_open_per_operator
  ON cash_sessions (store_id, operator_id)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_sessions_store_idempotency
  ON cash_sessions (store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_sessions_store_status
  ON cash_sessions (store_id, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_store_opened
  ON cash_sessions (store_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_operator
  ON cash_sessions (operator_id, status);

COMMENT ON TABLE cash_sessions IS
  'Sessão de caixa por operador/loja; fechamento reconcilia esperado x contado.';
COMMENT ON COLUMN cash_sessions.expected_amount IS
  'Calculado no fechamento: abertura + entradas - saídas do ledger.';
COMMENT ON COLUMN cash_sessions.difference_amount IS
  'contado - esperado. Negativo = falta; positivo = sobra.';

-- ---------------------------------------------------------------------------
-- 2) Ledger de movimentações (imutável)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cash_session_id  UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  -- OPENING  fundo de troco            (IN)
  -- SALE     venda recebida em dinheiro (IN)
  -- SUPPLY   suprimento/reforço de caixa(IN)
  -- WITHDRAWAL sangria/retirada         (OUT)
  -- REFUND   estorno devolvido ao cliente(OUT)
  -- ADJUSTMENT ajuste justificado       (IN ou OUT)
  type             TEXT NOT NULL
                     CHECK (type IN (
                       'OPENING', 'SALE', 'SUPPLY', 'WITHDRAWAL', 'REFUND', 'ADJUSTMENT'
                     )),
  direction        TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason           TEXT,
  payment_id       UUID REFERENCES payments(id) ON DELETE SET NULL,
  order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
  table_session_id UUID REFERENCES table_sessions(id) ON DELETE SET NULL,
  idempotency_key  TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Direção é consequência do tipo (só ADJUSTMENT escolhe).
  CONSTRAINT ck_cash_movements_direction CHECK (
    (type IN ('OPENING', 'SALE', 'SUPPLY')   AND direction = 'IN') OR
    (type IN ('WITHDRAWAL', 'REFUND')        AND direction = 'OUT') OR
    (type = 'ADJUSTMENT')
  ),
  -- Ajuste sem justificativa é porta para fraude.
  CONSTRAINT ck_cash_movements_reason CHECK (
    type <> 'ADJUSTMENT' OR (reason IS NOT NULL AND length(trim(reason)) >= 3)
  ),
  -- Sangria/suprimento também precisam de motivo curto (rastreio de auditoria).
  CONSTRAINT ck_cash_movements_reason_ops CHECK (
    type NOT IN ('WITHDRAWAL', 'SUPPLY') OR (reason IS NOT NULL AND length(trim(reason)) >= 3)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_store_idempotency
  ON cash_movements (store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Um pagamento só entra UMA vez no caixa (e só estorna uma vez).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_payment_type
  ON cash_movements (payment_id, type)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_movements_store_session
  ON cash_movements (store_id, cash_session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cash_movements_store_created
  ON cash_movements (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_movements_store_type
  ON cash_movements (store_id, type);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session_type
  ON cash_movements (cash_session_id, type);

COMMENT ON TABLE cash_movements IS
  'Ledger de caixa append-only: correção entra como ADJUSTMENT, nunca UPDATE.';
COMMENT ON COLUMN cash_movements.amount IS 'Sempre positivo; o sinal vem de direction.';

-- Append-only: o banco rejeita UPDATE (o aplicativo não tem esse caminho).
-- DELETE permanece permitido apenas para a cascata de remoção da loja
-- (isolamento/limpeza de tenant) — o aplicativo não tem rota de exclusão.
CREATE OR REPLACE FUNCTION prevent_cash_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements is append-only (use a new ADJUSTMENT movement)';
END;
$$;

DROP TRIGGER IF EXISTS cash_movements_immutable ON cash_movements;
CREATE TRIGGER cash_movements_immutable
  BEFORE UPDATE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION prevent_cash_movement_mutation();

COMMENT ON FUNCTION prevent_cash_movement_mutation() IS
  'Ledger de caixa não se edita: ajuste/estorno entram como novos movimentos.';

-- ---------------------------------------------------------------------------
-- 3) Pagamentos: vínculo com a sessão de caixa + pagamento combinado
-- ---------------------------------------------------------------------------
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS cash_session_id UUID REFERENCES cash_sessions(id) ON DELETE SET NULL;

-- Grupo de um pagamento parcial/combinado (vários métodos no mesmo alvo).
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS split_group UUID;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Dinheiro entregue e troco (só faz sentido em CASH; a gaveta recebe `amount`).
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tendered_amount NUMERIC(12,2) CHECK (tendered_amount IS NULL OR tendered_amount >= 0);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS change_amount NUMERIC(12,2) CHECK (change_amount IS NULL OR change_amount >= 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS ck_payments_change;
ALTER TABLE payments
  ADD CONSTRAINT ck_payments_change CHECK (
    change_amount IS NULL
    OR tendered_amount IS NULL
    OR change_amount = tendered_amount - amount
  );

CREATE INDEX IF NOT EXISTS idx_payments_store_cash_session
  ON payments (store_id, cash_session_id)
  WHERE cash_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_store_split_group
  ON payments (store_id, split_group)
  WHERE split_group IS NOT NULL;

COMMENT ON COLUMN payments.cash_session_id IS
  'Sessão de caixa em que o pagamento entrou (CASH obriga vínculo no fechamento).';
COMMENT ON COLUMN payments.split_group IS
  'Mesmo grupo = pagamento combinado (ex.: R$20 dinheiro + R$30 PIX).';
COMMENT ON COLUMN payments.change_amount IS 'Troco devolvido; gaveta recebe amount.';

-- DOWN (reversível):
--   DROP TRIGGER IF EXISTS cash_movements_immutable ON cash_movements;
--   DROP FUNCTION IF EXISTS prevent_cash_movement_mutation();
--   DROP TABLE IF EXISTS cash_movements;
--   DROP TABLE IF EXISTS cash_sessions;
--   ALTER TABLE payments DROP COLUMN IF EXISTS change_amount,
--     DROP COLUMN IF EXISTS tendered_amount, DROP COLUMN IF EXISTS confirmed_by,
--     DROP COLUMN IF EXISTS split_group, DROP COLUMN IF EXISTS cash_session_id;
