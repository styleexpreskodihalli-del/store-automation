import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_CUSTOMER_REDIRECT_URI ||
  process.env.GOOGLE_REDIRECT_URI;


function json(body, status = 200) {

  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      }
    }
  );

}


export default {

  async fetch(request) {

    try {

      /*
       * Only POST is allowed.
       */

      if (request.method !== 'POST') {

        return json(
          {
            error: 'Method not allowed'
          },
          405
        );

      }


      /*
       * Validate server configuration.
       */

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY ||
        !GOOGLE_CLIENT_ID ||
        !GOOGLE_REDIRECT_URI
      ) {

        console.error(
          'Customer Google OAuth configuration missing'
        );

        return json(
          {
            error:
              'Google connection is not configured'
          },
          500
        );

      }


      /*
       * Read request body.
       *
       * For the new ₹99 flow the body can be empty.
       *
       * Google comes FIRST.
       * Customer/business information is collected
       * from Google Business Profile after authorization.
       */

      const body =
        await request
          .json()
          .catch(() => ({}));


      /*
       * These fields are now OPTIONAL.
       *
       * We keep support for them so the endpoint remains
       * compatible with any older frontend flow.
       */

      const customerName =
        body?.customer_name?.trim() || null;

      const customerEmail =
        body?.customer_email?.trim()
          ? body.customer_email.trim().toLowerCase()
          : null;

      const customerPhone =
        body?.customer_phone?.trim() || null;


      /*
       * Create a temporary onboarding identifier.
       *
       * This is NOT a Supabase user ID.
       * It does not authenticate the customer.
       */

      const onboardingId =
        crypto.randomUUID();


      /*
       * Generate a cryptographically secure OAuth state.
       */

      const state =
        crypto.randomBytes(32).toString('hex');


      /*
       * Store only the SHA-256 hash of the OAuth state.
       */

      const stateHash =
        crypto
          .createHash('sha256')
          .update(state)
          .digest('hex');


      /*
       * OAuth state expires after 15 minutes.
       */

      const expiresAt =
        new Date(
          Date.now() +
          15 * 60 * 1000
        ).toISOString();


      /*
       * Create temporary onboarding state.
       *
       * Customer details are allowed to be NULL because
       * the new flow starts with Google.
       */

      const stateBody = {

        state_hash:
          stateHash,

        expires_at:
          expiresAt,

        customer_name:
          customerName,

        customer_email:
          customerEmail,

        customer_phone:
          customerPhone,

        onboarding_id:
          onboardingId

      };


      /*
       * Save OAuth state in Supabase.
       */

      const stateResponse =
        await fetch(
          `${SUPABASE_URL}/rest/v1/google_oauth_states`,
          {
            method: 'POST',

            headers: {

              apikey:
                SUPABASE_SERVICE_ROLE_KEY,

              Authorization:
                `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

              'Content-Type':
                'application/json',

              Prefer:
                'return=minimal'

            },

            body:
              JSON.stringify(
                stateBody
              )
          }
        );


      /*
       * Handle Supabase failure.
       */

      if (!stateResponse.ok) {

        const detail =
          await stateResponse.text();

        console.error(
          'Customer OAuth state insert failed:',
          detail
        );

        return json(
          {
            error:
              'Unable to initialize Google connection'
          },
          500
        );

      }


      /*
       * Build Google OAuth authorization URL.
       *
       * business.manage is required to access
       * Google Business Profile data.
       */

      const params =
        new URLSearchParams({

          client_id:
            GOOGLE_CLIENT_ID,

          redirect_uri:
            GOOGLE_REDIRECT_URI,

          response_type:
            'code',

          access_type:
            'offline',

          prompt:
            'select_account consent',

          include_granted_scopes:
            'true',

          state,

          scope:
            'openid email https://www.googleapis.com/auth/business.manage'

        });


      const authorizationUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;


      /*
       * Return onboarding ID + authorization URL.
       *
       * onboarding_id is saved by onboarding.html
       * before redirecting to Google.
       */

      return json(
        {
          success: true,

          onboarding_id:
            onboardingId,

          authorizationUrl
        }
      );


    } catch (error) {

      console.error(
        'Customer Google start error:',
        {
          name:
            error?.name || null,

          message:
            error?.message ||
            String(error),

          stack:
            error?.stack || null
        }
      );


      return json(
        {
          error:
            'Unable to start Google connection'
        },
        500
      );

    }

  }

};
