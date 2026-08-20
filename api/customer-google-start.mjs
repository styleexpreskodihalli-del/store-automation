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


function json(
  body,
  status = 200
) {

  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        'content-type':
          'application/json',

        'cache-control':
          'no-store'
      }
    }
  );

}


export default {

  async fetch(request) {

    try {

      /* ---------------------------------
         ALLOW OPTIONS
      --------------------------------- */

      if (
        request.method === 'OPTIONS'
      ) {

        return new Response(
          null,
          {
            status: 204,

            headers: {
              'access-control-allow-origin':
                '*',

              'access-control-allow-methods':
                'POST, OPTIONS',

              'access-control-allow-headers':
                'Content-Type'
            }
          }
        );

      }


      /* ---------------------------------
         ONLY POST
      --------------------------------- */

      if (
        request.method !== 'POST'
      ) {

        return json(
          {
            success: false,

            error:
              'Method not allowed',

            allowed_method:
              'POST',

            received_method:
              request.method
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
          'Customer Google OAuth configuration missing',
          {
            hasSupabaseUrl:
              !!SUPABASE_URL,

            hasServiceRole:
              !!SUPABASE_SERVICE_ROLE_KEY,

            hasGoogleClientId:
              !!GOOGLE_CLIENT_ID,

            hasGoogleRedirectUri:
              !!GOOGLE_REDIRECT_URI
          }
        );


        return json(
          {
            success: false,

            error:
              'Google connection is not configured'
          },
          500
        );

      }


      /* ---------------------------------
         READ REQUEST BODY
      --------------------------------- */

      let body = {};

      try {

        body =
          await request.json();

      } catch {

        body = {};

      }


      /*
       * Customer information is intentionally
       * NOT required at this stage.
       *
       * Google Business Profile identifies
       * the customer/business.
       */

      const customerName =
        typeof body?.customer_name === 'string'
          ? body.customer_name.trim()
          : '';


      const customerEmail =
        typeof body?.customer_email === 'string'
          ? body.customer_email
              .trim()
              .toLowerCase()
          : '';


      const customerPhone =
        typeof body?.customer_phone === 'string'
          ? body.customer_phone.trim()
          : '';


      /* ---------------------------------
         ONBOARDING ID
      --------------------------------- */

      const onboardingId =
        crypto.randomUUID();


      /* ---------------------------------
         SECURE GOOGLE OAUTH STATE
      --------------------------------- */

      const state =
        crypto
          .randomBytes(32)
          .toString('hex');


      const stateHash =
        crypto
          .createHash('sha256')
          .update(state)
          .digest('hex');


      const expiresAt =
        new Date(
          Date.now() +
          15 * 60 * 1000
        ).toISOString();


      /* ---------------------------------
         SAVE OAUTH STATE
      --------------------------------- */

      const stateBody = {

        state_hash:
          stateHash,

        expires_at:
          expiresAt,

        customer_name:
          customerName || null,

        customer_email:
          customerEmail || null,

        customer_phone:
          customerPhone || null,

        onboarding_id:
          onboardingId

      };


      console.log(
        'CUSTOMER GOOGLE START',
        {
          onboarding_id:
            onboardingId,

          has_customer_name:
            !!customerName,

          has_customer_email:
            !!customerEmail,

          has_customer_phone:
            !!customerPhone
        }
      );


      const stateResponse =
        await fetch(

          `${SUPABASE_URL}/rest/v1/google_oauth_states`,

          {

            method:
              'POST',

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


      if (
        !stateResponse.ok
      ) {

        const detail =
          await stateResponse.text();


        console.error(
          'Customer OAuth state insert failed:',
          {
            status:
              stateResponse.status,

            detail
          }
        );


        return json(
          {
            success: false,

            error:
              'Unable to initialize Google connection',

            supabase_status:
              stateResponse.status,

            supabase_details:
              detail || null
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

          prompt:
            'select_account consent',

          include_granted_scopes:
            'true',

          state,

          scope:
            [
              'openid',
              'email',
              'https://www.googleapis.com/auth/business.manage'
            ].join(' ')

        });


      /* ---------------------------------
         AUTHORIZATION URL
      --------------------------------- */

      const authorizationUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;


      console.log(
        'CUSTOMER GOOGLE AUTH CREATED',
        {
          onboarding_id:
            onboardingId,

          redirect_uri:
            GOOGLE_REDIRECT_URI
        }
      );


      /* ---------------------------------
         RESPONSE
      --------------------------------- */

      return json(
        {

          success:
            true,

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
            'Unable to start Google connection',

          details:
            error?.message ||
            String(error)

        },
        500
      );

    }

  }

};
