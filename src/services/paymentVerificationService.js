'use strict';

const crypto = require('crypto');
const Payment = require('../models/Payment');
const PaymentVerification = require('../models/PaymentVerification');

/**
 * paymentVerificationService.js — Handles OCR, duplicate detection, risk scoring,
 * and admin verification queue management.
 *
 * REFACTORED: Now writes verification/OCR/risk data to the dedicated
 * PaymentVerification collection instead of directly onto the Payment model.
 * Payment.proofDocument.ocrData is kept as a denormalized summary for
 * backward compatibility with existing admin views.
 */

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Creates a PaymentVerification record for a new payment submission.
 * Called when a booking/final payment is submitted with proof.
 */
async function createVerificationRecord(paymentId, { bookingId, userId }) {
  const existing = await PaymentVerification.findOne({ paymentId });
  if (existing) return existing; // Idempotent

  const record = await PaymentVerification.create({
    paymentId,
    bookingId: bookingId || null,
    userId,
    status: 'PENDING',
    actionHistory: [{
      action: 'CREATED',
      actor: { id: String(userId), role: 'USER' },
      timestamp: new Date(),
      detail: 'Verification record created on payment submission',
      newStatus: 'PENDING',
    }],
  });

  return record;
}

/**
 * Dummy/Mock OCR processing for the receipt image.
 * In a real implementation, this would invoke AWS Textract via BullMQ queue.
 *
 * Writes OCR data to PaymentVerification record AND keeps a denormalized
 * summary on Payment.proofDocument.ocrData for backward compat.
 */
async function processOcr(paymentId, fileUrl) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);

  // Find or create verification record
  let verification = await PaymentVerification.findOne({ paymentId });
  if (!verification) {
    verification = await createVerificationRecord(paymentId, {
      bookingId: payment.bookingId || null,
      userId: payment.userId,
    });
  }

  // Mock extraction (replace with AWS Textract in production)
  const mockExtractedUtr = 'UTR' + Math.floor(Math.random() * 100000000);
  const mockExtractedAmount = payment.amount || 0;

  const ocrData = {
    extractedUtr: mockExtractedUtr,
    extractedAmount: mockExtractedAmount,
    extractedDate: new Date(),
    confidenceScore: 92.5,
    processedAt: new Date(),
    rawText: 'Mock raw text from OCR...',
    provider: 'TEXTRACT',
  };

  // Write to PaymentVerification (primary source of truth)
  verification.ocrData = ocrData;
  verification.actionHistory.push({
    action: 'OCR_COMPLETE',
    actor: { id: 'SYSTEM', role: 'SYSTEM' },
    timestamp: new Date(),
    detail: `OCR processed with confidence ${ocrData.confidenceScore}%`,
  });
  await verification.save();

  // Denormalize onto Payment for backward compat
  payment.proofDocument = payment.proofDocument || {};
  payment.proofDocument.ocrData = {
    extractedUtr: ocrData.extractedUtr,
    extractedAmount: ocrData.extractedAmount,
    extractedDate: ocrData.extractedDate,
    confidenceScore: ocrData.confidenceScore,
    processedAt: ocrData.processedAt,
    rawText: ocrData.rawText,
  };
  payment.proofDocument.verificationStatus = 'COMPLETED';
  await payment.save();

  return ocrData;
}

/**
 * Hashes UTR, Amount, and Date to detect duplicates cleanly.
 * Checks both the PaymentVerification collection and the legacy
 * Payment.duplicateCheck.utrHash field.
 */
async function checkDuplicateUtr(utr, amount, dateStr) {
  if (!utr) return { isDuplicate: false, utrHash: null };

  const hashInput = `${String(utr).trim().toLowerCase()}:${amount}:${dateStr}`;
  const utrHash = crypto.createHash('sha256').update(hashInput).digest('hex');

  // Check PaymentVerification collection first (new source of truth)
  const existingVerification = await PaymentVerification.findOne({
    'duplicateCheck.utrHash': utrHash,
  });

  if (existingVerification) {
    return {
      isDuplicate: true,
      utrHash,
      originalPaymentId: String(existingVerification.paymentId),
    };
  }

  // Fallback: check legacy Payment collection for pre-migration records
  const existingPayment = await Payment.findOne({
    'duplicateCheck.utrHash': utrHash,
  });

  if (existingPayment) {
    return {
      isDuplicate: true,
      utrHash,
      originalPaymentId: String(existingPayment._id),
    };
  }

  return { isDuplicate: false, utrHash, originalPaymentId: null };
}

/**
 * Calculates a Risk Score (0-100) based on PricingConfig rules.
 * Higher score = higher risk.
 *
 * Writes the score and flags to the PaymentVerification record.
 */
async function calculateRiskScore(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);

  let verification = await PaymentVerification.findOne({ paymentId });
  if (!verification) {
    verification = await createVerificationRecord(paymentId, {
      bookingId: payment.bookingId || null,
      userId: payment.userId,
    });
  }

  const { PricingConfig } = require('../models/PricingConfig');
  const cfg = await PricingConfig.findOne().sort({ createdAt: -1 });

  const weights = cfg?.riskScoring?.weights || {
    amountMismatch: 20,
    duplicateUtr: 50,
    imageQualityLow: 10,
    timeExpiry: 15,
    newUser: 5,
  };

  const thresholds = cfg?.riskScoring?.thresholds || {
    low: 25,
    medium: 50,
  };

  let riskScore = 0;
  const flags = [];

  // 1. Amount Mismatch
  const ocrData = verification.ocrData || payment.proofDocument?.ocrData;
  if (ocrData?.extractedAmount) {
    if (Math.abs(ocrData.extractedAmount - payment.amount) > 10) {
      riskScore += weights.amountMismatch;
      flags.push({
        type: 'AMOUNT_MISMATCH',
        severity: 'WARNING',
        detail: `OCR amount ${ocrData.extractedAmount} vs expected ${payment.amount}`,
        scoreImpact: weights.amountMismatch,
      });
    }
  }

  // 2. Duplicate Check
  if (verification.duplicateCheck?.isDuplicate || payment.duplicateCheck?.isDuplicate) {
    riskScore += weights.duplicateUtr;
    flags.push({
      type: 'DUPLICATE_UTR',
      severity: 'CRITICAL',
      detail: 'Duplicate UTR hash detected',
      scoreImpact: weights.duplicateUtr,
    });
  }

  // 3. Image confidence
  const confidence = ocrData?.confidenceScore ?? 100;
  if (confidence < 80) {
    riskScore += weights.imageQualityLow;
    flags.push({
      type: 'IMAGE_QUALITY_LOW',
      severity: 'INFO',
      detail: `OCR confidence ${confidence}% (below 80% threshold)`,
      scoreImpact: weights.imageQualityLow,
    });
  }

  // Cap at 100
  riskScore = Math.min(100, riskScore);
  const riskLevel = getRiskLevel(riskScore, thresholds);

  // Write to PaymentVerification record
  verification.riskScore = riskScore;
  verification.riskLevel = riskLevel;
  verification.flags = flags;
  verification.status = 'IN_QUEUE';
  verification.actionHistory.push({
    action: 'SCORED',
    actor: { id: 'SYSTEM', role: 'SYSTEM' },
    timestamp: new Date(),
    detail: `Risk score: ${riskScore} (${riskLevel})`,
    previousStatus: verification.status,
    newStatus: 'IN_QUEUE',
  });
  await verification.save();

  return { riskScore, riskLevel, flags };
}

/**
 * Maps the 0-100 risk score to a category.
 */
function getRiskLevel(score, thresholds = { low: 25, medium: 50 }) {
  if (score <= thresholds.low) return 'LOW';
  if (score <= thresholds.medium) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Returns the admin verification queue — queries PaymentVerification
 * collection with optional risk and status filters.
 */
async function getVerificationQueue({ status, riskLevel, page = 1, limit = 20 } = {}) {
  const q = {};
  if (status) q.status = status;
  else q.status = { $in: ['IN_QUEUE', 'UNDER_REVIEW', 'ON_HOLD'] };
  if (riskLevel) q.riskLevel = riskLevel;

  const skip = (page - 1) * limit;
  const [records, total] = await Promise.all([
    PaymentVerification.find(q)
      .populate('paymentId', 'amount transactionId status type createdAt')
      .populate('userId', 'userId name email phone')
      .populate('bookingId', 'bookingId status')
      .sort({ riskScore: -1, createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PaymentVerification.countDocuments(q),
  ]);

  return {
    records,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Returns queue statistics from the PaymentVerification collection.
 */
async function getVerificationStats() {
  const stats = await PaymentVerification.aggregate([
    {
      $group: {
        _id: { status: '$status', riskLevel: '$riskLevel' },
        count: { $sum: 1 },
      },
    },
  ]);

  const result = { total: 0, byStatus: {}, byRisk: {} };
  stats.forEach((s) => {
    result.total += s.count;
    result.byStatus[s._id.status] = (result.byStatus[s._id.status] || 0) + s.count;
    result.byRisk[s._id.riskLevel] = (result.byRisk[s._id.riskLevel] || 0) + s.count;
  });

  return result;
}

module.exports = {
  createVerificationRecord,
  processOcr,
  checkDuplicateUtr,
  calculateRiskScore,
  getRiskLevel,
  getVerificationQueue,
  getVerificationStats,
};
