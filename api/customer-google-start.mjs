import crypto from 'node:crypto';

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_CUSTOMER_REDIRECT_URI ||
  process.env.GOOGLE_REDIRECT_URI;


/* ---------------------------------
   JSON RESPONSE
--------------------------------- */

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


/* ---------------------------------
   MAIN
--------------------------------- */

export default {

  async fetch(request) {

    try {

      /* ---------------------------------
         METHOD CHECK
      --------------------------------- */

      if (request.method !== 'POST') {

        return json(
          {
            error:
              'Method not allowed'
          },
          405
        );

      }


      /* ---------------------------------
         CONFIGURATION CHECK
      --------------------------------- */

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


      /* ---------------------------------
         READ REQUEST BODY
         
         The new ₹99 flow does NOT require
         customer name/email/phone here.

         Google will identify the account
         after authorization.
      --------------------------------- */

      await request
        .json()
        .catch(() => ({}));


      /* ---------------------------------
         CREATE ONBOARDING ID

         This is a temporary identifier
         for the ₹99 listing onboarding flow.

         It is NOT a Supabase user ID.
         It does NOT authenticate the user.
      --------------------------------- */

      const onboardingId =
        crypto.randomUUID();


      /* ---------------------------------
         CREATE SECURE OAUTH STATE
      --------------------------------- */

      const state =
        crypto.randomBytes(32).toString('hex');


      /* ---------------------------------
         HASH STATE BEFORE STORAGE

         We store only the SHA-256 hash
         in Supabase.
      --------------------------------- */

      const stateHash =
        crypto
          .createHash('sha256')
          .update(state)
          .digest('hex');


      /* ---------------------------------
         STATE EXPIRY

         OAuth state is valid for 15 minutes.
      --------------------------------- */

      const expiresAt =
        new Date(
          Date.now() +
          15 * 60 * 1000
        ).toISOString();


      /* ---------------------------------
         CREATE OAUTH STATE RECORD

         Customer details are intentionally
         NULL at this stage.

         They will be identified from the
         Google account after authorization.
      --------------------------------- */

      const stateBody = {

        state_hash:
          stateHash,

        expires_at:
          expiresAt,

        customer_name:
          null,

        customer_email:
          null,

        customer_phone:
          null,

        onboarding_id:
          onboardingId

      };


      /* ---------------------------------
         SAVE OAUTH STATE TO SUPABASE
      --------------------------------- */

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


      /* ---------------------------------
         HANDLE SUPABASE ERROR
      --------------------------------- */

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


      /* ---------------------------------
         GOOGLE OAUTH PARAMETERS
      --------------------------------- */

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

          /*
           * Ask Google to show the account
           * selector and consent screen.
           */
          prompt:
            'select_account consent',

          include_granted_scopes:
            'true',

          state,

          /*
           * Required Google Business Profile
           * permissions plus basic Google
           * identity.
           */
          scope:
            [
              'openid',
              'email',
              'https://www.googleapis.com/auth/business.manage'
            ].join(' ')

        });


      /* ---------------------------------
         CREATE GOOGLE AUTHORIZATION URL
      --------------------------------- */

      const authorizationUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;


      /* ---------------------------------
         LOG NON-SENSITIVE FLOW INFORMATION
      --------------------------------- */

      console.log(
        'CUSTOMER GOOGLE START',
        JSON.stringify({

          onboarding_id:
            onboardingId,

          expires_at:
            expiresAt,

          redirect_uri:
            GOOGLE_REDIRECT_URI

        })
      );


      /* ---------------------------------
         RETURN TO ONBOARDING PAGE
      --------------------------------- */

      return json(
        {

          success:
            true,

          onboarding_id:
            onboardingId,

          authorizationUrl

        },
        200
      );


    } catch (error) {

      /* ---------------------------------
         UNEXPECTED ERROR
      --------------------------------- */

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
