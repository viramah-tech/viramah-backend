'use strict';

/**
 * Unit tests for services/adjustmentEngine — pure function `_compute`.
 * Plan Section 10 Phase C — 9 mandatory test cases.
 *
 * Zero DB dependency. Run with:
 *   node tests/adjustmentEngine.test.js
 *
 * Exits with non-zero status on any failure.
 */

const assert = require('assert');
const { _compute } = require('../src/services/adjustment-engine');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    failed += 1;
  }
};

// ── Shared fixture builder ────────────────────────────────────────────────────
const makePlan = (overrides = {}) => ({
  components: {
    monthlyRent:         10000,
    totalMonths:         11,
    securityDeposit:     20000,
    registrationCharges: 5000,
    lunch:     { opted: false, monthlyRate: 3000, totalMonths: 11, total: 33000 },
    transport: { opted: false, monthlyRate: 2000, totalMonths: 11, total: 22000 },
  },
  advanceCreditRemaining: 0,
  ...overrides,
});

const makePhase = (overrides = {}) => ({
  phaseNumber: 1,
  monthsCovered: 11,
  componentsAlreadyCollected: [],
  ...overrides,
});

// ── Test cases ────────────────────────────────────────────────────────────────

console.log('\nadjustmentEngine._compute\n');

test('T1: Track 1 — 11 months @ 40% discount + security + registration + lunch + transport', () => {
  const plan = makePlan({
    components: {
      monthlyRent: 10000, totalMonths: 11, securityDeposit: 20000, registrationCharges: 5000,
      lunch:     { opted: true, monthlyRate: 3000, totalMonths: 11, total: 33000 },
      transport: { opted: true, monthlyRate: 2000, totalMonths: 11, total: 22000 },
    },
  });
  const r = _compute({ plan, phase: makePhase({ monthsCovered: 11 }), discountRate: 0.40, discountSource: 'global' });
  assert.strictEqual(r.grossRent, 110000);
  assert.strictEqual(r.discountAmount, 44000);
  assert.strictEqual(r.netRent, 66000);
  assert.strictEqual(r.nonRentalTotal, 20000 + 5000 + 33000 + 22000); // 80000
  assert.strictEqual(r.finalAmount, 66000 + 80000);                   // 146000
});

test('T2: Track 2 Phase 1 — 6 months @ 25% + security + reg + lunch + transport', () => {
  const plan = makePlan({
    components: {
      monthlyRent: 10000, totalMonths: 11, securityDeposit: 20000, registrationCharges: 5000,
      lunch:     { opted: true, monthlyRate: 3000, totalMonths: 11, total: 33000 },
      transport: { opted: true, monthlyRate: 2000, totalMonths: 11, total: 22000 },
    },
  });
  const r = _compute({ plan, phase: makePhase({ monthsCovered: 6 }), discountRate: 0.25, discountSource: 'global' });
  assert.strictEqual(r.grossRent, 60000);
  assert.strictEqual(r.discountAmount, 15000);
  assert.strictEqual(r.netRent, 45000);
  assert.strictEqual(r.nonRentalTotal, 80000);
  assert.strictEqual(r.finalAmount, 125000);
});

test('T3: Track 2 Phase 2 — 5 months @ 25%, no security/reg/lunch/transport', () => {
  const plan = makePlan({
    components: {
      monthlyRent: 10000, totalMonths: 11, securityDeposit: 20000, registrationCharges: 5000,
      lunch:     { opted: true, monthlyRate: 3000, totalMonths: 11, total: 33000 },
      transport: { opted: true, monthlyRate: 2000, totalMonths: 11, total: 22000 },
    },
  });
  const phase = makePhase({
    phaseNumber: 2, monthsCovered: 5,
    componentsAlreadyCollected: ['security', 'registration', 'lunch', 'transport'],
  });
  const r = _compute({ plan, phase, discountRate: 0.25, discountSource: 'global' });
  assert.strictEqual(r.grossRent, 50000);
  assert.strictEqual(r.discountAmount, 12500);
  assert.strictEqual(r.netRent, 37500);
  assert.strictEqual(r.nonRentalTotal, 0);
  assert.strictEqual(r.finalAmount, 37500);
});

test('T4: Track 3 booking — computeBookingAmount covered via nonRental flow (proxy)', () => {
  // Booking has its own computeBookingAmount function. Here we verify the rent-only
  // rule by running _compute with monthsCovered=0 and only non-rentals due.
  const plan = makePlan({
    components: {
      monthlyRent: 10000, totalMonths: 11,
      securityDeposit: 20000, registrationCharges: 5000,
      lunch: { opted: false }, transport: { opted: false },
    },
  });
  const phase = makePhase({ monthsCovered: 0, componentsAlreadyCollected: [] });
  const r = _compute({ plan, phase, discountRate: 0.40, discountSource: 'global' });
  assert.strictEqual(r.grossRent, 0);
  assert.strictEqual(r.discountAmount, 0);        // rate * 0
  assert.strictEqual(r.nonRentalTotal, 25000);    // no discount on these
  assert.strictEqual(r.finalAmount, 25000);
});

test('T5: Track 3 → Track 2 Phase 1 — security + reg already collected, advance credit deducted', () => {
  const plan = makePlan({
    components: {
      monthlyRent: 10000, totalMonths: 11,
      securityDeposit: 20000, registrationCharges: 5000,
      lunch: { opted: false }, transport: { opted: false },
    },
    advanceCreditRemaining: 5000,
  });
  const phase = makePhase({
    monthsCovered: 6,
    componentsAlreadyCollected: ['security', 'registration'],
  });
  const r = _compute({ plan, phase, discountRate: 0.25, discountSource: 'global' });
  assert.strictEqual(r.grossRent, 60000);
  assert.strictEqual(r.discountAmount, 15000);
  assert.strictEqual(r.netRent, 45000);
  assert.strictEqual(r.nonRentalTotal, 0);
  assert.strictEqual(r.advanceCreditApplied, 5000);
  assert.strictEqual(r.finalAmount, 40000);
});

test('T6: Per-user discount override — user gets 30% not global 40%', () => {
  const plan = makePlan();
  const r = _compute({ plan, phase: makePhase({ monthsCovered: 11 }), discountRate: 0.30, discountSource: 'per_user_override' });
  assert.strictEqual(r.discountRate, 0.30);
  assert.strictEqual(r.discountSource, 'per_user_override');
  assert.strictEqual(r.discountAmount, 33000);
  assert.strictEqual(r.netRent, 77000);
});

test('T7: Discount disabled globally — rate = 0, full rent charged', () => {
  const plan = makePlan();
  const r = _compute({ plan, phase: makePhase({ monthsCovered: 11 }), discountRate: 0, discountSource: 'global' });
  assert.strictEqual(r.discountAmount, 0);
  assert.strictEqual(r.netRent, 110000);
  // breakdown should not contain a discount line when discount is 0
  assert.ok(!r.breakdown.some((l) => l.type === 'discount'));
});

test('T8: Waiver of Rs 1000 on Phase 1 — reflected in finalAmount', () => {
  const plan = makePlan();
  const adjustments = [
    { type: 'waiver', valueType: 'flat', value: 1000, description: 'Hardship waiver' },
  ];
  const r = _compute({
    plan, phase: makePhase({ monthsCovered: 6 }),
    discountRate: 0.25, discountSource: 'global', adjustments,
  });
  // grossRent 60000, discount 15000, netRent 45000, nonRental 25000 (sec+reg), adjustment -1000
  assert.strictEqual(r.adjustmentTotal, -1000);
  assert.strictEqual(r.finalAmount, 45000 + 25000 - 1000); // 69000
});

test('T9: Advance credit carry-forward — Rs 5000 covers Phase 1 excess, Rs 2000 would carry to Phase 2', () => {
  // Simulate a phase where netRent+nonRental = 3000, advance = 5000
  // → advanceApplied = 3000, finalAmount = 0, remaining 2000 would carry (driver logic updates plan).
  const plan = makePlan({
    components: {
      monthlyRent: 500, totalMonths: 11,
      securityDeposit: 0, registrationCharges: 0,
      lunch: { opted: false }, transport: { opted: false },
    },
    advanceCreditRemaining: 5000,
  });
  const phase = makePhase({ monthsCovered: 6 }); // rent 3000
  const r = _compute({ plan, phase, discountRate: 0, discountSource: 'global' });
  assert.strictEqual(r.netRent, 3000);
  assert.strictEqual(r.nonRentalTotal, 0);
  assert.strictEqual(r.advanceCreditApplied, 3000); // capped at due amount
  assert.strictEqual(r.finalAmount, 0);
  // The caller (API layer) is responsible for writing plan.advanceCreditRemaining -= 3000
  // so Phase 2 next call sees 2000 remaining. The pure function does not mutate state.
});

test('SANITY: discount never applied to security/registration/lunch/transport in any test above', () => {
  // Re-run T1 and assert non-rental line amounts exactly match plan.components
  const plan = makePlan({
    components: {
      monthlyRent: 10000, totalMonths: 11, securityDeposit: 20000, registrationCharges: 5000,
      lunch:     { opted: true, monthlyRate: 3000, totalMonths: 11, total: 33000 },
      transport: { opted: true, monthlyRate: 2000, totalMonths: 11, total: 22000 },
    },
  });
  const r = _compute({ plan, phase: makePhase({ monthsCovered: 11 }), discountRate: 0.40, discountSource: 'global' });
  const security = r.breakdown.find((l) => l.label === 'Security deposit');
  const reg      = r.breakdown.find((l) => l.label === 'Registration charges');
  const lunch    = r.breakdown.find((l) => String(l.label).startsWith('Lunch'));
  const transp   = r.breakdown.find((l) => String(l.label).startsWith('Transport'));
  assert.strictEqual(security.amount, 20000);
  assert.strictEqual(reg.amount,      5000);
  assert.strictEqual(lunch.amount,    33000);
  assert.strictEqual(transp.amount,   22000);
});

// ── Tariff Snapshot Tests ─────────────────────────────────────────────────────
// Validates per-month rounding formula against the ground-truth tariff card.
// Formula: discountedBase = Math.round(base × (1 - discount%/100))
//          gstAmt         = Math.round(discountedBase × 0.12)
//          monthlyTotal   = discountedBase + gstAmt

console.log('\nTariff snapshot — all room types, both plans\n');

const GST = 0.12;
const SECURITY = 15000;
const REGISTRATION = 1000;

function calcMonthly(baseMonthly, discountPercent) {
  const discountedBase = Math.round(baseMonthly * (1 - discountPercent / 100));
  const gstAmt = Math.round(discountedBase * GST);
  return discountedBase + gstAmt;
}

const rooms = [
  { name: 'AXIS_PLUS_STUDIO', base: 24538 },
  { name: 'AXIS_STUDIO',      base: 21563 },
  { name: 'COLLECTIVE_1BHK',  base: 18587 },
  { name: 'NEXUS_1BHK',       base: 13527 },
];

const halfYearlyExpected = {
  AXIS_PLUS_STUDIO: { inst1: 139672, inst2: 103060 },
  AXIS_STUDIO:      { inst1: 124678, inst2: 90565 },
  COLLECTIVE_1BHK:  { inst1: 109678, inst2: 78065 },
  NEXUS_1BHK:       { inst1: 84172,  inst2: 56810 },
};

const fullTenureExpected = {
  AXIS_PLUS_STUDIO: 197390,
  AXIS_STUDIO:      175401,
  COLLECTIVE_1BHK:  153390,
  NEXUS_1BHK:       115990,
};

rooms.forEach(({ name, base }) => {
  test(`${name} — half-yearly installment 1 matches tariff`, () => {
    const monthly = calcMonthly(base, 25);
    const inst1Room = monthly * 6;
    const inst1Total = inst1Room + SECURITY + REGISTRATION;
    assert.strictEqual(inst1Total, halfYearlyExpected[name].inst1,
      `${name} half-yearly inst1: expected ${halfYearlyExpected[name].inst1}, got ${inst1Total}`);
  });

  test(`${name} — half-yearly installment 2 matches tariff`, () => {
    const monthly = calcMonthly(base, 25);
    const inst2 = monthly * 5;
    assert.strictEqual(inst2, halfYearlyExpected[name].inst2,
      `${name} half-yearly inst2: expected ${halfYearlyExpected[name].inst2}, got ${inst2}`);
  });

  test(`${name} — full-tenure total matches tariff`, () => {
    const monthly = calcMonthly(base, 40);
    const roomRent11 = monthly * 11;
    const total = roomRent11 + SECURITY + REGISTRATION;
    assert.strictEqual(total, fullTenureExpected[name],
      `${name} full-tenure: expected ${fullTenureExpected[name]}, got ${total}`);
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
