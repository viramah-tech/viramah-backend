const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const paymentSchema = new mongoose.Schema(
  {
    paymentId: {
      type: String,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
    transactionId: { type: String, trim: true, default: '' },
    receiptUrl: { type: String, trim: true, default: '' },
    verificationNotes: { type: String, trim: true, default: '' },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Auto-generate paymentId before saving (collision-free)
paymentSchema.pre('save', function () {
  if (!this.paymentId) {
    this.paymentId = `PAY-${uuidv4().split('-')[0].toUpperCase()}`;
  }
});

module.exports = mongoose.model('Payment', paymentSchema);
