const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const PaymentOrder = require('../models/PaymentOrder');

const grantPaidEnrollment = async (paymentOrder, paymentId) => {
    if (paymentOrder.status !== 'captured') {
        paymentOrder.status = 'captured';
        paymentOrder.razorpayPaymentId = paymentId;
        await paymentOrder.save();
    }

    let enrollment = await Enrollment.findOne({ student: paymentOrder.student, course: paymentOrder.course });
    let changed = false;
    if (enrollment?.status === 'cancelled') {
        enrollment.status = 'active';
        enrollment.progress = 0;
        enrollment.completedAt = undefined;
        enrollment = await enrollment.save();
        changed = true;
    } else if (!enrollment) {
        try {
            enrollment = await Enrollment.create({ student: paymentOrder.student, course: paymentOrder.course });
            changed = true;
        } catch (error) {
            if (error.code !== 11000) throw error;
            enrollment = await Enrollment.findOne({ student: paymentOrder.student, course: paymentOrder.course });
        }
    }

    if (changed) await Course.updateOne({ _id: paymentOrder.course }, { $inc: { totalStudents: 1 } });
    if (!paymentOrder.enrollmentGranted) {
        paymentOrder.enrollmentGranted = true;
        await paymentOrder.save();
    }
    return enrollment;
};

module.exports = { grantPaidEnrollment, PaymentOrder };
