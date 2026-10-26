import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_BUSINESS_SETTINGS,
  parseBusinessSettings,
  parseOffer,
  parseOrder,
} from './business.validation';
import { validatePaymentFact } from './business.orders';

test('sales stay disabled until real business documents have been supplied', () => {
  assert.equal(parseBusinessSettings(EMPTY_BUSINESS_SETTINGS).salesEnabled, false);
  assert.throws(() => parseBusinessSettings({ ...EMPTY_BUSINESS_SETTINGS, salesEnabled: true }));
  assert.throws(() =>
    parseBusinessSettings({ ...EMPTY_BUSINESS_SETTINGS, merchantSecret: 'forbidden' }),
  );
});

test('offers reject fractional cents, missing deliverables and an unknown lifecycle status', () => {
  const input = {
    id: '',
    revision: 0,
    templateVersionId: 'version',
    title: '项目包',
    summary: '一个项目',
    audience: '初中生',
    outcomes: ['观察报告'],
    priceFen: 100,
    accessDays: 30,
    requiresPurchase: true,
    status: 'draft',
  };
  assert.equal(parseOffer(input).priceFen, 100);
  for (const bad of [
    { priceFen: 1.1 },
    { priceFen: 0 },
    { outcomes: [] },
    { accessDays: -1 },
    { status: 'approved' },
  ])
    assert.throws(() => parseOffer({ ...input, ...bad }));
});

test('buyers cannot submit price, payment or mastery facts and must explicitly accept current terms', () => {
  const input = {
    offerId: 'offer',
    offerRevision: 1,
    settingsRevision: 1,
    studentId: 'student',
    acceptedTerms: true,
    guardianConsent: true,
  };
  assert.equal(parseOrder(input).studentId, 'student');
  for (const bad of [
    { priceFen: 1 },
    { paid: true },
    { TheoryMastered: true },
    { acceptedTerms: false },
    { guardianConsent: false },
    { offerRevision: 1.2 },
  ])
    assert.throws(() => parseOrder({ ...input, ...bad }));
});

test('payment receipt must match frozen order amount and established transaction identity', () => {
  const order = { id: 'order', amountFen: 100, transactionId: null };
  const fact = {
    orderId: 'order',
    amountFen: 100,
    transactionId: 'trade-1',
    paidAt: new Date().toISOString(),
  };
  assert.doesNotThrow(() => validatePaymentFact(order, fact));
  assert.throws(() => validatePaymentFact(order, { ...fact, amountFen: 1 }));
  assert.throws(() => validatePaymentFact(order, { ...fact, orderId: 'someone-elses-order' }));
  assert.throws(() => validatePaymentFact({ ...order, transactionId: 'trade-2' }, fact));
});
