'use strict';

const pdfService = require('../../services/pdf-service');
const Payment = require('../../models/Payment');

/**
 * GET /api/v1/receipts/:paymentId.pdf
 * Stream a receipt PDF for a verified payment owned by the authenticated user.
 */
async function downloadReceipt(req, res, next) {
  try {
    const payment = await Payment.findById(req.params.paymentId).populate('userId', 'name email phone userId');
    if (!payment) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Payment not found' } });
    }

    // Owner check — identical response shape for 403 and 404 to avoid existence oracle
    if (String(payment.userId?._id || payment.userId) !== String(req.user._id)) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Payment not found' } });
    }

    // Only generate receipt for verified/approved payments
    const allowedStatuses = ['APPROVED', 'VERIFIED', 'approved', 'verified'];
    if (!allowedStatuses.includes(payment.status)) {
      return res.status(409).json({
        success: false,
        error: { code: 'RECEIPT_NOT_AVAILABLE', message: 'Payment not yet verified' },
      });
    }

    const user = payment.userId; // populated
    const buffer = await pdfService.generateReceiptPdf({
      receiptType: 'payment',
      user: {
        name: user.name || 'N/A',
        email: user.email || 'N/A',
        phone: user.phone || 'N/A',
        userId: user.userId || 'N/A',
      },
      payment: payment.toObject ? payment.toObject() : payment,
      roomTypeName: payment.roomTypeName || null,
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="viramah-receipt-${payment._id}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  } catch (e) {
    next(e);
  }
}

module.exports = { downloadReceipt };
