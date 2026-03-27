const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const transactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: [true, 'Transaction type is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: 0,
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['completed', 'pending', 'failed'],
      default: 'completed',
    },


    /** Which installment triggered this transaction (1 or 2). Null for legacy records. */
    installmentNumber: { type: Number, default: null },


  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Auto-generate transactionId before saving (collision-free)
transactionSchema.pre('save', function () {
  if (!this.transactionId) {
    this.transactionId = `TXN-${uuidv4().split('-')[0].toUpperCase()}`;
  }
});

module.exports = mongoose.model('Transaction', transactionSchema);
