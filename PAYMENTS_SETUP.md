# Paid course checkout

Paid courses use Razorpay Checkout in INR. The server creates every Razorpay order, checks the signed checkout response, confirms the payment status with Razorpay, and enrolls the student only after capture.

Add these values to the server's ignored `.env` file. Use Razorpay test-mode credentials while testing:

```env
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

In Razorpay's dashboard, add a webhook pointing to `https://your-site.example/api/payments/webhook` and enable the `payment.captured` event. The webhook secret must match `RAZORPAY_WEBHOOK_SECRET`. Keep both secrets server-side; the browser receives only the public Key ID.

Without the Key ID and Key Secret, the paid-course button reports that checkout is not configured. Free courses continue to use the existing enrollment flow.
