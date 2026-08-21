import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET;

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_CUSTOMER_REDIRECT_URI ||
  process.env.GOOGLE_REDIRECT_URI;

function html(status, body) {
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>STall Store Automation</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:Arial,sans-serif;padding:40px;background:#07100d;color:#fff">
${body}
</body>
</html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      const code =
        url.searchParams.get('code');

      const state =
        url.searchParams.get('state');

      const oauthError =
        url.searchParams.get('error');

      if (oauthError) {
        return html(
          400,
          `
          <h2>Google authorization was cancelled</h2>
          <p>${escapeHtml(oauthError)}</p>
          <p>You can close this window and return to STall.</p>
          `
        );
      }

      if (!code || !state) {
        return html(
          400,
          `
          <h2>Google connection could not be completed</h2>
          <p>Missing authorization information.</p>
          `
        );
      }

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY ||
        !GOOGLE_CLIENT_ID ||
        !GOOGLE_CLIENT_SECRET ||
        !GOOGLE_REDIRECT_URI
      ) {
        console.error(
          'Customer Google callback configuration missing'
        );

        return html(
          500,
          '<h2>Google connection is not configured.</h2>'
        );
      }

      /*
       * Hash the OAuth state.
       */
      const stateHash =
        crypto
          .createHash('sha256')
          .update(state)
          .digest('hex');

      /*
       * Find the customer onboarding state.
       *
       * IMPORTANT:
       * We explicitly require onboarding_id.
       * This prevents an admin/universal OAuth state
       * from accidentally entering the customer flow.
       */
      const stateResponse =
        await fetch(
          `${SUPABASE_URL}/rest/v1/google_oauth_states` +
          `?state_hash=eq.${encodeURIComponent(stateHash)}` +
          `&used_at=is.null` +
          `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
          `&onboarding_id=not.is.null` +
          `&select=id,onboarding_id,customer_name,customer_email,customer_phone` +
          `&limit=1`,
          {
            headers: {
              apikey:
                SUPABASE_SERVICE_ROLE_KEY,
              Authorization:
                `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            }
          }
        );

      if (!stateResponse.ok) {
        console.error(
          'Customer OAuth state lookup failed:',
          await stateResponse.text()
        );

        return html(
          500,
          '<h2>Unable to verify Google connection.</h2>'
        );
      }

      const states =
        await stateResponse.json();

      if (!states.length) {
        return html(
          400,
          `
          <h2>Google connection expired</h2>
          <p>Please return to STall and start the onboarding process again.</p>
          `
        );
      }

      const oauthState =
        states[0];

      /*
       * Consume the state before exchanging the code.
       * This prevents replay attacks.
       */
      const usedAt =
        new Date().toISOString();

      const markUsedResponse =
        await fetch(
          `${SUPABASE_URL}/rest/v1/google_oauth_states` +
          `?id=eq.${encodeURIComponent(oauthState.id)}` +
          `&used_at=is.null`,
          {
            method: 'PATCH',
            headers: {
              apikey:
                SUPABASE_SERVICE_ROLE_KEY,
              Authorization:
                `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              used_at: usedAt
            })
          }
        );

      if (!markUsedResponse.ok) {
        console.error(
          'Unable to consume customer OAuth state:',
          await markUsedResponse.text()
        );

        return html(
          500,
          '<h2>Unable to secure Google connection.</h2>'
        );
      }

      /*
       * Exchange Google's authorization code.
       */
      const tokenResponse =
        await fetch(
          'https://oauth2.googleapis.com/token',
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              code,
              client_id:
                GOOGLE_CLIENT_ID,
              client_secret:
                GOOGLE_CLIENT_SECRET,
              redirect_uri:
                GOOGLE_REDIRECT_URI,
              grant_type:
                'authorization_code'
            })
          }
        );

      const tokenData =
        await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error(
          'Customer Google token exchange failed:',
          tokenData
        );

        return html(
          400,
          `
          <h2>Google connection failed</h2>
          <p>Please return to STall and try again.</p>
          `
        );
      }

      /*
       * Confirm Business Profile permission.
       */
      const requiredScope =
        'https://www.googleapis.com/auth/business.manage';

      const grantedScopes =
        String(tokenData.scope || '')
          .split(/\s+/)
          .filter(Boolean);

      if (!grantedScopes.includes(requiredScope)) {
        console.error(
          'Customer Google Business scope missing:',
          grantedScopes
        );

        return html(
          403,
          `
          <h2>Business Profile permission required</h2>
          <p>
            Please reconnect Google and allow STall Store Automation
            to access your Business Profile.
          </p>
          `
        );
      }

      /*
       * Identify the Google account.
       */
      let googleAccountId = null;
      let googleAccountEmail = null;

      if (tokenData.access_token) {
        const userInfoResponse =
          await fetch(
            'https://openidconnect.googleapis.com/v1/userinfo',
            {
              headers: {
                Authorization:
                  `Bearer ${tokenData.access_token}`
              }
            }
          );

        const userInfo =
          await userInfoResponse.json();

        if (!userInfoResponse.ok) {
          console.error(
            'Google identity lookup failed:',
            userInfo
          );

          return html(
            400,
            `
            <h2>Unable to identify Google account</h2>
            <p>Please reconnect Google Business.</p>
            `
          );
        }

        googleAccountId =
          userInfo.sub || null;

        googleAccountEmail =
          userInfo.email || null;
      }

      if (!googleAccountId) {
        return html(
          400,
          '<h2>Unable to identify your Google account.</h2>'
        );
      }

      /*
       * Customer onboarding requires offline access so STall
       * can continue working with the Business Profile later.
       */
      if (!tokenData.refresh_token) {
        console.error(
          'Google did not return refresh token'
        );

        return html(
          400,
          `
          <h2>Google authorization incomplete</h2>
          <p>
            Google did not provide the required offline access.
            Please reconnect and approve the requested permissions.
          </p>
          `
        );
      }

      const tokenExpiresAt =
        tokenData.expires_in
          ? new Date(
              Date.now() +
              Number(tokenData.expires_in) * 1000
            ).toISOString()
          : null;

      /*
       * IMPORTANT:
       *
       * We are NOT writing to google_connections yet.
       *
       * There is no business_id yet.
       *
       * The next onboarding step will use this authorized
       * Google connection to discover the customer's Business
       * Profiles and let the customer select the correct one.
       *
       * Store the OAuth result back against the onboarding state.
       */
      const updateResponse =
        await fetch(
          `${SUPABASE_URL}/rest/v1/google_oauth_states` +
          `?id=eq.${encodeURIComponent(oauthState.id)}`,
          {
            method: 'PATCH',
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
            body: JSON.stringify({
              google_account_id:
                googleAccountId,
              google_account_email:
                googleAccountEmail,
              google_access_token:
                tokenData.access_token || null,
              google_refresh_token:
                tokenData.refresh_token,
              google_token_expires_at:
                tokenExpiresAt,
              google_scope:
                tokenData.scope || null
            })
          }
        );

      if (!updateResponse.ok) {
        const detail =
          await updateResponse.text();

        console.error(
          'Customer Google authorization storage failed:',
          detail
        );

        return html(
          500,
          `
          <h2>Google was authorized but could not be saved</h2>
          <p>Please return to STall and try again.</p>
          `
        );
      }

      /*
       * Return to the new customer onboarding page.
       *
       * Only the non-sensitive onboarding ID is placed
       * in the URL.
       */
      const redirectUrl =
        `/onboarding.html?google_connected=1&onboarding_id=${encodeURIComponent(
          oauthState.onboarding_id
        )}`;

      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl,
          'cache-control': 'no-store'
        }
      });

    } catch (error) {
      console.error(
        'Customer Google callback error:',
        error
      );

      return html(
        500,
        `
        <h2>Google connection failed</h2>
        <p>
          An unexpected error occurred.
          Please return to STall and try again.
        </p>
        `
      );
    }
  }
};
