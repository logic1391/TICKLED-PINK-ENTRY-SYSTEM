const express = require('express');
const razorpay = require('../services/razorpay');
const db = require('../db/database');

const router = express.Router();

/**
 * POST /api/payments/create-order
 * Public — create a Razorpay order
 * Body: { amount, ticketType, party, name }
 */
router.post('/create-order', async (req, res) => {
  try {
    const { amount, ticketType, party, name } = req.body;

    if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid amount' });

    const receipt = `vc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const order = await razorpay.createOrder(amount, receipt, {
      ticketType,
      party: String(party),
      name
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      keyId: razorpay.getKeyId(),
      mock: order.mock || false
    });
  } catch (e) {
    console.error('[PAYMENTS]', e);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

/**
 * POST /api/payments/verify
 * Public — verify Razorpay payment signature
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // For mock orders, always pass
    if (razorpay_order_id && razorpay_order_id.startsWith('order_mock_')) {
      await db.logAction('payment_mock', `Mock payment for order ${razorpay_order_id}`, null, req.ip);
      return res.json({ verified: true, mock: true });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const isValid = razorpay.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);

    if (!isValid) {
      await db.logAction('payment_failed', `Signature mismatch: ${razorpay_order_id}`, null, req.ip);
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    await db.logAction('payment_verified', `${razorpay_payment_id} for ${razorpay_order_id}`, null, req.ip);
    res.json({ verified: true, paymentId: razorpay_payment_id });
  } catch (e) {
    console.error('[VERIFY]', e);
    res.status(500).json({ error: 'Verification error' });
  }
});

/**
 * POST /api/payments/webhook
 * Razorpay webhook — backup verification
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = typeof req.body === 'string' ? req.body : req.body.toString();

    if (!razorpay.verifyWebhookSignature(body, signature)) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(body);
    console.log('[WEBHOOK]', event.event, event.payload?.payment?.entity?.id);

    await db.logAction('webhook', `${event.event}: ${event.payload?.payment?.entity?.id || 'unknown'}`, null, req.ip);

    res.json({ status: 'ok' });
  } catch (e) {
    console.error('[WEBHOOK]', e);
    res.status(500).json({ error: 'Webhook error' });
  }
});

module.exports = router;
