'use strict';

const crypto = require('crypto');
const Payment = require('../models/Payment');
// Mocking AWS Textract for now, since setting it up requires infra.
// If needed, we abstract this behind an SQS queue or actual SDK call.

/**
 * paymentVerificationService.js — Handles OCR, duplicate detection, and risk scoring.
 */

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Dummy/Mock OCR processing for the receipt image.
 * In a real implementation, this would invoke AWS Textract.
 */
async function processOcr(paymentId, fileUrl) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);

  // Mock extraction
  const mockExtractedUtr = 'UTR' + Math.floor(Math.random() * 100000000);
  const mockExtractedAmount = payment.amount || 0;

  payment.proofDocument = payment.proofDocument || {};
  payment.proofDocument.ocrData = {
    extractedUtr: mockExtractedUtr,
    extractedAmount: mockExtractedAmount,
    extractedDate: new Date(),
    confidenceScore: 92.5,
    processedAt: new Date(),
    rawText: 'Mock raw text from OCR...'
  };
  payment.proofDocument.verificationStatus = 'COMPLETED';

  await payment.save();
  return payment.proofDocument.ocrData;
}

/**
 * Hashes UTR, Amount, and Date to detect duplicates cleanly.
 */
async function checkDuplicateUtr(utr, amount, dateStr) {
  if (!utr) return { isDuplicate: false, utrHash: null };

  const hashId = `${String(utr).trim().toLowerCase()}:${amount}:${dateStr}`;
  const utrHash = crypto.createHash('sha256').update(hashId).digest('hex');

  const existing = await Payment.findOne({ 'duplicateCheck.utrHash': utrHash });
  
  if (existing) {
    return {
      isDuplicate: true,
      utrHash,
      originalPaymentId: String(existing._id)
    };
  }

  return { isDuplicate: false, utrHash, originalPaymentId: null };
}

/**
 * Calculates a Risk Score (0-100) based on PricingConfig rules.
 * Higher score = higher risk.
 */
async function calculateRiskScore(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);

  const PricingConfig = require('../models/PricingConfig');
  const cfg = await PricingConfig.findOne().sort({ createdAt: -1 });

  const weights = cfg?.riskScoring?.weights || {
    amountMismatch: 20,
    duplicateUtr: 50,
    imageQualityLow: 10,
    timeExpiry: 15,
    newUser: 5
  };

  let riskScore = 0;

  // 1. Amount Mismatch
  if (payment.proofDocument?.ocrData?.extractedAmount) {
    if (Math.abs(payment.proofDocument.ocrData.extractedAmount - payment.amount) > 10) {
      riskScore += weights.amountMismatch;
    }
  }

  // 2. Duplicate Check
  if (payment.duplicateCheck?.isDuplicate) {
    riskScore += weights.duplicateUtr;
  }

  // 3. Image confidence
  if (payment.proofDocument?.ocrData?.confidenceScore < 80) {
    riskScore += weights.imageQualityLow;
  }

  // Return max 100
  return Math.min(100, riskScore);
}

/**
 * Maps the 0-100 risk score to a category.
 */
function getRiskLevel(score, thresholds = { low: 25, medium: 50 }) {
  if (score <= thresholds.low) return 'LOW';
  if (score <= thresholds.medium) return 'MEDIUM';
  return 'HIGH';
}

module.exports = {
  processOcr,
  checkDuplicateUtr,
  calculateRiskScore,
  getRiskLevel
};
