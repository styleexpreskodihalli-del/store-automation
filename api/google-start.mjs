import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405);
      }

      const authHeader = request.headers.get('authorization') || '';

      if (!authHeader.startsWith('Bearer ')) {
        return json({ error: 'Missing Supabase authorization' }, 401);
      }

      const accessToken = authHeader.slice(7);

      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return json({ error: 'Supabase server configuration missing' }, 500);
      }

      // Validate the currently logged-in STore Automation user.
      const userResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!userResponse.ok) {
        return json({ error: 'Invalid Supabase session' }, 401);
      }

      const user = await userResponse.json();

      // Find the salon belonging to this logged-in user.
      const membershipResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/salon_members?select=salon_id,role&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );

      if (!membershipResponse.ok) {
        return json({ error: 'Unable to find salon membership' }, 500);
      }

      const memberships = await membershipResponse.json();

      if (!memberships.length) {
        return json({ error: 'No salon membership found' }, 403);
      }

      const salonId = memberships[0].salon_id;

      // Generate a cryptographically random one-time state.
      const state = crypto.randomBytes(32).toString('hex');

      const stateHash = crypto
        .createHash('sha256')
        .update(state)
        .digest('hex');

      const expiresAt = new Date(
        Date.now() + 10 * 60 * 1000
      ).toISOString();

      // Store only the hash, never the raw state.
      const stateResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/google_oauth_states`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({
            salon_id: salonId,
            state_hash: stateHash,
            expires_at: expiresAt
          })
        }
      );

      if (!stateResponse.ok) {
        const detail = await stateResponse.text();
        console.error('OAuth state insert failed:', detail);
        return json({ error: 'Unable to initialize Google connection' }, 500);
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        return json({ error: 'Google OAuth configuration missing' }, 500);
      }

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'select_account consent',
        include_granted_scopes: 'true',
        state,
        scope: 'openid email https://www.googleapis.com/auth/business.manage'
      });

      const authorizationUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      return json({
        authorizationUrl
      });

    } catch (error) {
      console.error('Google start error:', error);
      return json({ error: 'Unable to start Google connection' }, 500);
    }
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}
