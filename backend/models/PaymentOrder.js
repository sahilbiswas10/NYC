const mongoose = require('mongoose');

const PaymentOrderSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, unique: true, sparse: true },
    amount: { type: Number, required: true }, // INR paise, as sent to Razorpay
    currency: { type: String, enum: ['INR'], default: 'INR' },
    status: { type: String, enum: ['created', 'captured', 'failed'], default: 'created' },
    enrollmentGranted: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('PaymentOrder', PaymentOrderSchema);
