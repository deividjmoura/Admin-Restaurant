/** Customer credentials are separate from staff cookies and keyed by QR per tab.
 * Dependency injection keeps storage, expiry and recovery testable without a DOM.
 */
export function createCustomerClient({ api, storage, now = () => Date.now() }) {
  const key = (qr) => `table:${qr}:access`;
  const reset = (qr) => {
    storage.setItem(key(qr), JSON.stringify({ blocked: true }));
    storage.removeItem(`table:${qr}:sessionId`);
    storage.removeItem(`table:${qr}:cartVersion`);
  };
  const fetchExchange = (qr) =>
    api(`/api/tables/by-token/${encodeURIComponent(qr)}`, {
      credentials: 'omit',
    });
  function persist(qr, data) {
    const access = {
      id: data.session.id,
      token: data.customerSession.token,
      expiresAt: data.customerSession.expiresAt,
    };
    storage.setItem(key(qr), JSON.stringify(access));
    storage.setItem(`table:${qr}:sessionId`, access.id);
    storage.setItem(
      `table:${qr}:cartVersion`,
      String(data.session.cartVersion ?? 0)
    );
    return data;
  }
  async function exchange(qr) {
    return persist(qr, await fetchExchange(qr));
  }
  async function ensure(qr) {
    let cached;
    try {
      cached = JSON.parse(storage.getItem(key(qr)));
    } catch {
      /* discard old/corrupt cache */
    }
    if (cached?.blocked)
      throw new Error(
        'Sessão encerrada ou expirada. Volte à entrada da mesa e escaneie o QR novamente.'
      );
    if (
      cached?.token &&
      cached.id &&
      new Date(cached.expiresAt).getTime() > now()
    )
      return cached;
    // Only renew the credential, never silently move an old cart to a new session.
    const previousId = cached?.id || storage.getItem(`table:${qr}:sessionId`);
    // Do not publish a newly issued credential until the previous-session check
    // succeeds: another concurrent request must never observe a new table session.
    const data = await fetchExchange(qr);
    if (previousId && previousId !== data.session.id) {
      reset(qr);
      throw new Error(
        'Uma nova sessão foi aberta. Volte à entrada da mesa para continuar.'
      );
    }
    persist(qr, data);
    return JSON.parse(storage.getItem(key(qr)));
  }
  async function request(qr, path, options = {}) {
    const access = await ensure(qr);
    try {
      return await api(path, {
        ...options,
        credentials: 'omit',
        headers: {
          ...options.headers,
          Authorization: `Bearer ${access.token}`,
        },
      });
    } catch (err) {
      if (
        [
          'CUSTOMER_UNAUTHORIZED',
          'CUSTOMER_SESSION_EXPIRED',
          'SESSION_CLOSED',
        ].includes(err.code)
      )
        reset(qr);
      throw err; // No automatic mutation replay or implicit re-opening after revocation.
    }
  }
  return { exchange, ensure, request };
}
