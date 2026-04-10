'use strict';

const PDFDocument = require('pdfkit');

// ── Brand Colors ─────────────────────────────────────────────────────────────
const BRAND_GREEN = '#1F3A2D';
const BRAND_GOLD  = '#D8B56A';

/**
 * Generate a payment or deposit receipt PDF as a Buffer.
 *
 * @param {object} opts
 * @param {string} opts.receiptType - 'payment' | 'deposit'
 * @param {object} opts.user - { name, email, phone, userId }
 * @param {object} opts.payment - Payment or RoomHold document (lean object)
 * @param {string} [opts.roomTypeName] - Room type display name
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateReceiptPdf({ receiptType, user, payment, roomTypeName }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 100; // 50 margin each side

      // ── Header ──────────────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 80).fill(BRAND_GREEN);
      doc.fontSize(22).fillColor('#FFFFFF').text('Viramah Stay', 50, 25, { align: 'center' });
      doc.fontSize(8).fillColor(BRAND_GOLD).text('PREMIUM STUDENT LIVING', 50, 52, { align: 'center', characterSpacing: 3 });

      // Gold line
      doc.rect(0, 80, doc.page.width, 3).fill(BRAND_GOLD);

      // ── Title ───────────────────────────────────────────────────────────
      const title = receiptType === 'deposit' ? 'DEPOSIT RECEIPT' : 'PAYMENT RECEIPT';
      doc.moveDown(2);
      doc.fontSize(16).fillColor(BRAND_GREEN).text(title, { align: 'center' });
      doc.moveDown(0.5);

      // Date
      const dateStr = new Date().toLocaleDateString('en-IN', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
      doc.fontSize(10).fillColor('#666666').text(`Date: ${dateStr}`, { align: 'center' });
      doc.moveDown(1.5);

      // ── User Details ────────────────────────────────────────────────────
      doc.fontSize(10).fillColor(BRAND_GOLD).text('USER DETAILS', 50);
      doc.moveDown(0.3);
      doc.rect(50, doc.y, pageWidth, 1).fill(BRAND_GOLD);
      doc.moveDown(0.5);

      const userDetails = [
        ['Name', user.name || 'N/A'],
        ['User ID', user.userId || 'N/A'],
        ['Email', user.email || 'N/A'],
        ['Phone', user.phone || 'N/A'],
      ];
      if (roomTypeName) userDetails.push(['Room Type', roomTypeName]);

      userDetails.forEach(([label, value]) => {
        const yPos = doc.y;
        doc.fontSize(10).fillColor('#666666').text(label, 50, yPos, { width: 120 });
        doc.fontSize(10).fillColor('#1a1a1a').text(`:  ${value}`, 170, yPos);
        doc.moveDown(0.2);
      });

      doc.moveDown(1.5);

      // ── Payment/Deposit Details ─────────────────────────────────────────
      if (receiptType === 'payment' && payment.breakdown) {
        doc.fontSize(10).fillColor(BRAND_GOLD).text('PAYMENT BREAKDOWN', 50);
        doc.moveDown(0.3);
        doc.rect(50, doc.y, pageWidth, 1).fill(BRAND_GOLD);
        doc.moveDown(0.5);

        const b = payment.breakdown;
        const lines = [];

        lines.push(['Payment ID', payment.paymentId || 'N/A']);
        lines.push(['Payment Mode', payment.paymentMode === 'full' ? 'Full Payment (40% Discount)' : 'Split Payment (25% Discount)']);
        if (payment.installmentNumber) lines.push(['Installment', `${payment.installmentNumber} of ${payment.paymentMode === 'half' ? 2 : 1}`]);
        lines.push(['---', '---']);
        if (b.roomMonthly) lines.push(['Room Rent (Monthly)', `Rs. ${b.roomMonthly.toLocaleString('en-IN')}`]);
        if (b.discountRate) lines.push(['Discount Applied', `${(b.discountRate * 100).toFixed(0)}%`]);
        if (b.discountedMonthlyBase) lines.push(['Discounted Monthly', `Rs. ${b.discountedMonthlyBase.toLocaleString('en-IN')}`]);
        if (b.monthlyGST) lines.push(['GST (12%)', `Rs. ${b.monthlyGST.toLocaleString('en-IN')}`]);
        if (b.installmentMonths) lines.push(['Months Covered', `${b.installmentMonths}`]);
        if (b.roomRentTotal) lines.push(['Room Rent Total', `Rs. ${b.roomRentTotal.toLocaleString('en-IN')}`]);
        lines.push(['---', '---']);
        if (b.registrationFee) lines.push(['Registration Fee', `Rs. ${b.registrationFee.toLocaleString('en-IN')}`]);
        if (b.securityDeposit) lines.push(['Security Deposit', `Rs. ${b.securityDeposit.toLocaleString('en-IN')}`]);
        if (b.transportTotal) lines.push(['Transport', `Rs. ${b.transportTotal.toLocaleString('en-IN')}`]);
        if (b.messTotal) lines.push(['Mess', `Rs. ${b.messTotal.toLocaleString('en-IN')}${b.messIsLumpSum ? ' (Lump Sum)' : ''}`]);
        if (b.referralDeduction) lines.push(['Referral Deduction', `- Rs. ${b.referralDeduction.toLocaleString('en-IN')}`]);
        if (b.depositCredited) lines.push(['Deposit Credited', `- Rs. ${b.depositCredited.toLocaleString('en-IN')}`]);
        lines.push(['---', '---']);
        lines.push(['TOTAL AMOUNT', `Rs. ${(b.finalAmount || payment.amount).toLocaleString('en-IN')}`]);

        lines.forEach(([label, value]) => {
          if (label === '---') {
            doc.moveDown(0.3);
            doc.rect(50, doc.y, pageWidth, 0.5).fill('#ddd');
            doc.moveDown(0.5);
            return;
          }
          const isBold = label === 'TOTAL AMOUNT';
          const yPos = doc.y;
          doc.fontSize(isBold ? 11 : 10)
            .fillColor(isBold ? BRAND_GREEN : '#666666')
            .text(label, 50, yPos, { width: 200 });
          doc.fontSize(isBold ? 11 : 10)
            .fillColor(isBold ? BRAND_GREEN : '#1a1a1a')
            .font(isBold ? 'Helvetica-Bold' : 'Helvetica')
            .text(value, 260, yPos);
          doc.font('Helvetica');
          doc.moveDown(0.2);
        });

      } else if (receiptType === 'deposit') {
        doc.fontSize(10).fillColor(BRAND_GOLD).text('DEPOSIT DETAILS', 50);
        doc.moveDown(0.3);
        doc.rect(50, doc.y, pageWidth, 1).fill(BRAND_GOLD);
        doc.moveDown(0.5);

        const depositLines = [
          ['Security Deposit', `Rs. ${(payment.depositAmount || 15000).toLocaleString('en-IN')}`],
          ['Registration Fee', `Rs. ${(payment.registrationFeePaid || 0).toLocaleString('en-IN')}`],
          ['Payment Mode Selected', payment.paymentMode === 'full' ? 'Full Payment' : payment.paymentMode === 'half' ? 'Split Payment' : 'Deposit Only'],
          ['---', '---'],
          ['TOTAL PAID', `Rs. ${(payment.totalPaidAtDeposit || payment.depositAmount || 15000).toLocaleString('en-IN')}`],
        ];

        depositLines.forEach(([label, value]) => {
          if (label === '---') {
            doc.moveDown(0.3);
            doc.rect(50, doc.y, pageWidth, 0.5).fill('#ddd');
            doc.moveDown(0.5);
            return;
          }
          const isBold = label === 'TOTAL PAID';
          const yPos = doc.y;
          doc.fontSize(isBold ? 11 : 10)
            .fillColor(isBold ? BRAND_GREEN : '#666666')
            .text(label, 50, yPos, { width: 200 });
          doc.fontSize(isBold ? 11 : 10)
            .fillColor(isBold ? BRAND_GREEN : '#1a1a1a')
            .font(isBold ? 'Helvetica-Bold' : 'Helvetica')
            .text(value, 260, yPos);
          doc.font('Helvetica');
          doc.moveDown(0.2);
        });
      }

      doc.moveDown(2);

      // ── GST & Compliance Details ─────────────────────────────────────────
      doc.fontSize(10).fillColor(BRAND_GOLD).text('TAX INVOICE DETAILS', 50);
      doc.moveDown(0.3);
      doc.rect(50, doc.y, pageWidth, 1).fill(BRAND_GOLD);
      doc.moveDown(0.5);

      const complianceLines = [
        ['GSTIN', process.env.BUSINESS_GSTIN || '09XXXXXXXXXX1ZX'],
        ['HSN / SAC Code', '996311 (Accommodation Services)'],
        ['Place of Supply', 'PROPERTY_LOCATION (Uttar Pradesh)'],
        ['Tax Component', 'CGST (9%) + SGST (9%)']
      ];

      complianceLines.forEach(([label, value]) => {
        const yPos = doc.y;
        doc.fontSize(9).fillColor('#666666').text(label, 50, yPos, { width: 120 });
        doc.fontSize(9).fillColor('#1a1a1a').text(`:  ${value}`, 170, yPos);
        doc.moveDown(0.2);
      });

      doc.moveDown(2);

      // ── Footer note ─────────────────────────────────────────────────────
      doc.rect(50, doc.y, pageWidth, 1).fill('#ddd');
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#888888').text(
        'This is a computer-generated receipt and does not require a signature.',
        50, doc.y, { align: 'center' }
      );
      doc.moveDown(0.3);
      doc.text('Viramah Stay — Krishna Valley, Vrindavan, UP, India', { align: 'center' });
      doc.moveDown(0.3);
      doc.text('team@viramahstay.com | viramahstay.com', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateReceiptPdf };
