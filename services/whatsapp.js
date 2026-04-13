'use strict';

const twilio  = require('twilio');
const QRCode  = require('qrcode');

// Only initialize if credentials are present — safe to run without them (mock mode)
const client = (
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN  &&
  !process.env.TWILIO_ACCOUNT_SID.includes('XXXXXXXXXX')
) ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : null;

/**
 * Build the entry confirmation message body
 */
function buildMessage(guest) {
  return [
    `🎉 *${process.env.CLUB_NAME || 'VOIDCLUB'} — Entry Confirmed!*`,
    ``,
    `👤 Name: ${guest.name}`,
    `🎫 Token: *${guest.token}*`,
    `🏷 Type: ${guest.type_name}`,
    `👥 Party: ${guest.party} pax`,
    `💰 Paid: ₹${Number(guest.price_total).toLocaleString('en-IN')}`,
    `🕐 Valid: ${process.env.DOORS_OPEN || '21:00'}–${process.env.DOORS_CLOSE || '03:00'} tonight`,
    ``,
    `_Show this token at entrance. Photo ID required._`
  ].join('\n');
}

/**
 * Generate QR code as base64 PNG data URL (for display on screen)
 * Production upgrade: upload to Supabase Storage → send image URL via Twilio mediaUrl
 */
async function generateQRDataURL(tokenData) {
  return QRCode.toDataURL(JSON.stringify(tokenData), {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
    errorCorrectionLevel: 'H'
  });
}

/**
 * Send entry pass to guest via WhatsApp
 * Returns { success, mock, messageId?, error? }
 * NEVER throws — WhatsApp failure must not block check-in
 */
async function sendEntryPass(guest) {
  const to   = `whatsapp:+91${guest.wa}`;
  const body = buildMessage(guest);

  if (!client) {
    console.log(`[WhatsApp MOCK] → +91${guest.wa}`);
    console.log(`[WhatsApp MOCK] Message:\n${body}`);
    return { success: true, mock: true };
  }

  try {
    const msg = await client.messages.create({
      from: process.env.TWILIO_WA_FROM || 'whatsapp:+14155238886',
      to,
      body
      // Production upgrade: uncomment when QR image is hosted on Supabase Storage
      // mediaUrl: [`https://[project].supabase.co/storage/v1/object/public/qrcodes/${guest.token}.png`]
    });

    console.log(`[WhatsApp] ✓ Sent to +91${guest.wa} — SID: ${msg.sid}`);
    return { success: true, mock: false, messageId: msg.sid };

  } catch (err) {
    // Log but do not throw — check-in must succeed even if WA fails
    console.error(`[WhatsApp] ✗ Failed for +91${guest.wa}: ${err.message}`);
    return { success: false, mock: false, error: err.message };
  }
}

/**
 * Resend entry pass (called from /api/guests/resend/:token)
 */
async function resendEntryPass(guest) {
  return sendEntryPass(guest);
}

module.exports = { sendEntryPass, resendEntryPass, generateQRDataURL };
