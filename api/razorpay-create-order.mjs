const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET =
  process.env.RAZORPAY_KEY_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function basicAuth() {
  return `Basic ${Buffer.from(
    `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`
  ).toString('base64')}`;
}

async function supabaseRequest(path, options = {}) {
  return fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(options.headers || {})
      }
    }
  );
}

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({
          error: 'Method not allowed'
        }, 405);
      }

      if (
        !RAZORPAY_KEY_ID ||
        !RAZORPAY_KEY_SECRET
      ) {
        console.error(
          'Razorpay credentials are not configured'
        );

        return json({
          error: 'Payment service is not configured'
        }, 500);
      }

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY
      ) {
        console.error(
          'Supabase server credentials are not configured'
        );

        return json({
          error: 'Payment database is not configured'
        }, 500);
      }

      const body =
        await request.json().catch(() => null);

      if (!body) {
        return json({
          error: 'Invalid request body'
        }, 400);
      }

      const {
        customer_name,
        customer_email,
        customer_phone
      } = body;

      if (!customer_name?.trim()) {
        return json({
          error: 'Customer name is required'
        }, 400);
      }

      if (!customer_email?.trim()) {
        return json({
          error: 'Customer email is required'
        }, 400);
      }

      const name =
        customer_name.trim();

      const email =
        customer_email.trim().toLowerCase();

      const phone =
        customer_phone?.trim() || null;

      /*
       * STall Listing:
       * ₹99 one-time payment.
       *
       * Razorpay amount is expressed in paise.
       */
      const amount = 9900;

      const receipt =
        `STL_${Date.now()}`;

      /*
       * Step 1:
       * Create the Razorpay order.
       */
      const razorpayResponse =
        await fetch(
          'https://api.razorpay.com/v1/orders',
          {
            method: 'POST',
            headers: {
              Authorization: basicAuth(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              amount,
              currency: 'INR',
              receipt,
              notes: {
                product:
                  'STall - Store Automation',
                plan:
                  'listing_99',
                customer_name:
                  name,
                customer_email:
                  email,
                customer_phone:
                  phone || ''
              }
            })
          }
        );

      const order =
        await razorpayResponse
          .json()
          .catch(() => null);

      if (
        !razorpayResponse.ok ||
        !order?.id
      ) {
        console.error(
          'Razorpay order creation failed:',
          order
        );

        return json({
          error: 'Razorpay order creation failed',
          razorpay_error: order
        }, 502);
      }

      /*
       * Step 2:
       * Record the newly-created order.
       */
      const paymentRecord = {
        product:
          'STall - Store Automation',
        plan:
          'listing_99',
        amount,
        currency:
          'INR',
        customer_name:
          name,
        customer_email:
          email,
        customer_phone:
          phone,
        razorpay_order_id:
          order.id,
        payment_status:
          'created'
      };

      const paymentResponse =
        await supabaseRequest(
          '/rest/v1/stall_payments',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
              Prefer:
                'return=representation'
            },
            body:
              JSON.stringify(
                paymentRecord
              )
          }
        );

      const paymentRows =
        await paymentResponse
          .json()
          .catch(() => []);

      if (
        !paymentResponse.ok ||
        !Array.isArray(paymentRows) ||
        !paymentRows.length
      ) {
        console.error(
          'STall payment record creation failed:',
          paymentRows
        );

        /*
         * We deliberately do not expose the
         * database error to the customer.
         *
         * The Razorpay order exists, but our
         * internal ledger does not. The order
         * should not be presented for checkout
         * until this is resolved.
         */
        return json({
          error:
            'Unable to initialise payment'
        }, 500);
      }

      return json({
        success: true,
        key_id:
          RAZORPAY_KEY_ID,
        order_id:
          order.id,
        amount:
          order.amount,
        currency:
          order.currency,
        payment_record_id:
          paymentRows[0].id
      });

    } catch (error) {
      console.error(
        'Razorpay create-order error:',
        error
      );

      return json({
        error:
          'Unable to create payment order'
      }, 500);
    }
  }
};
