import crypto from "node:crypto";


const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const RAZORPAY_KEY_ID =
  process.env.RAZORPAY_KEY_ID;

const RAZORPAY_KEY_SECRET =
  process.env.RAZORPAY_KEY_SECRET;


function json(
  body,
  status = 200
) {

  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );

}


/* ---------------------------------
   SUPABASE
--------------------------------- */

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


/* ---------------------------------
   MAIN
--------------------------------- */

export default {

  async fetch(request) {

    try {

      /* -----------------------------
         METHOD
      ----------------------------- */

      if (
        request.method !== "POST"
      ) {

        return json(
          {
            success: false,
            error:
              "Method not allowed"
          },
          405
        );

      }


      /* -----------------------------
         CONFIGURATION
      ----------------------------- */

      if (
        !RAZORPAY_KEY_ID ||
        !RAZORPAY_KEY_SECRET
      ) {

        console.error(
          "Razorpay configuration missing"
        );

        return json(
          {
            success: false,
            error:
              "Razorpay is not configured"
          },
          500
        );

      }


      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY
      ) {

        console.error(
          "Supabase configuration missing"
        );

        return json(
          {
            success: false,
            error:
              "Supabase is not configured"
          },
          500
        );

      }


      /* -----------------------------
         REQUEST BODY
      ----------------------------- */

      const body =
        await request
          .json()
          .catch(
            () => null
          );


      if (!body) {

        return json(
          {
            success: false,
            error:
              "Invalid request body"
          },
          400
        );

      }


      const {

        customer_name,
        customer_phone,
        business,
        onboarding_id

      } = body;


      /* -----------------------------
         ONBOARDING ID
      ----------------------------- */

      if (
        !onboarding_id
      ) {

        return json(
          {
            success: false,
            error:
              "onboarding_id is required"
          },
          400
        );

      }


      /* -----------------------------
         BUSINESS NAME
      ----------------------------- */

      let businessName =
        customer_name ||
        "STore Listing";


      if (
        business &&
        typeof business ===
          "object"
      ) {

        const location =
          business.location ||
          {};


        businessName =
          location.title ||
          business.title ||
          location.name ||
          business.name ||
          customer_name ||
          "STore Listing";

      }


      /* -----------------------------
         LOAD GOOGLE CUSTOMER
      ----------------------------- */

      const stateResponse =
        await supabaseFetch(

          `/rest/v1/google_oauth_states` +

          `?onboarding_id=eq.${encodeURIComponent(
            onboarding_id
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


      if (
        !stateResponse.ok
      ) {

        const detail =
          await stateResponse.text();


        console.error(
          "Unable to load onboarding state",
          detail
        );


        return json(
          {
            success: false,
            error:
              "Unable to load your Google connection"
          },
          500
        );

      }


      const states =
        await stateResponse
          .json();


      if (
        !Array.isArray(states) ||
        states.length === 0
      ) {

        return json(
          {
            success: false,
            error:
              "Onboarding session not found. Please start the ₹99 listing process again."
          },
          404
        );

      }


      const state =
        states[0];


      /* -----------------------------
         CUSTOMER EMAIL
      ----------------------------- */

      /*
       * IMPORTANT:
       *
       * We no longer require the customer
       * to manually enter an email.
       *
       * First use the Google account email.
       * If unavailable, fall back to the
       * onboarding customer email.
       */

      const customerEmail =
        state.google_account_email ||
        state.customer_email ||
        "";


      const finalPhone =
        customer_phone ||
        state.customer_phone ||
        "";


      console.log(
        "RAZORPAY CUSTOMER",
        JSON.stringify({

          onboarding_id:
            onboarding_id,

          business_name:
            businessName,

          google_account_email:
            state.google_account_email ||
            null,

          customer_email_available:
            !!customerEmail,

          customer_phone_available:
            !!finalPhone

        })
      );


      /* -----------------------------
         RAZORPAY ORDER
      ----------------------------- */

      /*
       * ₹99 = 9900 paise
       */

      const amount =
        9900;


      const receipt =
        `stall_${Date.now()}_${crypto
          .randomBytes(4)
          .toString("hex")}`;


      const razorpayAuth =
        Buffer
          .from(
            `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`
          )
          .toString(
            "base64"
          );


      const razorpayResponse =
        await fetch(
          "https://api.razorpay.com/v1/orders",
          {

            method:
              "POST",

            headers: {

              "Content-Type":
                "application/json",

              Authorization:
                `Basic ${razorpayAuth}`

            },

            body:
              JSON.stringify({

                amount:
                  amount,

                currency:
                  "INR",

                receipt:
                  receipt,

                notes: {

                  product:
                    "STore Automation",

                  plan:
                    "listing_99",

                  onboarding_id:
                    onboarding_id,

                  business_name:
                    businessName,

                  customer_email:
                    customerEmail,

                  customer_phone:
                    finalPhone

                }

              })

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
            success: false,

            error:
              razorpayResult?.error?.description ||
              razorpayResult?.error?.reason ||
              "Unable to create Razorpay order"
          },
          500
        );

      }


      /* -----------------------------
         SUCCESS
      ----------------------------- */

      console.log(
        "RAZORPAY ORDER CREATED",
        JSON.stringify({

          order_id:
            razorpayResult.id,

          amount:
            razorpayResult.amount,

          currency:
            razorpayResult.currency,

          onboarding_id:
            onboarding_id,

          business_name:
            businessName

        })
      );


      return json({

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
            customerEmail,

          phone:
            finalPhone

        },

        onboarding_id:
          onboarding_id

      });


    } catch (error) {

      console.error(
        "RAZORPAY CREATE ORDER ERROR",
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
          success: false,

          error:
            error?.message ||
            "Unable to initialise payment"
        },
        500
      );

    }

  }

};
