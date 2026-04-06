'use strict';

/**
 * One-shot migration — brings legacy payments/transactions forward into the
 * V2 schema defined by VIRAMAH_Payment_Rebuild_Plan (Phases A–G).
 *
 * Decisions baked in (see chat with user, Phase A resolution):
 *  1. Legacy uuid-style paymentId/transactionId are preserved as-is.
 *  2. `paymentMethodV2` is mapped best-effort from free-text `paymentMethod`
 *     (UPI/NEFT/RTGS/IMPS/CASH/CHEQUE → match; anything else → 'OTHER').
 *  3. Every existing Transaction gets postingStatus='posted', direction='credit',
 *     sourceType='payment', sourceId=paymentId (already-processed).
 *  4. A synthetic PaymentPlan is created per user for payments in
 *     [pending, approved, upcoming]. Rejected payments are left unlinked.
 *  5. bookingId references RoomHold when one exists for that user.
 *
 * Idempotent: re-runs skip rows that already have v2 fields set.
 *
 * Run:
 *   node src/scripts/migratePaymentsToV2.js            # dry-run
 *   node src/scripts/migratePaymentsToV2.js --commit   # apply
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB    = require('../config/db');
const Payment      = require('../models/Payment');
const Transaction  = require('../models/Transaction');
const PaymentPlan  = require('../models/PaymentPlan');
const RoomHold     = require('../models/RoomHold');

const COMMIT = process.argv.includes('--commit');

const mapMethod = (raw) => {
  const s = String(raw || '').trim().toUpperCase();
  if (['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE'].includes(s)) return s;
  if (!s) return null;
  return 'OTHER';
};

const trackFromMode = (mode) =>
  mode === 'full' ? 'full' : mode === 'half' ? 'twopart' : mode === 'deposit' ? 'booking' : 'full';

const paymentTypeFromLegacy = (p) => {
  if (p.paymentMode === 'full') return 'track1_full';
  if (p.paymentMode === 'half') return p.installmentNumber === 2 ? 'track2_phase2' : 'track2_phase1';
  if (p.paymentMode === 'deposit') return 'track3_booking';
  return 'manual_admin';
};

async function migrateTransactions() {
  const cursor = Transaction.find({ postingStatus: { $exists: false } }).cursor();
  let n = 0;
  for (let txn = await cursor.next(); txn; txn = await cursor.next()) {
    n += 1;
    txn.postingStatus = 'posted';
    txn.postedAt      = txn.createdAt || new Date();
    txn.direction     = 'credit';
    txn.sourceType    = 'payment';
    txn.sourceId      = txn.paymentId || null;
    txn.typeV2        = 'rent'; // best-effort; legacy records have no line-item breakdown
    if (COMMIT) await txn.save();
  }
  console.log(`[migrate] transactions updated: ${n}${COMMIT ? '' : ' (dry-run)'}`);
  return n;
}

async function migratePayments() {
  const payments = await Payment.find({ planId: null }).sort({ createdAt: 1 }).lean(false);
  console.log(`[migrate] payments to process: ${payments.length}`);

  // Group by userId so one plan is created per user
  const byUser = new Map();
  for (const p of payments) {
    if (['rejected'].includes(p.status)) continue;
    if (!byUser.has(String(p.userId))) byUser.set(String(p.userId), []);
    byUser.get(String(p.userId)).push(p);
  }

  let plansCreated = 0;
  let paymentsLinked = 0;

  for (const [userId, userPayments] of byUser.entries()) {
    // Pick anchor payment (installment 1 if present)
    const anchor = userPayments.find((p) => p.installmentNumber === 1) || userPayments[0];
    const bd = anchor.breakdown || {};

    const hold = await RoomHold.findOne({ userId }).sort({ createdAt: -1 }).lean();

    // Reconstruct components from the immutable breakdown
    const monthlyRent = bd.discountedMonthlyWithGST || bd.roomMonthly || 0;
    const totalMonths = bd.tenureMonths || 11;

    const lunchOpted     = !!(bd.messTotal && bd.messTotal > 0);
    const transportOpted = !!(bd.transportTotal && bd.transportTotal > 0);

    const trackId = trackFromMode(anchor.paymentMode);

    // Build phases
    const phases = [];
    if (trackId === 'full') {
      phases.push({
        phaseNumber: 1,
        monthsCovered: totalMonths,
        componentsDue: ['rent', 'security', 'registration',
          ...(lunchOpted ? ['lunch'] : []),
          ...(transportOpted ? ['transport'] : [])],
        componentsAlreadyCollected: [],
        grossRent:      (bd.roomMonthly || 0) * totalMonths,
        discountRate:   bd.discountRate || 0,
        discountAmount: ((bd.roomMonthly || 0) * totalMonths) - (bd.roomRentTotal || 0),
        netRent:        bd.roomRentTotal || 0,
        nonRentalTotal: (bd.securityDeposit || 0) + (bd.registrationFee || 0)
                        + (bd.messTotal || 0) + (bd.transportTotal || 0),
        advanceCreditApplied: 0,
        finalAmount:    bd.finalAmount || anchor.amount || 0,
        breakdown:      [],
        dueDate: anchor.dueDate || null,
        status:  anchor.status === 'approved' ? 'paid' : 'pending',
        paidOn:  anchor.status === 'approved' ? anchor.updatedAt : null,
        paymentId: anchor._id,
      });
    } else {
      // twopart
      const p1 = userPayments.find((p) => p.installmentNumber === 1);
      const p2 = userPayments.find((p) => p.installmentNumber === 2);
      if (p1) {
        const b = p1.breakdown || {};
        phases.push({
          phaseNumber: 1,
          monthsCovered: b.installmentMonths || 6,
          componentsDue: ['rent', 'security', 'registration',
            ...(lunchOpted ? ['lunch'] : []),
            ...(transportOpted ? ['transport'] : [])],
          componentsAlreadyCollected: [],
          grossRent:      (b.roomMonthly || 0) * (b.installmentMonths || 6),
          discountRate:   b.discountRate || 0,
          discountAmount: ((b.roomMonthly || 0) * (b.installmentMonths || 6)) - (b.roomRentTotal || 0),
          netRent:        b.roomRentTotal || 0,
          nonRentalTotal: (b.securityDeposit || 0) + (b.registrationFee || 0)
                          + (b.messTotal || 0) + (b.transportTotal || 0),
          advanceCreditApplied: 0,
          finalAmount:    b.finalAmount || p1.amount || 0,
          breakdown:      [],
          dueDate: p1.dueDate || null,
          status:  p1.status === 'approved' ? 'paid' : 'pending',
          paidOn:  p1.status === 'approved' ? p1.updatedAt : null,
          paymentId: p1._id,
        });
      }
      if (p2) {
        const b = p2.breakdown || {};
        phases.push({
          phaseNumber: 2,
          monthsCovered: b.installmentMonths || 5,
          componentsDue: ['rent'],
          componentsAlreadyCollected: ['security', 'registration',
            ...(lunchOpted ? ['lunch'] : []),
            ...(transportOpted ? ['transport'] : [])],
          grossRent:      (b.roomMonthly || 0) * (b.installmentMonths || 5),
          discountRate:   b.discountRate || 0,
          discountAmount: ((b.roomMonthly || 0) * (b.installmentMonths || 5)) - (b.roomRentTotal || 0),
          netRent:        b.roomRentTotal || 0,
          nonRentalTotal: 0,
          advanceCreditApplied: 0,
          finalAmount:    b.finalAmount || p2.amount || 0,
          breakdown:      [],
          dueDate: p2.dueDate || null,
          status:  p2.status === 'approved' ? 'paid'
                   : p2.status === 'upcoming' ? 'locked' : 'pending',
          paidOn:  p2.status === 'approved' ? p2.updatedAt : null,
          paymentId: p2._id,
          lockedReason: p2.status === 'upcoming' ? 'Awaiting due date' : null,
        });
      }
    }

    const planDoc = {
      userId,
      bookingId: hold?._id || null,
      roomId: null, // legacy payments did not always record room directly
      trackId,
      chosenTrackId: trackId === 'booking' ? null : trackId,
      components: {
        monthlyRent,
        totalMonths,
        securityDeposit:     bd.securityDeposit || 0,
        registrationCharges: bd.registrationFee || 0,
        lunch:     { opted: lunchOpted,     monthlyRate: bd.messMonthly || 0,      totalMonths, total: bd.messTotal || 0 },
        transport: { opted: transportOpted, monthlyRate: bd.transportMonthly || 0, totalMonths, total: bd.transportTotal || 0 },
      },
      advanceCreditTotal: 0,
      advanceCreditConsumed: 0,
      advanceCreditRemaining: 0,
      discountRate: bd.discountRate || 0,
      discountSource: 'global',
      phases,
      status: phases.every((ph) => ph.status === 'paid') ? 'completed' : 'active',
      createdBy: { role: 'system-migration' },
    };

    let plan;
    if (COMMIT) {
      plan = await PaymentPlan.create(planDoc);
      plansCreated += 1;
    } else {
      plansCreated += 1;
    }

    // Link each payment back to the plan and set V2 fields
    for (const p of userPayments) {
      p.planId        = plan?._id || null;
      p.bookingId     = hold?._id || null;
      p.phaseNumber   = p.installmentNumber || null;
      p.paymentType   = paymentTypeFromLegacy(p);
      p.grossRent            = (p.breakdown?.roomMonthly || 0) * (p.breakdown?.installmentMonths || 0);
      p.discountAmount       = p.grossRent - (p.breakdown?.roomRentTotal || 0);
      p.netRent              = p.breakdown?.roomRentTotal || 0;
      p.nonRentalTotal       = (p.breakdown?.securityDeposit || 0) + (p.breakdown?.registrationFee || 0)
                               + (p.breakdown?.messTotal || 0) + (p.breakdown?.transportTotal || 0);
      p.advanceCreditApplied = 0;
      p.paymentMethodV2      = mapMethod(p.paymentMethod);
      p.submittedAt          = p.createdAt;
      if (p.status === 'approved') {
        p.reviewedAt = p.updatedAt;
      }
      if (COMMIT) await p.save();
      paymentsLinked += 1;
    }
  }

  console.log(`[migrate] plans created: ${plansCreated}${COMMIT ? '' : ' (dry-run)'}`);
  console.log(`[migrate] payments linked: ${paymentsLinked}${COMMIT ? '' : ' (dry-run)'}`);
}

async function run() {
  await connectDB();
  console.log(`[migrate] mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
  await migrateTransactions();
  await migratePayments();
  await mongoose.disconnect();
  console.log('[migrate] done');
}

run().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
