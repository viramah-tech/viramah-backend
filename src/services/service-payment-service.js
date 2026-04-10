'use strict';

/**
 * servicePaymentService.js — V2.0 Standalone Mess/Transport Payments.
 *
 * Handles independent payment flows for mess (lunch) and transport services.
 * These are decoupled from room rent installments.
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
 * Get available service payment options for a booking.
 * Returns mess and transport payment status/amounts if applicable.
 */
async function getServicePaymentOptions(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const options = [];

  if (booking.selections.mess?.selected &&
      booking.servicePayments.mess.status !== 'COMPLETED' &&
      booking.servicePayments.mess.status !== 'NOT_APPLICABLE') {
    const messDue = (booking.servicePayments.mess.totalAmount || 0) - (booking.servicePayments.mess.amountPaid || 0);
    options.push({
      service: 'MESS',
      label: 'Mess (Lunch)',
      totalAmount: booking.servicePayments.mess.totalAmount,
      amountPaid: booking.servicePayments.mess.amountPaid,
      amountDue: messDue,
      monthlyRate: Math.round((booking.servicePayments.mess.totalAmount || 0) / 11),
      tenure: 11,
      status: booking.servicePayments.mess.status,
      paymentHistory: booking.servicePayments.mess.payments || [],
    });
  }

  if (booking.selections.transport?.selected &&
      booking.servicePayments.transport.status !== 'COMPLETED' &&
      booking.servicePayments.transport.status !== 'NOT_APPLICABLE') {
    const transportDue = (booking.servicePayments.transport.totalAmount || 0) - (booking.servicePayments.transport.amountPaid || 0);
    options.push({
      service: 'TRANSPORT',
      label: 'Transport',
      totalAmount: booking.servicePayments.transport.totalAmount,
      amountPaid: booking.servicePayments.transport.amountPaid,
      amountDue: transportDue,
      monthlyRate: Math.round((booking.servicePayments.transport.totalAmount || 0) / 11),
      tenure: 11,
      status: booking.servicePayments.transport.status,
      paymentHistory: booking.servicePayments.transport.payments || [],
    });
  }

  return options;
}

/**
 * Submit a payment for a specific service (mess or transport).
 */
async function submitServicePayment(bookingId, serviceType, amount, proofData, paymentMethod) {
  const st = serviceType.toLowerCase();
  if (!['mess', 'transport'].includes(st)) {
    throw err('Invalid service type. Must be MESS or TRANSPORT', 400);
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const service = booking.servicePayments[st];
  if (!service || service.status === 'NOT_APPLICABLE') {
    throw err(`${serviceType} is not applicable for this booking`, 400);
  }
  if (service.status === 'COMPLETED') {
    throw err(`${serviceType} payment already completed`, 400);
  }

  const approvedAmt = (service.payments || [])
    .filter(p => p.status === 'APPROVED')
    .reduce((s, p) => s + p.amount, 0);
  const pendingAmt = (service.payments || [])
    .filter(p => p.status === 'PENDING')
    .reduce((s, p) => s + p.amount, 0);
  const remaining = (service.totalAmount || 0) - approvedAmt - pendingAmt;

  if (amount > remaining) {
    throw err(`Cannot submit more than ₹${remaining.toLocaleString()} for ${serviceType} (includes pending approvals)`, 400);
  }
  if (amount < 500) {
    throw err('Minimum service payment is ₹500', 400);
  }

  // Create payment record
  const payment = await Payment.create({
    userId: booking.userId,
    bookingId: booking._id,
    amount,
    type: st.toUpperCase(),
    category: `${st.toUpperCase()}_FEE`,
    amounts: { totalAmount: amount },
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

  // Add to service payment tracking
  service.payments.push({
    paymentId: payment._id,
    amount,
    status: 'PENDING',
  });

  await booking.save();

  return {
    paymentId: payment.paymentId,
    service: serviceType.toUpperCase(),
    amount,
    status: 'PENDING_VERIFICATION',
    remaining: remaining - amount,
  };
}

/**
 * Called when admin approves a service payment.
 * Updates the service payment tracking and booking status.
 */
async function onServicePaymentApproved(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);

  if (!['MESS', 'TRANSPORT'].includes(payment.type)) {
    throw err('Payment is not a service payment', 400);
  }

  const booking = await Booking.findById(payment.bookingId);
  if (!booking) throw err('Booking not found', 404);

  const st = payment.type.toLowerCase();
  const service = booking.servicePayments[st];

  // Update the payment entry in service payments
  const servicePayment = service.payments.find(
    sp => sp.paymentId && sp.paymentId.toString() === paymentId.toString()
  );
  if (servicePayment) {
    servicePayment.status = 'APPROVED';
  }

  // Recalculate from approved payments
  const approvedPayments = service.payments.filter(sp => sp.status === 'APPROVED');
  service.amountPaid = approvedPayments.reduce((sum, sp) => sum + sp.amount, 0);

  // Update service status
  if (service.amountPaid >= service.totalAmount) {
    service.status = 'COMPLETED';
  } else if (service.amountPaid > 0) {
    service.status = 'PARTIALLY_PAID';
  }

  // Check if all services are now complete to update booking
  const messComplete = booking.servicePayments.mess.status === 'COMPLETED' ||
                       booking.servicePayments.mess.status === 'NOT_APPLICABLE';
  const transportComplete = booking.servicePayments.transport.status === 'COMPLETED' ||
                            booking.servicePayments.transport.status === 'NOT_APPLICABLE';

  if (messComplete && transportComplete && booking.status === 'SERVICES_PENDING') {
    booking.status = 'COMPLETED';
    booking.statusHistory.push({
      status: 'COMPLETED',
      changedBy: 'SYSTEM',
      reason: 'All payments (rent + services) completed',
    });
    await User.findByIdAndUpdate(booking.userId, {
      'paymentProfile.paymentStatus': 'COMPLETED',
    });
  }

  await booking.save();

  return {
    service: payment.type,
    amountPaid: service.amountPaid,
    totalAmount: service.totalAmount,
    remaining: service.totalAmount - service.amountPaid,
    status: service.status,
    bookingStatus: booking.status,
  };
}

module.exports = {
  getServicePaymentOptions,
  submitServicePayment,
  onServicePaymentApproved,
};
