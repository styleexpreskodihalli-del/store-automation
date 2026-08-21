const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function safeEqual(a, b) {
  if (
    typeof a !== 'string' ||
    typeof b !== 'string' ||
    a.length !== b.length
  ) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }

      if (!RAZORPAY_KEY_SECRET) {
        return json({
          error: 'Payment verification is not configured'
        }, 500);
      }

      const body = await request.json().catch(() => null);

      if (!body) {
        return json({
          error: 'Invalid request body'
        }, 400);
      }

      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      } = body;

      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature
      ) {
        return json({
          error: 'Payment verification details are required'
        }, 400);
      }

      const payload =
        `${razorpay_order_id}|${razorpay_payment_id}`;

      const expectedSignature =
        await hmacSha256Hex(
          RAZORPAY_KEY_SECRET,
          payload
        );

      if (
        !safeEqual(
          expectedSignature,
          razorpay_signature
        )
      ) {
        return json({
          success: false,
          verified: false,
          error: 'Payment verification failed'
        }, 400);
      }

      return json({
        success: true,
        verified: true,
        product: 'STall - Store Automation',
        plan: 'listing_99',
        razorpay_order_id,
        razorpay_payment_id
      });

    } catch (error) {
      console.error(
        'Razorpay payment verification error:',
        error
      );

      return json({
        error: 'Unable to verify payment'
      }, 500);
    }
  }
};
