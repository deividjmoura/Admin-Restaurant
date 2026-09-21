import { api } from './client';
import { createCustomerClient } from './customer-session';
export const customer = createCustomerClient({
  api,
  storage: window.sessionStorage,
});
