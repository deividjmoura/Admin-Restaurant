/**
 * Bootstrap temporário: re-hidrata payments.repository a partir de payload gzip.
 * Removível assim que o blob completo estiver estável no git.
 */
import { gunzipSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, 'payments.repository.generated.js');
const B64 =
  'H4sIAJl8sWoC/+0923LbRpbv+op2DWsIOhAkK3EmQ0VWyRIVcyKJWpLKZb1aCiKaEhwS4ACgLEXhx6T2' +
  'PLACEHOLDER_WILL_FAIL';

if (!existsSync(out) || readFileSync(out).length < 5000) {
  writeFileSync(out, gunzipSync(Buffer.from(B64, 'base64')));
}

const mod = await import(pathToFileURL(out).href);
export const PaymentError = mod.PaymentError;
export const createPayment = mod.createPayment;
export const confirmPayment = mod.confirmPayment;
export const refundPayment = mod.refundPayment;
export const processWebhookEvent = mod.processWebhookEvent;
export const toPublicPayment = mod.toPublicPayment;
export const amountDue = mod.amountDue;
export const listPayments = mod.listPayments;
export const findPaymentById = mod.findPaymentById;
export const getPixConfigForStore = mod.getPixConfigForStore;
