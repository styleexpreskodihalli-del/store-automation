const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const RAZORPAY_KEY_ID =
  process.env.RAZORPAY_KEY_ID;

const RAZORPAY_KEY_SECRET =
  process.env.RAZORPAY_KEY_SECRET;

const RAZORPAY_WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET;


// ============================================================
// CONFIGURATION
// ============================================================

const LISTING_AMOUNT =
  9900;

const LISTING_CURRENCY =
  "INR";

const LISTING_PLAN =
  "listing_99";

const PRODUCT_NAME =
  "STall - Store Automation";


// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  body,
  status = 200
) {

  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


// ============================================================
// SUPABASE
// ============================================================

async function supabaseFetch(
  path,
  options = {}
) {

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {

    throw new Error(
      "Supabase configuration is missing."
    );
  }


  return fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,

      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        ...(options.headers || {})
      }
    }
  );
}


// ============================================================
// RAZORPAY BASIC AUTH
// ============================================================

function razorpayBasicAuth() {

  if (
    !RAZORPAY_KEY_ID ||
    !RAZORPAY_KEY_SECRET
  ) {

    throw new Error(
      "Razorpay configuration is missing."
    );
  }


  return Buffer
    .from(
      `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`
    )
    .toString(
      "base64"
    );
}


// ============================================================
// HMAC SHA256 HEX
// ============================================================

async function hmacSha256Hex(
  secret,
  message
) {

  const encoder =
    new TextEncoder();


  const key =
    await crypto.subtle.importKey(
      "raw",

      encoder.encode(
        secret
      ),

      {
        name:
          "HMAC",

        hash:
          "SHA-256"
      },

      false,

      [
        "sign"
      ]
    );


  const signature =
    await crypto.subtle.sign(
      "HMAC",

      key,

      encoder.encode(
        message
      )
    );


  return Array
    .from(
      new Uint8Array(
        signature
      )
    )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0"
          )
    )
    .join("");
}


// ============================================================
// SAFE STRING COMPARISON
// ============================================================

function safeEqual(
  a,
  b
) {

  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    a.length !== b.length
  ) {

    return false;
  }


  let result =
    0;


  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }


  return result === 0;
}


// ============================================================
// READ JSON BODY
// ============================================================

async function readJson(
  request
) {

  return request
    .json()
    .catch(
      () => null
    );
}


// ============================================================
// RAZORPAY API REQUEST
// ============================================================

async function razorpayFetch(
  path,
  options = {}
) {

  const auth =
    razorpayBasicAuth();


  return fetch(
    `https://api.razorpay.com/v1${path}`,
    {
      ...options,

      headers: {
        Authorization:
          `Basic ${auth}`,

        "Content-Type":
          "application/json",

        ...(options.headers || {})
      }
    }
  );
}


// ============================================================
// LOAD ONBOARDING STATE
// ============================================================

async function getOnboardingState(
  onboardingId
) {

  if (!onboardingId) {

    return {
      ok: false,

      error:
        "onboarding_id is required"
    };
  }


  const response =
    await supabaseFetch(
      `/rest/v1/google_oauth_states` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}` +
      `&select=` +
      [
        "id",
        "onboarding_id",
        "customer_name",
        "customer_email",
        "customer_phone",
        "google_account_id",
        "google_account_email"
      ].join(",") +
      `&limit=1`
    );


  if (!response.ok) {

    const detail =
      await response.text();


    console.error(
      "Unable to load onboarding state",
      detail
    );


    return {
      ok: false,

      error:
        "Unable to load your Google connection",

      detail
    };
  }


  const states =
    await response.json();


  if (
    !Array.isArray(states) ||
    states.length === 0
  ) {

    return {
      ok: false,

      error:
        "Onboarding session not found. Please start the ₹99 listing process again."
    };
  }


  return {
    ok: true,

    state:
      states[0]
  };
}


// ============================================================
// BUSINESS NAME
// ============================================================

function getBusinessName(
  body,
  state
) {

  const business =
    body?.business;


  if (
    business &&
    typeof business ===
      "object"
  ) {

    const location =
      business.location ||
      {};


    return (
      location.title ||
      business.title ||
      location.name ||
      business.name ||
      state?.customer_name ||
      "STore Listing"
    );
  }


  return (
    body?.customer_name ||
    state?.customer_name ||
    "STore Listing"
  );
}


// ============================================================
// CUSTOMER DETAILS
// ============================================================

function getCustomerDetails(
  body,
  state
) {

  const email =
    state?.google_account_email ||
    state?.customer_email ||
    "";


  const phone =
    body?.customer_phone ||
    state?.customer_phone ||
    "";


  return {
    email,
    phone
  };
}


// ============================================================
// CREATE RAZORPAY ORDER
// ============================================================

async function createOrder(
  body
) {

  const onboardingId =
    body?.onboarding_id;


  if (!onboardingId) {

    return json(
      {
        success:
          false,

        error:
          "onboarding_id is required"
      },
      400
    );
  }


  const onboarding =
    await getOnboardingState(
      onboardingId
    );


  if (!onboarding.ok) {

    return json(
      {
        success:
          false,

        error:
          onboarding.error,

        detail:
          onboarding.detail ||
          null
      },
      onboarding.error?.includes(
        "not found"
      )
        ? 404
        : 500
    );
  }


  const state =
    onboarding.state;


  const businessName =
    getBusinessName(
      body,
      state
    );


  const customer =
    getCustomerDetails(
      body,
      state
    );


  console.log(
    "RAZORPAY CUSTOMER",
    JSON.stringify(
      {
        onboarding_id:
          onboardingId,

        business_name:
          businessName,

        google_account_email:
          state.google_account_email ||
          null,

        customer_email_available:
          !!customer.email,

        customer_phone_available:
          !!customer.phone
      }
    )
  );


  // ----------------------------------------------------------
  // PREVENT DUPLICATE ACTIVE PAYMENT
  // ----------------------------------------------------------

  const existing =
    await supabaseFetch(
      `/rest/v1/razorpay_payments` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}` +
      `&status=in.(created,authorized,captured,paid)` +
      `&select=` +
      [
        "id",
        "razorpay_order_id",
        "razorpay_payment_id",
        "amount",
        "currency",
        "status",
        "plan"
      ].join(",") +
      `&order=created_at.desc` +
      `&limit=1`
    );


  if (existing.ok) {

    const existingRows =
      await existing.json();


    if (
      Array.isArray(existingRows) &&
      existingRows.length
    ) {

      const existingPayment =
        existingRows[0];


      if (
        existingPayment.status ===
          "captured" ||
        existingPayment.status ===
          "paid"
      ) {

        return json(
          {
            success:
              true,

            already_paid:
              true,

            paid:
              true,

            order_id:
              existingPayment.razorpay_order_id,

            payment_id:
              existingPayment.razorpay_payment_id,

            amount:
              existingPayment.amount,

            currency:
              existingPayment.currency,

            plan:
              existingPayment.plan
          }
        );
      }
    }
  }


  // ----------------------------------------------------------
  // CREATE RAZORPAY ORDER
  // ----------------------------------------------------------

  const receipt =
    `stall_${Date.now()}_${crypto
      .randomBytes(4)
      .toString("hex")}`;


  const razorpayResponse =
    await razorpayFetch(
      "/orders",
      {
        method:
          "POST",

        body:
          JSON.stringify(
            {
              amount:
                LISTING_AMOUNT,

              currency:
                LISTING_CURRENCY,

              receipt,

              notes: {
                product:
                  PRODUCT_NAME,

                plan:
                  LISTING_PLAN,

                onboarding_id:
                  onboardingId,

                business_name:
                  businessName,

                customer_email:
                  customer.email,

                customer_phone:
                  customer.phone
              }
            }
          )
      }
    );


  const razorpayResult =
    await razorpayResponse
      .json()
      .catch(
        () => ({})
      );


  if (
    !razorpayResponse.ok
  ) {

    console.error(
      "Razorpay order creation failed",
      {
        status:
          razorpayResponse.status,

        response:
          razorpayResult
      }
    );


    return json(
      {
        success:
          false,

        error:
          razorpayResult?.error?.description ||
          razorpayResult?.error?.reason ||
          "Unable to create Razorpay order"
      },
      500
    );
  }


  // ----------------------------------------------------------
  // SAVE ORDER
  // ----------------------------------------------------------

  const paymentRow = {
    onboarding_id:
      onboardingId,

    razorpay_order_id:
      razorpayResult.id,

    razorpay_payment_id:
      null,

    razorpay_signature:
      null,

    amount:
      razorpayResult.amount,

    currency:
      razorpayResult.currency ||
      LISTING_CURRENCY,

    status:
      "created",

    plan:
      LISTING_PLAN,

    source:
      "checkout"
  };


  const saveResponse =
    await supabaseFetch(
      "/rest/v1/razorpay_payments",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "resolution=merge-duplicates,return=minimal"
        },

        body:
          JSON.stringify(
            paymentRow
          )
      }
    );


  if (
    !saveResponse.ok
  ) {

    const detail =
      await saveResponse.text();


    console.error(
      "Unable to save Razorpay order",
      detail
    );


    // Do not expose the order as successfully
    // initialised if our own ledger failed.
    return json(
      {
        success:
          false,

        error:
          "Unable to save payment order",

        detail
      },
      500
    );
  }


  console.log(
    "RAZORPAY ORDER CREATED",
    JSON.stringify(
      {
        order_id:
          razorpayResult.id,

        amount:
          razorpayResult.amount,

        currency:
          razorpayResult.currency,

        onboarding_id:
          onboardingId,

        business_name:
          businessName
      }
    )
  );


  return json(
    {
      success:
        true,

      key_id:
        RAZORPAY_KEY_ID,

      order_id:
        razorpayResult.id,

      amount:
        razorpayResult.amount,

      currency:
        razorpayResult.currency,

      receipt:
        razorpayResult.receipt,

      customer: {
        name:
          businessName,

        email:
          customer.email,

        phone:
          customer.phone
      },

      onboarding_id:
        onboardingId,

      plan:
        LISTING_PLAN
    }
  );
}


// ============================================================
// LOAD OUR PAYMENT RECORD
// ============================================================

async function getPaymentRecord(
  orderId
) {

  const response =
    await supabaseFetch(
      `/rest/v1/razorpay_payments` +
      `?razorpay_order_id=eq.${encodeURIComponent(
        orderId
      )}` +
      `&select=*` +
      `&limit=1`
    );


  if (!response.ok) {

    return {
      ok: false,

      error:
        await response.text()
    };
  }


  const rows =
    await response.json();


  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {

    return {
      ok: false,

      notFound:
        true
    };
  }


  return {
    ok: true,

    payment:
      rows[0]
  };
}


// ============================================================
// UPDATE PAYMENT RECORD
// ============================================================

async function updatePayment(
  orderId,
  values
) {

  const response =
    await supabaseFetch(
      `/rest/v1/razorpay_payments` +
      `?razorpay_order_id=eq.${encodeURIComponent(
        orderId
      )}`,
      {
        method:
          "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body:
          JSON.stringify(
            values
          )
      }
    );


  if (!response.ok) {

    console.error(
      "Unable to update Razorpay payment",
      await response.text()
    );
  }


  return response;
}


// ============================================================
// VERIFY CHECKOUT SIGNATURE
// ============================================================

async function verifyPayment(
  body
) {

  const {
    razorpay_order_id:
      orderId,

    razorpay_payment_id:
      paymentId,

    razorpay_signature:
      signature
  } = body || {};


  if (
    !orderId ||
    !paymentId ||
    !signature
  ) {

    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "Payment verification details are required"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // ENSURE ORDER EXISTS IN OUR SERVER LEDGER
  // ----------------------------------------------------------

  const recordResult =
    await getPaymentRecord(
      orderId
    );


  if (
    !recordResult.ok
  ) {

    if (
      recordResult.notFound
    ) {

      return json(
        {
          success:
            false,

          verified:
            false,

          error:
            "Razorpay order was not created by STall"
        },
        400
      );
    }


    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "Unable to verify payment record"
      },
      500
    );
  }


  const paymentRecord =
    recordResult.payment;


  // ----------------------------------------------------------
  // VERIFY HMAC
  // ----------------------------------------------------------

  const payload =
    `${orderId}|${paymentId}`;


  const expectedSignature =
    await hmacSha256Hex(
      RAZORPAY_KEY_SECRET,
      payload
    );


  if (
    !safeEqual(
      expectedSignature,
      signature
    )
  ) {

    console.error(
      "RAZORPAY SIGNATURE MISMATCH",
      {
        orderId,
        paymentId
      }
    );


    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "Payment verification failed"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // ASK RAZORPAY FOR THE REAL PAYMENT STATUS
  // ----------------------------------------------------------

  const paymentResponse =
    await razorpayFetch(
      `/payments/${encodeURIComponent(
        paymentId
      )}`,
      {
        method:
          "GET"
      }
    );


  const paymentData =
    await paymentResponse
      .json()
      .catch(
        () => ({})
      );


  if (
    !paymentResponse.ok
  ) {

    console.error(
      "Unable to retrieve Razorpay payment",
      {
        status:
          paymentResponse.status,

        response:
          paymentData
      }
    );


    return json(
      {
        success:
          false,

        verified:
          true,

        payment_verified:
          false,

        error:
          "Signature verified, but Razorpay payment status could not be confirmed"
      },
      502
    );
  }


  // ----------------------------------------------------------
  // ENSURE PAYMENT BELONGS TO OUR ORDER
  // ----------------------------------------------------------

  if (
    paymentData.order_id !==
      orderId
  ) {

    console.error(
      "Razorpay order/payment mismatch",
      {
        expectedOrder:
          orderId,

        paymentOrder:
          paymentData.order_id,

        paymentId
      }
    );


    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "Payment does not belong to the expected Razorpay order"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // AMOUNT CHECK
  // ----------------------------------------------------------

  if (
    Number(
      paymentData.amount
    ) !==
    Number(
      paymentRecord.amount
    )
  ) {

    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "Payment amount does not match the STall order"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // CAPTURED CHECK
  // ----------------------------------------------------------

  const captured =
    paymentData.status ===
      "captured";


  if (!captured) {

    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          paymentId,

        razorpay_signature:
          signature,

        status:
          paymentData.status ||
          "authorized"
      }
    );


    return json(
      {
        success:
          false,

        verified:
          true,

        payment_verified:
          true,

        captured:
          false,

        payment_status:
          paymentData.status,

        error:
          "Payment has not been captured yet"
      },
      402
    );
  }


  // ----------------------------------------------------------
  // PAYMENT IS GENUINE + CAPTURED
  // ----------------------------------------------------------

  await updatePayment(
    orderId,
    {
      razorpay_payment_id:
        paymentId,

      razorpay_signature:
        signature,

      status:
        "captured"
    }
  );


  // ----------------------------------------------------------
  // ACTIVATE LISTING
  // ----------------------------------------------------------

  const activation =
    await activateListing(
      paymentRecord,
      paymentData
    );


  if (!activation.ok) {

    console.error(
      "Payment captured but listing activation failed",
      activation.error
    );


    return json(
      {
        success:
          true,

        verified:
          true,

        payment_verified:
          true,

        captured:
          true,

        paid:
          true,

        activation:
          false,

        error:
          "Payment was successful but listing activation needs reconciliation",

        razorpay_order_id:
          orderId,

        razorpay_payment_id:
          paymentId
      },
      202
    );
  }


  await updatePayment(
    orderId,
    {
      status:
        "paid"
    }
  );


  return json(
    {
      success:
        true,

      verified:
        true,

      payment_verified:
        true,

      captured:
        true,

      paid:
        true,

      activated:
        true,

      product:
        PRODUCT_NAME,

      plan:
        LISTING_PLAN,

      razorpay_order_id:
        orderId,

      razorpay_payment_id:
        paymentId
    }
  );
}


// ============================================================
// RAZORPAY ORDER STATUS
// ============================================================

async function getOrderStatus(
  body
) {

  const orderId =
    body?.razorpay_order_id ||
    body?.order_id;


  if (!orderId) {

    return json(
      {
        success:
          false,

        error:
          "razorpay_order_id is required"
      },
      400
    );
  }


  const recordResult =
    await getPaymentRecord(
      orderId
    );


  if (
    !recordResult.ok
  ) {

    return json(
      {
        success:
          false,

        error:
          recordResult.notFound
            ? "Order not found"
            : "Unable to load order"
      },
      recordResult.notFound
        ? 404
        : 500
    );
  }


  const razorpayResponse =
    await razorpayFetch(
      `/orders/${encodeURIComponent(
        orderId
      )}`,
      {
        method:
          "GET"
      }
    );


  const razorpayOrder =
    await razorpayResponse
      .json()
      .catch(
        () => ({})
      );


  if (
    !razorpayResponse.ok
  ) {

    return json(
      {
        success:
          false,

        error:
          razorpayOrder?.error?.description ||
          "Unable to retrieve Razorpay order"
      },
      502
    );
  }


  return json(
    {
      success:
        true,

      order: {
        id:
          razorpayOrder.id,

        amount:
          razorpayOrder.amount,

        currency:
          razorpayOrder.currency,

        status:
          razorpayOrder.status,

        amount_paid:
          razorpayOrder.amount_paid,

        amount_due:
          razorpayOrder.amount_due
      },

      local: {
        status:
          recordResult.payment.status,

        plan:
          recordResult.payment.plan,

        onboarding_id:
          recordResult.payment.onboarding_id
      }
    }
  );
}


// ============================================================
// ACTIVATE LISTING
// ============================================================

async function activateListing(
  paymentRecord,
  paymentData
) {

  const onboardingId =
    paymentRecord?.onboarding_id;


  if (!onboardingId) {

    return {
      ok: false,

      error:
        "Payment record does not contain onboarding_id"
    };
  }


  // ----------------------------------------------------------
  // IMPORTANT
  //
  // This attempts to update the existing onboarding state
  // without inventing a new business table/schema.
  //
  // If your production database uses a different listing
  // status column, this section can be adapted after the
  // payment flow is confirmed.
  // ----------------------------------------------------------

  const response =
    await supabaseFetch(
      `/rest/v1/google_oauth_states` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}`,
      {
        method:
          "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body:
          JSON.stringify(
            {
              payment_status:
                "paid",

              payment_plan:
                LISTING_PLAN,

              razorpay_order_id:
                paymentRecord.razorpay_order_id,

              razorpay_payment_id:
                paymentData.id,

              listing_status:
                "active"
            }
          )
      }
    );


  if (!response.ok) {

    const detail =
      await response.text();


    console.error(
      "Listing activation update failed",
      detail
    );


    return {
      ok: false,

      error:
        detail
    };
  }


  return {
    ok: true
  };
}


// ============================================================
// WEBHOOK SIGNATURE
// ============================================================

async function verifyWebhookSignature(
  rawBody,
  signature
) {

  if (
    !RAZORPAY_WEBHOOK_SECRET ||
    !signature
  ) {

    return false;
  }


  const expected =
    await hmacSha256Hex(
      RAZORPAY_WEBHOOK_SECRET,
      rawBody
    );


  return safeEqual(
    expected,
    signature
  );
}


// ============================================================
// HANDLE WEBHOOK
// ============================================================

async function handleWebhook(
  request
) {

  if (
    !RAZORPAY_WEBHOOK_SECRET
  ) {

    return json(
      {
        success:
          false,

        error:
          "Razorpay webhook secret is not configured"
      },
      500
    );
  }


  const rawBody =
    await request.text();


  const signature =
    request.headers.get(
      "x-razorpay-signature"
    );


  const valid =
    await verifyWebhookSignature(
      rawBody,
      signature
    );


  if (!valid) {

    console.error(
      "Invalid Razorpay webhook signature"
    );


    return json(
      {
        success:
          false,

        error:
          "Invalid webhook signature"
      },
      400
    );
  }


  let event;


  try {

    event =
      JSON.parse(
        rawBody
      );

  } catch {

    return json(
      {
        success:
          false,

        error:
          "Invalid webhook JSON"
      },
      400
    );
  }


  console.log(
    "RAZORPAY WEBHOOK",
    JSON.stringify(
      {
        event:
          event?.event ||
          null
      }
    )
  );


  const eventName =
    event?.event;


  const paymentEntity =
    event?.payload?.payment?.entity ||
    null;


  const orderEntity =
    event?.payload?.order?.entity ||
    null;


  const orderId =
    paymentEntity?.order_id ||
    orderEntity?.id ||
    null;


  const paymentId =
    paymentEntity?.id ||
    null;


  if (!orderId) {

    return json(
      {
        success:
          true,

        received:
          true
      }
    );
  }


  const recordResult =
    await getPaymentRecord(
      orderId
    );


  if (
    !recordResult.ok
  ) {

    console.error(
      "Webhook order not found in STall",
      {
        orderId,
        event:
          eventName
      }
    );


    // Acknowledge the webhook so Razorpay
    // does not endlessly retry an event for an
    // order that is not in our ledger.
    return json(
      {
        success:
          true,

        received:
          true,

        reconciled:
          false,

        reason:
          "Order not found"
      }
    );
  }


  const paymentRecord =
    recordResult.payment;


  // ----------------------------------------------------------
  // PAYMENT CAPTURED / ORDER PAID
  // ----------------------------------------------------------

  if (
    eventName ===
      "payment.captured" ||
    eventName ===
      "order.paid"
  ) {

    const finalPaymentId =
      paymentId ||
      paymentRecord.razorpay_payment_id;


    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          finalPaymentId,

        status:
          "captured"
      }
    );


    if (
      finalPaymentId
    ) {

      const activation =
        await activateListing(
          paymentRecord,
          paymentEntity ||
            {
              id:
                finalPaymentId
            }
        );


      if (
        activation.ok
      ) {

        await updatePayment(
          orderId,
          {
            status:
              "paid"
          }
        );

      } else {

        console.error(
          "Webhook listing activation failed",
          activation.error
        );
      }
    }
  }


  // ----------------------------------------------------------
  // PAYMENT AUTHORIZED
  // ----------------------------------------------------------

  else if (
    eventName ===
      "payment.authorized"
  ) {

    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          paymentId,

        status:
          "authorized"
      }
    );
  }


  // ----------------------------------------------------------
  // PAYMENT FAILED
  // ----------------------------------------------------------

  else if (
    eventName ===
      "payment.failed"
  ) {

    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          paymentId,

        status:
          "failed"
      }
    );
  }


  return json(
    {
      success:
        true,

      received:
        true,

      event:
        eventName,

      order_id:
        orderId,

      payment_id:
        paymentId
    }
  );
}


// ============================================================
// MAIN REQUEST HANDLER
// ============================================================

export default {
  async fetch(
    request
  ) {

    try {

      // --------------------------------------------------------
      // ONLY POST
      // --------------------------------------------------------

      if (
        request.method !==
          "POST"
      ) {

        return json(
          {
            success:
              false,

            error:
              "Method not allowed"
          },
          405
        );
      }


      // --------------------------------------------------------
      // CONFIGURATION
      // --------------------------------------------------------

      if (
        !RAZORPAY_KEY_ID ||
        !RAZORPAY_KEY_SECRET
      ) {

        return json(
          {
            success:
              false,

            error:
              "Razorpay is not configured"
          },
          500
        );
      }


      // --------------------------------------------------------
      // ROUTE
      // --------------------------------------------------------

      const url =
        new URL(
          request.url
        );


      const action =
        (
          url.searchParams.get(
            "action"
          ) ||
          "verify"
        ).toLowerCase();


      // --------------------------------------------------------
      // WEBHOOK
      // --------------------------------------------------------

      if (
        action ===
          "webhook"
      ) {

        return handleWebhook(
          request
        );
      }


      // --------------------------------------------------------
      // NORMAL JSON REQUEST
      // --------------------------------------------------------

      const body =
        await readJson(
          request
        );


      if (!body) {

        return json(
          {
            success:
              false,

            error:
              "Invalid request body"
          },
          400
        );
      }


      // --------------------------------------------------------
      // CREATE ORDER
      // --------------------------------------------------------

      if (
        action ===
          "create-order"
      ) {

        return createOrder(
          body
        );
      }


      // --------------------------------------------------------
      // VERIFY PAYMENT
      // --------------------------------------------------------

      if (
        action ===
          "verify"
      ) {

        return verifyPayment(
          body
        );
      }


      // --------------------------------------------------------
      // STATUS
      // --------------------------------------------------------

      if (
        action ===
          "status"
      ) {

        return getOrderStatus(
          body
        );
      }


      // --------------------------------------------------------
      // UNKNOWN ACTION
      // --------------------------------------------------------

      return json(
        {
          success:
            false,

          error:
            "Unknown Razorpay action",

          supported_actions: [
            "create-order",
            "verify",
            "status",
            "webhook"
          ]
        },
        400
      );

    } catch (
      error
    ) {

      console.error(
        "RAZORPAY ERROR",
        {
          name:
            error?.name ||
            null,

          message:
            error?.message ||
            String(error),

          stack:
            error?.stack ||
            null
        }
      );


      return json(
        {
          success:
            false,

          error:
            error?.message ||
            "Unable to process Razorpay request"
        },
        500
      );
    }
  }
};
// ============================================================
// CUSTOMER / BUSINESS HELPERS
// ============================================================

async function getBusinessForOnboarding(
  onboardingId
) {

  if (!onboardingId) {

    return {
      ok: false,

      error:
        "onboarding_id is required"
    };
  }


  const response =
    await supabaseFetch(
      `/rest/v1/businesses` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}` +
      `&select=*` +
      `&limit=1`
    );


  if (!response.ok) {

    const detail =
      await response.text();


    console.error(
      "Business lookup failed:",
      detail
    );


    return {
      ok: false,

      error:
        "Unable to load STall business",

      detail
    };
  }


  const businesses =
    await response.json();


  if (
    !Array.isArray(
      businesses
    ) ||
    !businesses.length
  ) {

    return {
      ok: true,

      business:
        null
    };
  }


  return {
    ok: true,

    business:
      businesses[0]
  };
}


// ============================================================
// GET BUSINESS BY ID
// ============================================================

async function getBusinessById(
  businessId
) {

  if (!businessId) {

    return {
      ok: false,

      error:
        "business_id is required"
    };
  }


  const response =
    await supabaseFetch(
      `/rest/v1/businesses` +
      `?id=eq.${encodeURIComponent(
        businessId
      )}` +
      `&select=*` +
      `&limit=1`
    );


  if (!response.ok) {

    return {
      ok: false,

      error:
        await response.text()
    };
  }


  const businesses =
    await response.json();


  if (
    !Array.isArray(
      businesses
    ) ||
    !businesses.length
  ) {

    return {
      ok: false,

      notFound:
        true
    };
  }


  return {
    ok: true,

    business:
      businesses[0]
  };
}


// ============================================================
// GET PAYMENT BY PAYMENT ID
// ============================================================

async function getPaymentByPaymentId(
  paymentId
) {

  if (!paymentId) {

    return {
      ok: false,

      notFound:
        true
    };
  }


  const response =
    await supabaseFetch(
      `/rest/v1/razorpay_payments` +
      `?razorpay_payment_id=eq.${encodeURIComponent(
        paymentId
      )}` +
      `&select=*` +
      `&limit=1`
    );


  if (!response.ok) {

    return {
      ok: false,

      error:
        await response.text()
    };
  }


  const rows =
    await response.json();


  if (
    !Array.isArray(
      rows
    ) ||
    !rows.length
  ) {

    return {
      ok: false,

      notFound:
        true
    };
  }


  return {
    ok: true,

    payment:
      rows[0]
  };
}


// ============================================================
// SAVE PAYMENT EVENT
// ============================================================

async function savePaymentEvent(
  paymentRecord,
  paymentData,
  signature = null,
  status = null
) {

  if (
    !paymentRecord?.razorpay_order_id
  ) {

    return {
      ok: false,

      error:
        "Razorpay order ID is missing"
    };
  }


  const update = {
    razorpay_payment_id:
      paymentData?.id ||
      paymentRecord.razorpay_payment_id ||
      null,

    razorpay_signature:
      signature ||
      paymentRecord.razorpay_signature ||
      null,

    status:
      status ||
      paymentRecord.status ||
      "created"
  };


  const response =
    await updatePayment(
      paymentRecord.razorpay_order_id,
      update
    );


  if (!response.ok) {

    return {
      ok: false,

      error:
        "Unable to update payment record"
    };
  }


  return {
    ok: true
  };
}


// ============================================================
// MARK PAYMENT PAID
// ============================================================

async function markPaymentPaid(
  paymentRecord,
  paymentData
) {

  if (
    !paymentRecord?.razorpay_order_id
  ) {

    return {
      ok: false,

      error:
        "Payment order is missing"
    };
  }


  const response =
    await updatePayment(
      paymentRecord.razorpay_order_id,
      {
        razorpay_payment_id:
          paymentData?.id ||
          paymentRecord.razorpay_payment_id ||
          null,

        status:
          "paid"
      }
    );


  if (!response.ok) {

    return {
      ok: false,

      error:
        "Unable to mark payment as paid"
    };
  }


  return {
    ok: true
  };
}


// ============================================================
// CHECK WHETHER PAYMENT IS ALREADY COMPLETE
// ============================================================

function isPaymentComplete(
  payment
) {

  if (!payment) {
    return false;
  }


  return (
    payment.status ===
      "paid" ||
    payment.status ===
      "captured"
  );
}


// ============================================================
// CREATE RECEIPT
// ============================================================

function createReceipt() {

  const randomPart =
    crypto
      .randomUUID()
      .replace(
        /-/g,
        ""
      )
      .slice(
        0,
        12
      );


  return (
    `stall_${Date.now()}_${randomPart}`
  );
}


// ============================================================
// NORMALIZE PHONE
// ============================================================

function normalizePhone(
  phone
) {

  if (!phone) {
    return "";
  }


  return String(
    phone
  )
    .replace(
      /[^0-9+]/g,
      ""
    )
    .trim();
}


// ============================================================
// NORMALIZE EMAIL
// ============================================================

function normalizeEmail(
  email
) {

  if (!email) {
    return "";
  }


  return String(
    email
  )
    .trim()
    .toLowerCase();
}


// ============================================================
// NORMALIZE BUSINESS NAME
// ============================================================

function normalizeBusinessName(
  value
) {

  if (!value) {
    return "STall Listing";
  }


  return String(
    value
  )
    .trim()
    .slice(
      0,
      200
    );
}


// ============================================================
// EXTRACT BUSINESS NAME
// ============================================================

function extractBusinessName(
  body,
  state,
  business
) {

  const candidates = [
    body?.business_name,

    body?.business?.name,

    body?.business?.title,

    body?.business?.location?.title,

    body?.business?.location?.name,

    business?.business_name,

    business?.name,

    business?.title,

    state?.business_name,

    state?.customer_name
  ];


  for (
    const value of candidates
  ) {

    if (
      value &&
      String(
        value
      ).trim()
    ) {

      return normalizeBusinessName(
        value
      );
    }
  }


  return "STall Listing";
}


// ============================================================
// EXTRACT CUSTOMER
// ============================================================

function extractCustomer(
  body,
  state
) {

  const email =
    normalizeEmail(
      body?.customer_email ||
      state?.customer_email ||
      state?.google_account_email ||
      ""
    );


  const phone =
    normalizePhone(
      body?.customer_phone ||
      state?.customer_phone ||
      ""
    );


  const name =
    normalizeBusinessName(
      body?.customer_name ||
      state?.customer_name ||
      "STall Customer"
    );


  return {
    name,

    email,

    phone
  };
}


// ============================================================
// UPDATE BUSINESS PAYMENT STATUS
// ============================================================

async function updateBusinessPaymentStatus(
  businessId,
  paymentData
) {

  if (!businessId) {

    return {
      ok: true,

      skipped:
        true
    };
  }


  const values = {
    payment_status:
      "paid",

    payment_plan:
      LISTING_PLAN,

    razorpay_order_id:
      paymentData?.order_id ||
      null,

    razorpay_payment_id:
      paymentData?.id ||
      null,

    listing_status:
      "active"
  };


  const response =
    await supabaseFetch(
      `/rest/v1/businesses` +
      `?id=eq.${encodeURIComponent(
        businessId
      )}`,
      {
        method:
          "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body:
          JSON.stringify(
            values
          )
      }
    );


  if (!response.ok) {

    const detail =
      await response.text();


    console.error(
      "Business payment status update failed:",
      detail
    );


    return {
      ok: false,

      error:
        detail
    };
  }


  return {
    ok: true
  };
}


// ============================================================
// UPDATE ONBOARDING PAYMENT STATUS
// ============================================================

async function updateOnboardingPaymentStatus(
  onboardingId,
  paymentData
) {

  if (!onboardingId) {

    return {
      ok: true,

      skipped:
        true
    };
  }


  const values = {
    payment_status:
      "paid",

    payment_plan:
      LISTING_PLAN,

    razorpay_order_id:
      paymentData?.order_id ||
      null,

    razorpay_payment_id:
      paymentData?.id ||
      null,

    listing_status:
      "active"
  };


  const response =
    await supabaseFetch(
      `/rest/v1/google_oauth_states` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}`,
      {
        method:
          "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body:
          JSON.stringify(
            values
          )
      }
    );


  if (!response.ok) {

    const detail =
      await response.text();


    console.error(
      "Onboarding payment status update failed:",
      detail
    );


    return {
      ok: false,

      error:
        detail
    };
  }


  return {
    ok: true
  };
}


// ============================================================
// ACTIVATE BUSINESS + ONBOARDING
// ============================================================

async function activatePaidListing(
  paymentRecord,
  paymentData
) {

  const onboardingId =
    paymentRecord?.onboarding_id;


  let businessId =
    paymentRecord?.business_id ||
    null;


  // ----------------------------------------------------------
  // FIND BUSINESS IF PAYMENT RECORD HAS ONE
  // ----------------------------------------------------------

  if (
    !businessId &&
    onboardingId
  ) {

    const businessResult =
      await getBusinessForOnboarding(
        onboardingId
      );


    if (
      businessResult.ok &&
      businessResult.business
    ) {

      businessId =
        businessResult.business.id ||
        null;
    }
  }


  // ----------------------------------------------------------
  // UPDATE ONBOARDING
  // ----------------------------------------------------------

  const onboardingResult =
    await updateOnboardingPaymentStatus(
      onboardingId,
      paymentData
    );


  // ----------------------------------------------------------
  // UPDATE BUSINESS
  // ----------------------------------------------------------

  let businessResult = {
    ok: true
  };


  if (businessId) {

    businessResult =
      await updateBusinessPaymentStatus(
        businessId,
        paymentData
      );
  }


  if (
    !onboardingResult.ok &&
    !businessResult.ok
  ) {

    return {
      ok: false,

      error:
        "Unable to activate paid listing"
    };
  }


  return {
    ok: true,

    business_id:
      businessId,

    onboarding_id:
      onboardingId
  };
}


// ============================================================
// FETCH RAZORPAY PAYMENT
// ============================================================

async function fetchRazorpayPayment(
  paymentId
) {

  if (!paymentId) {

    return {
      ok: false,

      error:
        "Razorpay payment ID is required"
    };
  }


  const response =
    await razorpayFetch(
      `/payments/${encodeURIComponent(
        paymentId
      )}`,
      {
        method:
          "GET"
      }
    );


  const data =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (!response.ok) {

    console.error(
      "Razorpay payment lookup failed:",
      {
        status:
          response.status,

        data
      }
    );


    return {
      ok: false,

      error:
        data?.error?.description ||
        "Unable to retrieve Razorpay payment",

      status:
        response.status,

      data
    };
  }


  return {
    ok: true,

    payment:
      data
  };
}


// ============================================================
// FETCH RAZORPAY ORDER
// ============================================================

async function fetchRazorpayOrder(
  orderId
) {

  if (!orderId) {

    return {
      ok: false,

      error:
        "Razorpay order ID is required"
    };
  }


  const response =
    await razorpayFetch(
      `/orders/${encodeURIComponent(
        orderId
      )}`,
      {
        method:
          "GET"
      }
    );


  const data =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (!response.ok) {

    console.error(
      "Razorpay order lookup failed:",
      {
        status:
          response.status,

        data
      }
    );


    return {
      ok: false,

      error:
        data?.error?.description ||
        "Unable to retrieve Razorpay order",

      status:
        response.status,

      data
    };
  }


  return {
    ok: true,

    order:
      data
  };
}


// ============================================================
// VERIFY PAYMENT OWNERSHIP
// ============================================================

function paymentBelongsToOrder(
  payment,
  orderId
) {

  return (
    !!payment &&
    !!orderId &&
    payment.order_id ===
      orderId
  );
}


// ============================================================
// VERIFY PAYMENT AMOUNT
// ============================================================

function paymentAmountMatches(
  payment,
  expectedAmount
) {

  if (!payment) {
    return false;
  }


  return (
    Number(
      payment.amount
    ) ===
    Number(
      expectedAmount
    )
  );
}


// ============================================================
// GET PAYMENT STATUS
// ============================================================

function paymentStatus(
  payment
) {

  return (
    payment?.status ||
    "unknown"
  );
}


// ============================================================
// CHECK CAPTURED
// ============================================================

function isCaptured(
  payment
) {

  return (
    payment?.status ===
      "captured"
  );
}


// ============================================================
// CHECK FAILED
// ============================================================

function isFailed(
  payment
) {

  return (
    payment?.status ===
      "failed"
  );
}


// ============================================================
// CHECK AUTHORIZED
// ============================================================

function isAuthorized(
  payment
) {

  return (
    payment?.status ===
      "authorized"
  );
}


// ============================================================
// PAYMENT SUMMARY
// ============================================================

function paymentSummary(
  payment
) {

  if (!payment) {

    return null;
  }


  return {
    id:
      payment.id ||
      null,

    order_id:
      payment.order_id ||
      null,

    amount:
      payment.amount ||
      null,

    currency:
      payment.currency ||
      null,

    status:
      payment.status ||
      null,

    method:
      payment.method ||
      null,

    captured:
      !!payment.captured,

    email:
      payment.email ||
      null,

    contact:
      payment.contact ||
      null
  };
}


// ============================================================
// ORDER SUMMARY
// ============================================================

function orderSummary(
  order
) {

  if (!order) {

    return null;
  }


  return {
    id:
      order.id ||
      null,

    amount:
      order.amount ||
      null,

    amount_paid:
      order.amount_paid ||
      null,

    amount_due:
      order.amount_due ||
      null,

    currency:
      order.currency ||
      null,

    status:
      order.status ||
      null,

    receipt:
      order.receipt ||
      null
  };
}


// ============================================================
// RECONCILE PAYMENT
// ============================================================

async function reconcilePayment(
  paymentRecord,
  payment
) {

  if (!paymentRecord) {

    return {
      ok: false,

      error:
        "Payment record is missing"
    };
  }


  if (
    !payment
  ) {

    return {
      ok: false,

      error:
        "Razorpay payment is missing"
    };
  }


  if (
    !paymentBelongsToOrder(
      payment,
      paymentRecord.razorpay_order_id
    )
  ) {

    return {
      ok: false,

      error:
        "Payment does not belong to this order"
    };
  }


  if (
    !paymentAmountMatches(
      payment,
      paymentRecord.amount
    )
  ) {

    return {
      ok: false,

      error:
        "Payment amount does not match"
    };
  }


  // ----------------------------------------------------------
  // FAILED
  // ----------------------------------------------------------

  if (
    isFailed(
      payment
    )
  ) {

    await updatePayment(
      paymentRecord.razorpay_order_id,
      {
        razorpay_payment_id:
          payment.id,

        status:
          "failed"
      }
    );


    return {
      ok: true,

      paid:
        false,

      failed:
        true,

      status:
        "failed"
    };
  }


  // ----------------------------------------------------------
  // CAPTURED
  // ----------------------------------------------------------

  if (
    isCaptured(
      payment
    )
  ) {

    await updatePayment(
      paymentRecord.razorpay_order_id,
      {
        razorpay_payment_id:
          payment.id,

        status:
          "captured"
      }
    );


    const activation =
      await activatePaidListing(
        paymentRecord,
        payment
      );


    if (
      !activation.ok
    ) {

      return {
        ok: false,

        paid:
          true,

        captured:
          true,

        error:
          activation.error
      };
    }


    await updatePayment(
      paymentRecord.razorpay_order_id,
      {
        razorpay_payment_id:
          payment.id,

        status:
          "paid"
      }
    );


    return {
      ok: true,

      paid:
        true,

      captured:
        true,

      failed:
        false,

      status:
        "paid",

      activation
    };
  }


  // ----------------------------------------------------------
  // AUTHORIZED
  // ----------------------------------------------------------

  if (
    isAuthorized(
      payment
    )
  ) {

    await updatePayment(
      paymentRecord.razorpay_order_id,
      {
        razorpay_payment_id:
          payment.id,

        status:
          "authorized"
      }
    );


    return {
      ok: true,

      paid:
        false,

      captured:
        false,

      failed:
        false,

      authorized:
        true,

      status:
        "authorized"
    };
  }


  // ----------------------------------------------------------
  // OTHER
  // ----------------------------------------------------------

  await updatePayment(
    paymentRecord.razorpay_order_id,
    {
      razorpay_payment_id:
        payment.id,

      status:
        payment.status ||
        "created"
    }
  );


  return {
    ok: true,

    paid:
      false,

    captured:
      false,

    failed:
      false,

    status:
      payment.status ||
      "unknown"
  };
}


// ============================================================
// VERIFY CHECKOUT PAYMENT
// ============================================================

async function verifyCheckoutPayment(
  body
) {

  const orderId =
    body?.razorpay_order_id;


  const paymentId =
    body?.razorpay_payment_id;


  const signature =
    body?.razorpay_signature;


  if (
    !orderId ||
    !paymentId ||
    !signature
  ) {

    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "razorpay_order_id, razorpay_payment_id and razorpay_signature are required"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // FIND ORDER IN STall
  // ----------------------------------------------------------

  const recordResult =
    await getPaymentRecord(
      orderId
    );


  if (
    !recordResult.ok
  ) {

    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          recordResult.notFound
            ? "Razorpay order not found in STall"
            : "Unable to load STall payment record"
      },
      recordResult.notFound
        ? 404
        : 500
    );
  }


  const paymentRecord =
    recordResult.payment;


  // ----------------------------------------------------------
  // IDEMPOTENCY
  // ----------------------------------------------------------

  if (
    isPaymentComplete(
      paymentRecord
    )
  ) {

    return json(
      {
        success:
          true,

        verified:
          true,

        paid:
          true,

        already_processed:
          true,

        razorpay_order_id:
          orderId,

        razorpay_payment_id:
          paymentRecord.razorpay_payment_id
      }
    );
  }


  // ----------------------------------------------------------
  // HMAC
  // ----------------------------------------------------------

  const payload =
    `${orderId}|${paymentId}`;


  const expectedSignature =
    await hmacSha256Hex(
      RAZORPAY_KEY_SECRET,
      payload
    );


  if (
    !safeEqual(
      expectedSignature,
      signature
    )
  ) {

    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "Payment verification failed"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // STORE VERIFIED SIGNATURE
  // ----------------------------------------------------------

  await updatePayment(
    orderId,
    {
      razorpay_payment_id:
        paymentId,

      razorpay_signature:
        signature,

      status:
        "authorized"
    }
  );


  // ----------------------------------------------------------
  // FETCH PAYMENT FROM RAZORPAY
  // ----------------------------------------------------------

  const paymentResult =
    await fetchRazorpayPayment(
      paymentId
    );


  if (
    !paymentResult.ok
  ) {

    return json(
      {
        success:
          false,

        verified:
          true,

        error:
          paymentResult.error
      },
      502
    );
  }


  const payment =
    paymentResult.payment;


  // ----------------------------------------------------------
  // ORDER MATCH
  // ----------------------------------------------------------

  if (
    !paymentBelongsToOrder(
      payment,
      orderId
    )
  ) {

    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "Payment does not belong to this order"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // AMOUNT MATCH
  // ----------------------------------------------------------

  if (
    !paymentAmountMatches(
      payment,
      paymentRecord.amount
    )
  ) {

    return json(
      {
        success:
          false,

        verified:
          false,

        error:
          "Payment amount does not match the STall order"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // RECONCILE
  // ----------------------------------------------------------

  const reconciliation =
    await reconcilePayment(
      paymentRecord,
      payment
    );


  if (
    !reconciliation.ok
  ) {

    return json(
      {
        success:
          false,

        verified:
          true,

        payment_verified:
          true,

        error:
          reconciliation.error,

        payment:
          paymentSummary(
            payment
          )
      },
      500
    );
  }


  // ----------------------------------------------------------
  // SUCCESS
  // ----------------------------------------------------------

  if (
    reconciliation.paid
  ) {

    return json(
      {
        success:
          true,

        verified:
          true,

        payment_verified:
          true,

        captured:
          true,

        paid:
          true,

        activated:
          true,

        product:
          PRODUCT_NAME,

        plan:
          LISTING_PLAN,

        razorpay_order_id:
          orderId,

        razorpay_payment_id:
          paymentId
      }
    );
  }


  // ----------------------------------------------------------
  // NOT YET CAPTURED
  // ----------------------------------------------------------

  return json(
    {
      success:
        false,

      verified:
        true,

      payment_verified:
        true,

      captured:
        false,

      paid:
        false,

      payment_status:
        reconciliation.status,

      razorpay_order_id:
        orderId,

      razorpay_payment_id:
        paymentId,

      message:
        "Payment is verified but has not been captured yet."
    },
    202
  );
}
// ============================================================
// ORDER STATUS
// ============================================================

async function getOrderStatus(
  body
) {

  const orderId =
    body?.razorpay_order_id ||
    body?.order_id;


  if (!orderId) {

    return json(
      {
        success:
          false,

        error:
          "razorpay_order_id is required"
      },
      400
    );
  }


  // ----------------------------------------------------------
  // LOAD LOCAL PAYMENT
  // ----------------------------------------------------------

  const recordResult =
    await getPaymentRecord(
      orderId
    );


  if (
    !recordResult.ok
  ) {

    return json(
      {
        success:
          false,

        error:
          recordResult.notFound
            ? "Order not found"
            : "Unable to load payment order"
      },
      recordResult.notFound
        ? 404
        : 500
    );
  }


  const paymentRecord =
    recordResult.payment;


  // ----------------------------------------------------------
  // FETCH RAZORPAY ORDER
  // ----------------------------------------------------------

  const orderResult =
    await fetchRazorpayOrder(
      orderId
    );


  if (
    !orderResult.ok
  ) {

    return json(
      {
        success:
          false,

        error:
          orderResult.error
      },
      502
    );
  }


  const order =
    orderResult.order;


  // ----------------------------------------------------------
  // RETURN SAFE STATUS
  // ----------------------------------------------------------

  return json(
    {
      success:
        true,

      order:
        orderSummary(
          order
        ),

      local: {
        status:
          paymentRecord.status,

        plan:
          paymentRecord.plan,

        onboarding_id:
          paymentRecord.onboarding_id,

        razorpay_order_id:
          paymentRecord.razorpay_order_id,

        razorpay_payment_id:
          paymentRecord.razorpay_payment_id
      }
    }
  );
}


// ============================================================
// FETCH ALL PAYMENTS FOR ONBOARDING
// ============================================================

async function getPaymentHistory(
  body
) {

  const onboardingId =
    body?.onboarding_id;


  if (!onboardingId) {

    return json(
      {
        success:
          false,

        error:
          "onboarding_id is required"
      },
      400
    );
  }


  const response =
    await supabaseFetch(
      `/rest/v1/razorpay_payments` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}` +
      `&select=` +
      [
        "id",
        "razorpay_order_id",
        "razorpay_payment_id",
        "amount",
        "currency",
        "status",
        "plan",
        "source",
        "created_at",
        "updated_at"
      ].join(",") +
      `&order=created_at.desc`
    );


  if (!response.ok) {

    const detail =
      await response.text();


    console.error(
      "Payment history lookup failed:",
      detail
    );


    return json(
      {
        success:
          false,

        error:
          "Unable to load payment history"
      },
      500
    );
  }


  const rows =
    await response.json();


  return json(
    {
      success:
        true,

      payments:
        Array.isArray(
          rows
        )
          ? rows
          : []
    }
  );
}


// ============================================================
// GET CURRENT PAYMENT STATUS
// ============================================================

async function getCurrentPaymentStatus(
  body
) {

  const onboardingId =
    body?.onboarding_id;


  if (!onboardingId) {

    return json(
      {
        success:
          false,

        error:
          "onboarding_id is required"
      },
      400
    );
  }


  const response =
    await supabaseFetch(
      `/rest/v1/razorpay_payments` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}` +
      `&select=` +
      [
        "id",
        "razorpay_order_id",
        "razorpay_payment_id",
        "amount",
        "currency",
        "status",
        "plan",
        "created_at",
        "updated_at"
      ].join(",") +
      `&order=created_at.desc` +
      `&limit=1`
    );


  if (!response.ok) {

    return json(
      {
        success:
          false,

        error:
          "Unable to determine payment status"
      },
      500
    );
  }


  const rows =
    await response.json();


  if (
    !Array.isArray(
      rows
    ) ||
    !rows.length
  ) {

    return json(
      {
        success:
          true,

        paid:
          false,

        status:
          "not_started",

        payment:
          null
      }
    );
  }


  const payment =
    rows[0];


  return json(
    {
      success:
        true,

      paid:
        isPaymentComplete(
          payment
        ),

      status:
        payment.status,

      payment
    }
  );
}


// ============================================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================================

async function verifyWebhookSignature(
  rawBody,
  signature
) {

  if (
    !RAZORPAY_WEBHOOK_SECRET
  ) {

    return {
      valid:
        false,

      reason:
        "Webhook secret is not configured"
    };
  }


  if (
    !signature
  ) {

    return {
      valid:
        false,

      reason:
        "Webhook signature is missing"
    };
  }


  const expectedSignature =
    await hmacSha256Hex(
      RAZORPAY_WEBHOOK_SECRET,
      rawBody
    );


  return {
    valid:
      safeEqual(
        expectedSignature,
        signature
      ),

    reason:
      null
  };
}


// ============================================================
// HANDLE RAZORPAY WEBHOOK
// ============================================================

async function handleWebhook(
  request
) {

  const rawBody =
    await request.text();


  const signature =
    request.headers.get(
      "x-razorpay-signature"
    );


  const verification =
    await verifyWebhookSignature(
      rawBody,
      signature
    );


  if (
    !verification.valid
  ) {

    console.error(
      "Razorpay webhook rejected:",
      verification.reason
    );


    return json(
      {
        success:
          false,

        error:
          "Invalid webhook signature"
      },
      400
    );
  }


  let event;


  try {

    event =
      JSON.parse(
        rawBody
      );

  } catch {

    return json(
      {
        success:
          false,

        error:
          "Invalid webhook payload"
      },
      400
    );
  }


  const eventName =
    event?.event ||
    null;


  console.log(
    "RAZORPAY WEBHOOK EVENT:",
    eventName
  );


  // ----------------------------------------------------------
  // EXTRACT PAYMENT
  // ----------------------------------------------------------

  const paymentEntity =
    event?.payload?.payment?.entity ||
    null;


  // ----------------------------------------------------------
  // EXTRACT ORDER
  // ----------------------------------------------------------

  const orderEntity =
    event?.payload?.order?.entity ||
    null;


  const orderId =
    paymentEntity?.order_id ||
    orderEntity?.id ||
    null;


  const paymentId =
    paymentEntity?.id ||
    null;


  if (!orderId) {

    console.log(
      "Razorpay webhook has no order ID; acknowledging."
    );


    return json(
      {
        success:
          true,

        received:
          true,

        processed:
          false,

        reason:
          "No order ID"
      }
    );
  }


  // ----------------------------------------------------------
  // FIND STall PAYMENT
  // ----------------------------------------------------------

  const recordResult =
    await getPaymentRecord(
      orderId
    );


  if (
    !recordResult.ok
  ) {

    console.error(
      "Webhook order not found:",
      orderId
    );


    // We acknowledge the webhook.
    //
    // Razorpay can send events for orders that may
    // have been created elsewhere. We don't create
    // arbitrary STall records from untrusted webhook
    // data.
    return json(
      {
        success:
          true,

        received:
          true,

        processed:
          false,

        reason:
          "Order not found in STall"
      }
    );
  }


  const paymentRecord =
    recordResult.payment;


  // ----------------------------------------------------------
  // IDEMPOTENCY
  // ----------------------------------------------------------

  if (
    eventName ===
      "payment.captured" &&
    paymentRecord.status ===
      "paid"
  ) {

    return json(
      {
        success:
          true,

        received:
          true,

        processed:
          true,

        already_processed:
          true,

        order_id:
          orderId,

        payment_id:
          paymentId
      }
    );
  }


  // ----------------------------------------------------------
  // PAYMENT AUTHORIZED
  // ----------------------------------------------------------

  if (
    eventName ===
      "payment.authorized"
  ) {

    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          paymentId,

        status:
          "authorized"
      }
    );


    return json(
      {
        success:
          true,

        received:
          true,

        processed:
          true,

        event:
          eventName
      }
    );
  }


  // ----------------------------------------------------------
  // PAYMENT CAPTURED
  // ----------------------------------------------------------

  if (
    eventName ===
      "payment.captured"
  ) {

    if (
      !paymentEntity
    ) {

      return json(
        {
          success:
            true,

          received:
            true,

          processed:
            false,

          reason:
            "Payment entity missing"
        }
      );
    }


    if (
      !paymentBelongsToOrder(
        paymentEntity,
        orderId
      )
    ) {

      console.error(
        "Webhook payment/order mismatch:",
        {
          orderId,

          paymentOrderId:
            paymentEntity.order_id
        }
      );


      return json(
        {
          success:
            false,

          error:
            "Payment/order mismatch"
        },
        400
      );
    }


    if (
      !paymentAmountMatches(
        paymentEntity,
        paymentRecord.amount
      )
    ) {

      console.error(
        "Webhook payment amount mismatch:",
        {
          expected:
            paymentRecord.amount,

          received:
            paymentEntity.amount
        }
      );


      return json(
        {
          success:
            false,

          error:
            "Payment amount mismatch"
        },
        400
      );
    }


    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          paymentId,

        status:
          "captured"
      }
    );


    const activation =
      await activatePaidListing(
        paymentRecord,
        paymentEntity
      );


    if (
      !activation.ok
    ) {

      console.error(
        "Webhook activation failed:",
        activation.error
      );


      // We intentionally return 500 here.
      // Razorpay can retry the webhook, giving STall
      // another opportunity to complete activation.
      return json(
        {
          success:
            false,

          error:
            "Payment captured but listing activation failed"
        },
        500
      );
    }


    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          paymentId,

        status:
          "paid"
      }
    );


    return json(
      {
        success:
          true,

        received:
          true,

        processed:
          true,

        paid:
          true,

        activated:
          true,

        order_id:
          orderId,

        payment_id:
          paymentId
      }
    );
  }


  // ----------------------------------------------------------
  // ORDER PAID
  // ----------------------------------------------------------

  if (
    eventName ===
      "order.paid"
  ) {

    let payment =
      paymentEntity;


    // If the webhook contains an order but not a
    // payment entity, ask Razorpay for the payment.
    if (
      !payment &&
      orderId
    ) {

      const orderPaymentsResponse =
        await razorpayFetch(
          `/orders/${encodeURIComponent(
            orderId
          )}/payments`,
          {
            method:
              "GET"
          }
        );


      const orderPayments =
        await orderPaymentsResponse
          .json()
          .catch(
            () => ({})
          );


      const payments =
        Array.isArray(
          orderPayments.items
        )
          ? orderPayments.items
          : [];


      payment =
        payments.find(
          item =>
            item.status ===
            "captured"
        ) ||
        payments[0] ||
        null;
    }


    if (
      !payment
    ) {

      return json(
        {
          success:
            true,

          received:
            true,

          processed:
            false,

          reason:
            "No payment entity available"
        }
      );
    }


    if (
      !paymentBelongsToOrder(
        payment,
        orderId
      )
    ) {

      return json(
        {
          success:
            false,

          error:
            "Payment/order mismatch"
        },
        400
      );
    }


    if (
      !paymentAmountMatches(
        payment,
        paymentRecord.amount
      )
    ) {

      return json(
        {
          success:
            false,

          error:
            "Payment amount mismatch"
        },
        400
      );
    }


    if (
      !isCaptured(
        payment
      )
    ) {

      return json(
        {
          success:
            true,

          received:
            true,

          processed:
            false,

          reason:
            "Payment is not captured"
        }
      );
    }


    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          payment.id,

        status:
          "captured"
      }
    );


    const activation =
      await activatePaidListing(
        paymentRecord,
        payment
      );


    if (
      !activation.ok
    ) {

      console.error(
        "order.paid activation failed:",
        activation.error
      );


      return json(
        {
          success:
            false,

          error:
            "Payment captured but listing activation failed"
        },
        500
      );
    }


    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          payment.id,

        status:
          "paid"
      }
    );


    return json(
      {
        success:
          true,

        received:
          true,

        processed:
          true,

        paid:
          true,

        activated:
          true,

        order_id:
          orderId,

        payment_id:
          payment.id
      }
    );
  }


  // ----------------------------------------------------------
  // PAYMENT FAILED
  // ----------------------------------------------------------

  if (
    eventName ===
      "payment.failed"
  ) {

    await updatePayment(
      orderId,
      {
        razorpay_payment_id:
          paymentId,

        status:
          "failed"
      }
    );


    return json(
      {
        success:
          true,

        received:
          true,

        processed:
          true,

        paid:
          false,

        failed:
          true,

        order_id:
          orderId,

        payment_id:
          paymentId
      }
    );
  }


  // ----------------------------------------------------------
  // OTHER EVENTS
  // ----------------------------------------------------------

  console.log(
    "Razorpay webhook acknowledged:",
    eventName
  );


  return json(
    {
      success:
        true,

      received:
        true,

      processed:
        false,

      event:
        eventName,

      order_id:
        orderId,

      payment_id:
        paymentId
    }
  );
}


// ============================================================
// MAIN ROUTER
// ============================================================

export default {
  async fetch(
    request
  ) {

    try {

      // --------------------------------------------------------
      // METHOD
      // --------------------------------------------------------

      if (
        request.method !==
          "POST"
      ) {

        return json(
          {
            success:
              false,

            error:
              "Method not allowed"
          },
          405
        );
      }


      // --------------------------------------------------------
      // REQUIRED SERVER VARIABLES
      // --------------------------------------------------------

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY
      ) {

        return json(
          {
            success:
              false,

            error:
              "Supabase server configuration is missing"
          },
          500
        );
      }


      if (
        !RAZORPAY_KEY_ID ||
        !RAZORPAY_KEY_SECRET
      ) {

        return json(
          {
            success:
              false,

            error:
              "Razorpay server configuration is missing"
          },
          500
        );
      }


      // --------------------------------------------------------
      // ROUTE
      // --------------------------------------------------------

      const url =
        new URL(
          request.url
        );


      const action =
        (
          url.searchParams.get(
            "action"
          ) ||
          "verify"
        ).toLowerCase();


      // --------------------------------------------------------
      // WEBHOOK
      //
      // Webhooks use the RAW request body.
      // Do not call request.json() before this.
      // --------------------------------------------------------

      if (
        action ===
          "webhook"
      ) {

        return handleWebhook(
          request
        );
      }


      // --------------------------------------------------------
      // JSON BODY
      // --------------------------------------------------------

      const body =
        await request
          .json()
          .catch(
            () => null
          );


      if (!body) {

        return json(
          {
            success:
              false,

            error:
              "Invalid request body"
          },
          400
        );
      }


      // --------------------------------------------------------
      // CREATE ORDER
      // --------------------------------------------------------

      if (
        action ===
          "create-order"
      ) {

        return createOrder(
          body
        );
      }


      // --------------------------------------------------------
      // VERIFY
      // --------------------------------------------------------

      if (
        action ===
          "verify"
      ) {

        return verifyCheckoutPayment(
          body
        );
      }


      // --------------------------------------------------------
      // ORDER STATUS
      // --------------------------------------------------------

      if (
        action ===
          "status"
      ) {

        return getOrderStatus(
          body
        );
      }


      // --------------------------------------------------------
      // PAYMENT HISTORY
      // --------------------------------------------------------

      if (
        action ===
          "history"
      ) {

        return getPaymentHistory(
          body
        );
      }


      // --------------------------------------------------------
      // CURRENT PAYMENT STATUS
      // --------------------------------------------------------

      if (
        action ===
          "current-status"
      ) {

        return getCurrentPaymentStatus(
          body
        );
      }


      // --------------------------------------------------------
      // UNKNOWN ACTION
      // --------------------------------------------------------

      return json(
        {
          success:
            false,

          error:
            "Unknown Razorpay action",

          supported_actions: [
            "create-order",
            "verify",
            "status",
            "history",
            "current-status",
            "webhook"
          ]
        },
        400
      );

    } catch (
      error
    ) {

      console.error(
        "Razorpay router error:",
        error
      );


      return json(
        {
          success:
            false,

          error:
            error?.message ||
            "Unable to process Razorpay request"
        },
        500
      );
    }
  }
};
// ============================================================
// END OF RAZORPAY MODULE
// ============================================================
//
// Supported endpoints:
//
// POST /api/razorpay?action=create-order
// POST /api/razorpay?action=verify
// POST /api/razorpay?action=status
// POST /api/razorpay?action=history
// POST /api/razorpay?action=current-status
// POST /api/razorpay?action=webhook
//
// The module intentionally keeps all Razorpay server-side
// functionality in this single file.
// ============================================================
