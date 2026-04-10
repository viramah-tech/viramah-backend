'use strict';

/**
 * installmentService.js — V2.0 Partial Payment Architecture.
 *
 * Handles the core requirement: users can pay installments in MULTIPLE
 * partial payments (e.g., ₹90,000 of ₹150,000, then ₹60,000 later).
 *
 * ALL monetary values in RUPEES (INR).
 */

const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const User = require('../models/User');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Process a partial payment within an installment.
 *
 * @param {string} bookingId - Booking ObjectId
 * @param {number} installmentNumber - Which installment (1 or 2)
 * @param {number} paymentAmount - Amount being paid (rupees)
 * @param {object} paymentMethod - { type: 'UPI'|'BANK_TRANSFER'|'CASH', details: {} }
 * @param {object} proofData - { fileUrl, utrNumber }
 */
async function processPartialPayment(bookingId, installmentNumber, paymentAmount, paymentMethod, proofData) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const installment = booking.installments.find(
    i => i.installmentNumber === installmentNumber
  );
  if (!installment) throw err(`Installment ${installmentNumber} not found`, 404);

  // Validate amount
  const remaining = installment.totalAmount - installment.amountPaid;

  if (paymentAmount > remaining) {
    throw err(`PAYMENT_EXCEEDS_REMAINING: Cannot pay more than ₹${remaining.toLocaleString()}`, 400);
  }
  if (paymentAmount < 1000) {
    throw err('MINIMUM_PAYMENT: Minimum payment is ₹1,000', 400);
  }

  // Determine category
  const category = installmentNumber === 1
    ? (booking.paymentPlan.selectedTrack === 'FULL_TENURE' ? 'ROOM_RENT_FULL' : 'ROOM_RENT_INSTALLMENT_1')
    : 'ROOM_RENT_INSTALLMENT_2';

  // Create payment record with installment context
  const payment = await Payment.create({
    userId: booking.userId,
    bookingId: booking._id,
    amount: paymentAmount,
    type: 'INSTALLMENT',
    category,
    installmentContext: {
      isPartialPayment: paymentAmount < remaining,
      installmentNumber,
      installmentPaymentSequence: installment.partialPayments.length + 1,
      totalInstallmentAmount: installment.totalAmount,
      thisPaymentAmount: paymentAmount,
      remainingAfterThisPayment: remaining - paymentAmount,
    },
    amounts: {
      totalAmount: paymentAmount,
    },
    method: paymentMethod || {},
    utrNumber: proofData?.utrNumber || null,
    proofDocument: proofData?.fileUrl ? {
      fileUrl: proofData.fileUrl,
      uploadedAt: new Date(),
      verificationStatus: 'PENDING',
    } : undefined,
    status: 'pending',
    submittedAt: new Date(),
  });

  // Add to installment's partial payments list (pending approval)
  installment.partialPayments.push({
    paymentId: payment._id,
    amount: paymentAmount,
    status: 'PENDING',
    paidAt: new Date(),
  });

  // Update installment status
  if (installment.status === 'PENDING') {
    installment.status = 'PARTIALLY_PAID';
  }

  await booking.save();

  return {
    paymentId: payment.paymentId,
    status: 'PENDING_VERIFICATION',
    installmentNumber,
    installmentStatus: installment.status,
    thisPayment: paymentAmount,
    totalInstallment: installment.totalAmount,
    remainingAmount: remaining - paymentAmount,
    paymentSequence: installment.partialPayments.length,
  };
}

/**
 * Called when admin approves a partial payment.
 * Recalculates installment totals and updates booking status.
 */
async function onPartialPaymentApproved(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);
  if (!payment.installmentContext?.installmentNumber) {
    throw err('Payment is not an installment partial payment', 400);
  }

  const booking = await Booking.findById(payment.bookingId);
  if (!booking) throw err('Booking not found', 404);

  const installment = booking.installments.find(
    i => i.installmentNumber === payment.installmentContext.installmentNumber
  );
  if (!installment) throw err('Installment not found', 404);

  // 1. Update the partial payment status in the installment
  const partialPayment = installment.partialPayments.find(
    pp => pp.paymentId && pp.paymentId.toString() === paymentId.toString()
  );
  if (partialPayment) {
    partialPayment.status = 'APPROVED';
    partialPayment.approvedAt = new Date();
  }

  // 2. Recalculate installment totals from approved partial payments
  const approvedPayments = installment.partialPayments.filter(pp => pp.status === 'APPROVED');
  installment.amountPaid = approvedPayments.reduce((sum, pp) => sum + pp.amount, 0);
  installment.amountRemaining = installment.totalAmount - installment.amountPaid;

  // 3. Update installment status
  if (installment.amountRemaining <= 0) {
    installment.status = 'COMPLETED';
    installment.completedAt = new Date();
  } else {
    installment.status = 'PARTIALLY_PAID';
  }

  // 4. Update booking's overall totals
  booking.financials.totalPaid = (booking.financials.totalPaid || 0) + payment.amount;
  booking.financials.totalPending = (booking.financials.grandTotal || 0) - booking.financials.totalPaid;

  // 5. Update booking status based on all installments
  await updateBookingPaymentStatus(booking);

  await booking.save();

  return {
    installmentNumber: installment.installmentNumber,
    amountPaid: installment.amountPaid,
    amountRemaining: installment.amountRemaining,
    status: installment.status,
    bookingStatus: booking.status,
  };
}

/**
 * Get full payment page data for an installment, with embedded history.
 */
async function getPaymentPageData(bookingId, installmentNumber) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const installment = booking.installments.find(
    i => i.installmentNumber === installmentNumber
  );
  if (!installment) throw err(`Installment ${installmentNumber} not found`, 404);

  // Fetch full payment details for history
  const paymentIds = installment.partialPayments.map(pp => pp.paymentId).filter(Boolean);
  const payments = paymentIds.length > 0
    ? await Payment.find({ _id: { $in: paymentIds } }).lean()
    : [];

  // Build payment history
  const paymentHistory = installment.partialPayments
    .filter(pp => pp.status === 'APPROVED')
    .map(pp => {
      const fullPayment = payments.find(p => p._id.toString() === pp.paymentId?.toString());
      return {
        amount: pp.amount,
        paidAt: pp.paidAt,
        approvedAt: pp.approvedAt,
        paymentId: fullPayment?.paymentId || null,
        status: pp.status,
        method: fullPayment?.method?.type || fullPayment?.paymentMethodV2 || null,
        utrNumber: fullPayment?.utrNumber || fullPayment?.transactionId || null,
      };
    });

  // Build deductions
  const deductions = [];
  if (booking.displayBills?.projectedFinalBill) {
    const track = booking.paymentPlan?.selectedTrack === 'FULL_TENURE' ? 'fullTenure' : 'halfYearly';
    const projBill = booking.displayBills.projectedFinalBill[track];
    if (projBill?.deductions?.securityDeposit) {
      deductions.push({
        label: projBill.deductions.securityDeposit.label,
        amount: -projBill.deductions.securityDeposit.amount,
      });
    }
    if (projBill?.deductions?.referralCredits?.length > 0) {
      projBill.deductions.referralCredits.forEach(rc => {
        deductions.push({ label: rc.label, amount: -rc.amount });
      });
    }
  }

  // Days remaining
  const daysRemaining = installment.dueDate
    ? Math.max(0, Math.ceil((new Date(installment.dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    currentInstallment: {
      number: installment.installmentNumber,
      type: installment.type,
      totalAmount: installment.totalAmount,
      amountPaid: installment.amountPaid,
      amountRemaining: installment.amountRemaining,
      status: installment.status,
      dueDate: installment.dueDate,
      daysRemaining,
    },
    paymentHistory,
    nextPayment: {
      minimumAmount: Math.min(1000, installment.amountRemaining),
      maximumAmount: installment.amountRemaining,
      recommendedAmounts: generateRecommendedAmounts(installment.amountRemaining),
    },
    deductionsApplied: deductions,
    pendingPayments: installment.partialPayments
      .filter(pp => pp.status === 'PENDING')
      .map(pp => ({ amount: pp.amount, paidAt: pp.paidAt })),
  };
}

/**
 * Generate quick-select recommended payment amounts.
 */
function generateRecommendedAmounts(remaining) {
  if (remaining <= 0) return [];
  const amounts = [remaining]; // Full remaining always first
  if (remaining > 2000) amounts.push(Math.ceil(remaining / 2));
  if (remaining > 10000) amounts.push(Math.ceil(remaining / 3));
  if (remaining > 20000) amounts.push(10000);
  return [...new Set(amounts)].sort((a, b) => b - a).slice(0, 4);
}

/**
 * Update booking status based on installment progress.
 */
async function updateBookingPaymentStatus(booking) {
  const allInstallments = booking.installments;
  if (allInstallments.length === 0) return;

  const allCompleted = allInstallments.every(i => i.status === 'COMPLETED');
  const somePartial = allInstallments.some(i => i.status === 'PARTIALLY_PAID');
  const someOverdue = allInstallments.some(i => i.status === 'OVERDUE');

  if (allCompleted) {
    // Check if services are still pending
    const messPending = booking.servicePayments?.mess?.status === 'PENDING' ||
                        booking.servicePayments?.mess?.status === 'PARTIALLY_PAID';
    const transportPending = booking.servicePayments?.transport?.status === 'PENDING' ||
                             booking.servicePayments?.transport?.status === 'PARTIALLY_PAID';

    if (messPending || transportPending) {
      booking.status = 'SERVICES_PENDING';
    } else {
      booking.status = 'FULLY_PAID';
    }

    // Update user
    await User.findByIdAndUpdate(booking.userId, {
      'paymentProfile.paymentStatus': booking.status,
    });
  } else if (someOverdue) {
    booking.status = 'OVERDUE';
  } else if (somePartial) {
    booking.status = 'PARTIALLY_PAID';
    await User.findByIdAndUpdate(booking.userId, {
      'paymentProfile.paymentStatus': 'PARTIALLY_PAID',
    });
  }
}

module.exports = {
  processPartialPayment,
  onPartialPaymentApproved,
  getPaymentPageData,
  updateBookingPaymentStatus,
};
