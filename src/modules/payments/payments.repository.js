/**
 * Re-hidrata payments.repository a partir de partes base64 gzip.
 */
import { gunzipSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, 'payments.repository.generated.js');

if (!existsSync(out) || readFileSync(out).length < 5000) {
  const parts = [];
  for (let i = 0; i < 10; i++) {
    const p = join(dir, `pay_b64_part${i}.txt`);
    if (!existsSync(p)) break;
    parts.push(readFileSync(p, 'utf8').trim());
  }
  writeFileSync(out, gunzipSync(Buffer.from(parts.join(''), 'base64')));
}

const mod = await import(pathToFileURL(out).href);
export const PaymentError = mod.PaymentError;
export const AMOUNT_TOLERANCE = mod.AMOUNT_TOLERANCE;
export const toCents = mod.toCents;
export const round2 = mod.round2;
export const hasCentPrecision = mod.hasCentPrecision;
export const findPaymentById = mod.findPaymentById;
export const findPaymentByIdempotency = mod.findPaymentByIdempotency;
export const findPaymentByProviderReference = mod.findPaymentByProviderReference;
export const listPayments = mod.listPayments;
export const amountDue = mod.amountDue;
export const assertPaymentTarget = mod.assertPaymentTarget;
export const resolveProviderContext = mod.resolveProviderContext;
export const createPayment = mod.createPayment;
export const confirmPayment = mod.confirmPayment;
export const refundPayment = mod.refundPayment;
export const processWebhookEvent = mod.processWebhookEvent;
export const getPixConfigForStore = mod.getPixConfigForStore;
export const findPaymentsBySplitGroup = mod.findPaymentsBySplitGroup;
export const createSplitPayments = mod.createSplitPayments;
export const toPublicPayment = mod.toPublicPayment;
export const toPublicPaymentFromRow = mod.toPublicPaymentFromRow;
