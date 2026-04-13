/**
 * Razorpay integration
 * Creates orders and verifies payment signatures.
 * Falls back to mock mode if credentials are not configured.
 */

const crypto = require('crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

let razorpayInstance = null;

function isConfigured() {
  return KEY_ID && !KEY_ID.includes('XXXXXXXXXX') &&
         KEY_SECRET && KEY_SECRET !== 'your_razorpay_secret_here';
}

function getInstance() {
  if (!razorpayInstance && isConfigured()) {
    const Razorpay = require('razorpay');
    razorpayInstance = new Razorpay({
      key_id: KEY_ID,
      key_secret: KEY_SECRET
    });
  }
  return razorpayInstance;
}

async function createOrder(amount, receipt, notes) {
  if (!isConfigured()) {
    // Mock order for dev mode
    const mockId = 'order_mock_' + Date.now();
    console.log(`[RAZORPAY-MOCK] Created order ${mockId} for ₹${amount}`);
    return {
      id: mockId,
      amount: amount * 100, // paise
      currency: 'INR',
      receipt,
      status: 'created',
      mock: true
    };
  }

  const instance = getInstance();
  const order = await instance.orders.create({
    amount: amount * 100, // Razorpay uses paise
    currency: 'INR',
    receipt,
    notes: notes || {}
  });
  return order;
}

function verifySignature(orderId, paymentId, signature) {
  if (!isConfigured()) {
    // Mock verification always passes in dev
    console.log('[RAZORPAY-MOCK] Payment verified (mock)');
    return true;
  }

  const body = orderId + '|' + paymentId;
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(body)
    .digest('hex');

  return expected === signature;
}

function verifyWebhookSignature(body, signature) {
  if (!isConfigured()) return true;

  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(body)
    .digest('hex');

  return expected === signature;
}

function getKeyId() {
  return KEY_ID;
}

module.exports = {
  isConfigured,
  createOrder,
  verifySignature,
  verifyWebhookSignature,
  getKeyId
};
