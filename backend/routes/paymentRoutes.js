const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const { PaymentOrder, grantPaidEnrollment } = require('../utils/paymentEnrollment');

const router = express.Router();
const razorpayConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const razorpayAuth = () => `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;

router.post('/courses/:courseId/order', protect, async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, error: 'Only students can purchase a course' });
        if (!mongoose.isValidObjectId(req.params.courseId)) return res.status(404).json({ success: false, error: 'Course not found' });
        if (!razorpayConfigured()) return res.status(503).json({ success: false, error: 'Payments are not configured yet. Contact the course administrator.' });

        const course = await Course.findOne({ _id: req.params.courseId, status: 'published' }).select('title price currency');
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        if (!(course.price > 0)) return res.status(400).json({ success: false, error: 'This course is free. Use free enrollment instead.' });
        const existing = await Enrollment.findOne({ student: req.user.id, course: course._id, status: { $in: ['active', 'completed'] } });
        if (existing) return res.status(409).json({ success: false, error: 'You are already enrolled in this course' });

        const amount = Math.round(course.price * 100);
        if (!Number.isSafeInteger(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'Course price must be a valid INR amount' });
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 12000);
        let providerResponse;
        try {
            providerResponse = await fetch('https://api.razorpay.com/v1/orders', {
                method: 'POST',
                headers: { Authorization: razorpayAuth(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, currency: 'INR', receipt: `nyc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, notes: { courseId: String(course._id), studentId: String(req.user.id) } }),
                signal: abort.signal
            });
        } finally { clearTimeout(timeout); }
        if (!providerResponse.ok) {
            console.error('Razorpay order creation failed:', providerResponse.status);
            return res.status(502).json({ success: false, error: 'Unable to start checkout. Please try again.' });
        }
        const order = await providerResponse.json();
        if (!order.id || order.amount !== amount || order.currency !== 'INR') return res.status(502).json({ success: false, error: 'Payment provider returned an invalid order' });
        await PaymentOrder.create({ student: req.user.id, course: course._id, razorpayOrderId: order.id, amount, currency: 'INR' });
        res.status(201).json({ success: true, data: { orderId: order.id, amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, courseName: course.title } });
    } catch (error) {
        console.error('Payment order error:', error.message);
        res.status(500).json({ success: false, error: 'Unable to start checkout. Please try again.' });
    }
});

router.post('/verify', protect, async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, error: 'Only students can purchase a course' });
        const { orderId, paymentId, signature } = req.body || {};
        if (![orderId, paymentId, signature].every((value) => typeof value === 'string' && value.length > 0)) return res.status(400).json({ success: false, error: 'Payment confirmation is incomplete' });
        const record = await PaymentOrder.findOne({ razorpayOrderId: orderId, student: req.user.id });
        if (!record) return res.status(404).json({ success: false, error: 'Payment order not found' });
        if (record.status === 'captured' && record.razorpayPaymentId === paymentId) {
            const enrollment = await grantPaidEnrollment(record, paymentId);
            if (enrollment.status === 'cancelled') return res.status(403).json({ success: false, error: 'This enrollment was revoked by an administrator. Contact the course administrator about your access.' });
            return res.json({ success: true, data: { enrollment, status: 'captured' } });
        }
        if (!razorpayConfigured()) return res.status(503).json({ success: false, error: 'Payments are not configured yet.' });

        const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${record.razorpayOrderId}|${paymentId}`).digest();
        if (!/^[a-f0-9]{64}$/i.test(signature)) return res.status(400).json({ success: false, error: 'Payment verification failed' });
        const supplied = Buffer.from(signature, 'hex');
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) return res.status(400).json({ success: false, error: 'Payment verification failed' });

        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 12000);
        let paymentResponse;
        try {
            paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: razorpayAuth() }, signal: abort.signal });
        } finally { clearTimeout(timeout); }
        if (!paymentResponse.ok) return res.status(502).json({ success: false, error: 'Payment status could not be confirmed yet. Please retry.' });
        const payment = await paymentResponse.json();
        if (payment.order_id !== record.razorpayOrderId || payment.amount !== record.amount || payment.currency !== record.currency) return res.status(400).json({ success: false, error: 'Payment details do not match this course' });
        if (!payment.captured || payment.status !== 'captured') return res.status(202).json({ success: true, data: { status: 'processing' }, message: 'Payment is processing. Access will be enabled once it is captured.' });

        const enrollment = await grantPaidEnrollment(record, payment.id);
        if (enrollment.status === 'cancelled') return res.status(403).json({ success: false, error: 'This enrollment was revoked by an administrator. Contact the course administrator about your access.' });
        res.json({ success: true, data: { enrollment, status: 'captured' } });
    } catch (error) {
        console.error('Payment verification error:', error.message);
        res.status(500).json({ success: false, error: 'Unable to confirm payment yet. Please retry.' });
    }
});

const handleWebhook = async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const signature = req.get('x-razorpay-signature') || '';
        if (!secret || !Buffer.isBuffer(req.body) || !/^[a-f0-9]{64}$/i.test(signature)) return res.sendStatus(400);
        const expected = crypto.createHmac('sha256', secret).update(req.body).digest();
        const supplied = Buffer.from(signature, 'hex');
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) return res.sendStatus(400);
        const event = JSON.parse(req.body.toString('utf8'));
        if (event.event !== 'payment.captured') return res.sendStatus(200);
        const payment = event.payload?.payment?.entity;
        if (!payment?.order_id || !payment.id) return res.sendStatus(400);
        const record = await PaymentOrder.findOne({ razorpayOrderId: payment.order_id });
        if (!record) return res.sendStatus(200);
        if (payment.amount !== record.amount || payment.currency !== record.currency) return res.sendStatus(400);
        await grantPaidEnrollment(record, payment.id);
        return res.sendStatus(200);
    } catch (error) {
        console.error('Payment webhook error:', error.message);
        return res.sendStatus(500);
    }
};

module.exports = { router, handleWebhook };
