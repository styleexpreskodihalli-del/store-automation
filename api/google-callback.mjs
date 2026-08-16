import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        return html(
          400,
          `<h2>Google authorization failed</h2><p>${escapeHtml(error)}</p>`
        );
      }

      if (!code || !state) {
        return html(
          400,
          '<h2>Missing Google authorization code or state.</h2>'
        );
      }

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY ||
        !GOOGLE_CLIENT_ID ||
        !GOOGLE_CLIENT_SECRET ||
        !GOOGLE_REDIRECT_URI
      ) {
        console.error('Missing required OAuth environment variables');
        return html(500, '<h2>Google connection is not configured.</h2>');
      }

      /*
       * The browser receives the raw OAuth state.
       * We only store its SHA-256 hash in Supabase.
       */
      const stateHash = crypto
        .createHash('sha256')
        .update(state)
        .digest('hex');

      /*
       * Atomically claim the state:
       * - must exist
       * - must not already be used
       * - must not be expired
       */
      const stateResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/google_oauth_states` +
        `?state_hash=eq.${encodeURIComponent(stateHash)}` +
        `&used_at=is.null` +
        `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
        `&select=id,salon_id,business_id` +
        `&limit=1`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );

      if (!stateResponse.ok) {
        console.error(
          'OAuth state lookup failed:',
          await stateResponse.text()
        );
        return html(500, '<h2>Unable to verify Google connection.</h2>');
      }

      const states = await stateResponse.json();

      if (!states.length) {
        return html(
          400,
          '<h2>Google connection expired or invalid.</h2><p>Please start the connection again.</p>'
        );
      }

      const oauthState = states[0];
      const salonId = oauthState.salon_id;
      const businessId = oauthState.business_id;

      /*
       * Mark state as consumed before exchanging the code.
       * This prevents replay of the same OAuth state.
       */
      const usedAt = new Date().toISOString();

      const markUsedResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/google_oauth_states?id=eq.${encodeURIComponent(oauthState.id)}&used_at=is.null`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            used_at: usedAt
          })
        }
      );

      if (!markUsedResponse.ok) {
        console.error(
          'Unable to consume OAuth state:',
          await markUsedResponse.text()
        );
        return html(500, '<h2>Unable to secure Google connection.</h2>');
      }

      /*
       * Exchange Google's one-time authorization code.
       */
      const tokenResponse = await fetch(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code'
          })
        }
      );

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error(
          'Google token exchange failed:',
          tokenData.error || tokenData.error_description || 'unknown error'
        );

        return html(
          400,
          '<h2>Google token exchange failed.</h2><p>Please start the connection again.</p>'
        );
      }

      /*
       * Identify the Google account that authorized STore Automation.
       * This is the OAuth identity only; it is NOT used to select
       * a Business Profile.
       */
      let googleAccountId = null;
      let googleAccountEmail = null;

      if (tokenData.access_token) {
        const userInfoResponse = await fetch(
          'https://openidconnect.googleapis.com/v1/userinfo',
          {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`
            }
          }
        );

        const userInfo = await userInfoResponse.json();

        if (!userInfoResponse.ok) {
          console.error(
            'Google user identity lookup failed:',
            userInfo.error || userInfo
          );

          return html(
            400,
            '<h2>Unable to identify the Google account.</h2><p>Please reconnect Google Business.</p>'
          );
        }

        googleAccountId = userInfo.sub || null;
        googleAccountEmail = userInfo.email || null;
      }

      console.log(
        'Google OAuth account:',
        googleAccountEmail || 'email unavailable'
      );

      if (!tokenData.refresh_token) {
        console.error('Google did not return a refresh token');

        return html(
          400,
          '<h2>Google did not provide a refresh token.</h2><p>Please reconnect and grant offline access.</p>'
        );
      }

      /*
       * Calculate access-token expiry.
       */
      const tokenExpiresAt = tokenData.expires_in
        ? new Date(
            Date.now() + Number(tokenData.expires_in) * 1000
          ).toISOString()
        : null;

      const now = new Date().toISOString();

      /*
       * NEW FLOW: Store connection in google_connections (business model).
       */
      if (businessId) {
        const googleConnection = {
          business_id: businessId,
          google_account_id: googleAccountId,
          google_account_email: googleAccountEmail,
          access_token: tokenData.access_token || null,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenExpiresAt,
          scope: tokenData.scope || null,
          authorization_status: 'authorized',
          connection_status: 'owner_authorized',
          owner_authorized_at: now,
          last_error: null,
          updated_at: now
        };

        const businessConnResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/google_connections?on_conflict=business_id`,
          {
            method: 'POST',
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(googleConnection)
          }
        );

        if (!businessConnResponse.ok) {
          const detail = await businessConnResponse.text();
          console.error(
            'Google connection (business) storage failed:',
            detail
          );
          return html(
            500,
            '<h2>Google was authorized, but the connection could not be saved.</h2>'
          );
        }

        console.log(
          'Google Business connection saved for business:',
          businessId
        );
      }

      /*
       * LEGACY FLOW: Store connection in google_business_connections (salon model).
       * Maintains backward compatibility.
       */
      if (salonId) {
        const salonConnection = {
          salon_id: salonId,
          google_account_id: googleAccountId,
          google_account_email: googleAccountEmail,
          access_token: tokenData.access_token || null,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenExpiresAt,
          scope: tokenData.scope || null,
          connection_status: 'owner_authorized',
          owner_authorized_at: now,
          store_manager_invitation_status: 'not_started',
          last_error: null,
          updated_at: now
        };

        const salonConnResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/google_business_connections?on_conflict=salon_id`,
          {
            method: 'POST',
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(salonConnection)
          }
        );

        if (!salonConnResponse.ok) {
          const detail = await salonConnResponse.text();
          console.error(
            'Google connection (salon) storage failed:',
            detail
          );
          return html(
            500,
            '<h2>Google was authorized, but the connection could not be saved.</h2>'
          );
        }

        console.log(
          'Google Business connection saved for salon:',
          salonId
        );
      }

      /*
       * Universal business flow:
       * Return the user to STore Automation after OAuth.
       *
       * The frontend will then call /api/google-business-locations
       * using the authenticated Supabase session. That endpoint
       * performs the exact Google Place ID -> GBP location match.
       */
      if (businessId) {
        const redirectUrl =
          `/?google_connected=1&business_id=${encodeURIComponent(businessId)}`;

        return new Response(null, {
          status: 302,
          headers: {
            Location: redirectUrl,
            'cache-control': 'no-store'
          }
        });
      }

      return html(
        200,
        `
        <html>
          <head>
            <title>Google Business Connected</title>
          </head>
          <body style="font-family:Arial,sans-serif;padding:40px">
            <h2>✅ Google Business connected</h2>
            <p>Your Google Business connection has been securely saved.</p>
            <p>You can close this window and return to STore Automation.</p>
          </body>
        </html>
        `
      );

    } catch (error) {
      console.error('Google callback error:', error);

      return html(
        500,
        '<h2>Google connection failed.</h2><p>An unexpected server error occurred.</p>'
      );
    }
  }
};

function html(status, body) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
