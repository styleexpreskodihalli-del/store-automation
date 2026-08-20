import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_CUSTOMER_REDIRECT_URI ||
  process.env.GOOGLE_REDIRECT_URI;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY ||
        !GOOGLE_CLIENT_ID ||
        !GOOGLE_REDIRECT_URI
      ) {
        console.error(
          'Customer Google OAuth configuration missing'
        );

        return json({
          error: 'Google connection is not configured'
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

      /*
       * Create a temporary onboarding identifier.
       * This is NOT a Supabase user ID and does not grant
       * any authenticated access.
       */
      const onboardingId =
        crypto.randomUUID();

      /*
       * Generate a cryptographically secure OAuth state.
       */
      const state =
        crypto.randomBytes(32).toString('hex');

      const stateHash =
        crypto
          .createHash('sha256')
          .update(state)
          .digest('hex');

      const expiresAt =
        new Date(
          Date.now() + 15 * 60 * 1000
        ).toISOString();

      /*
       * Store only the hash of the OAuth state.
       *
       * The customer information is temporarily associated
       * with this onboarding flow and will be used after
       * Google authorization.
       */
      const stateBody = {
        state_hash: stateHash,
        expires_at: expiresAt,
        customer_name: customer_name.trim(),
        customer_email:
          customer_email.trim().toLowerCase(),
        customer_phone:
          customer_phone?.trim() || null,
        onboarding_id: onboardingId
      };

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
              JSON.stringify(stateBody)
          }
        );

      if (!stateResponse.ok) {
        const detail =
          await stateResponse.text();

        console.error(
          'Customer OAuth state insert failed:',
          detail
        );

        return json({
          error:
            'Unable to initialize Google connection'
        }, 500);
      }

      const params =
        new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          redirect_uri: GOOGLE_REDIRECT_URI,
          response_type: 'code',
          access_type: 'offline',
          prompt: 'select_account consent',
          include_granted_scopes: 'true',
          state,
          scope:
            'openid email https://www.googleapis.com/auth/business.manage'
        });

      const authorizationUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      return json({
        success: true,
        onboarding_id: onboardingId,
        authorizationUrl
      });

    } catch (error) {
      console.error(
        'Customer Google start error:',
        error
      );

      return json({
        error:
          'Unable to start Google connection'
      }, 500);
    }
  }
};
