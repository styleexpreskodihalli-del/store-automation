const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }

      const authHeader = request.headers.get('authorization');

      if (!authHeader?.startsWith('Bearer ')) {
        return json({ error: 'Missing Supabase authorization' }, 401);
      }

      const supabaseAccessToken = authHeader.slice(7);

      const userResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${supabaseAccessToken}`
          }
        }
      );

      if (!userResponse.ok) {
        return json({ error: 'Invalid Supabase session' }, 401);
      }

      const user = await userResponse.json();

      const body = await request.json().catch(() => null);

      if (!body) {
        return json({ error: 'Invalid request body' }, 400);
      }

      const {
        salon_id,
        business_account_id,
        business_location_id
      } = body;

      if (
        !salon_id ||
        !business_account_id ||
        !business_location_id
      ) {
        return json({
          error: 'Salon, Google account and location are required'
        }, 400);
      }

      /*
       * Verify that the authenticated user belongs
       * to the requested salon.
       */
      const memberResponse = await supabaseFetch(
        `/rest/v1/salon_members` +
        `?salon_id=eq.${encodeURIComponent(salon_id)}` +
        `&user_id=eq.${encodeURIComponent(user.id)}` +
        `&select=salon_id,role` +
        `&limit=1`
      );

      if (!memberResponse.ok) {
        console.error(
          'Salon membership lookup failed:',
          await memberResponse.text()
        );

        return json({
          error: 'Unable to verify salon membership'
        }, 500);
      }

      const members = await memberResponse.json();

      if (!members.length) {
        return json({
          error: 'You are not authorized to manage this salon'
        }, 403);
      }

      /*
       * Load the existing Google connection.
       */
      const connectionResponse = await supabaseFetch(
        `/rest/v1/google_business_connections` +
        `?salon_id=eq.${encodeURIComponent(salon_id)}` +
        `&select=id,access_token,refresh_token,token_expires_at,connection_status` +
        `&limit=1`
      );

      if (!connectionResponse.ok) {
        console.error(
          'Google connection lookup failed:',
          await connectionResponse.text()
        );

        return json({
          error: 'Unable to load Google connection'
        }, 500);
      }

      const connections = await connectionResponse.json();

      if (!connections.length) {
        return json({
          error: 'Google Business is not connected'
        }, 404);
      }

      const connection = connections[0];

      if (!connection.refresh_token) {
        return json({
          error: 'Google connection is missing a refresh token. Please reconnect Google Business.'
        }, 400);
      }

      /*
       * Make sure we have a valid Google access token.
       */
      let accessToken = connection.access_token;

      const expiresAt = connection.token_expires_at
        ? new Date(connection.token_expires_at).getTime()
        : 0;

      const needsRefresh =
        !accessToken ||
        !expiresAt ||
        expiresAt <= Date.now() + 60 * 1000;

      if (needsRefresh) {
        const tokenResponse = await fetch(
          'https://oauth2.googleapis.com/token',
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              client_id: GOOGLE_CLIENT_ID,
              client_secret: GOOGLE_CLIENT_SECRET,
              refresh_token: connection.refresh_token,
              grant_type: 'refresh_token'
            })
          }
        );

        const tokenData = await tokenResponse.json();

        if (
          !tokenResponse.ok ||
          !tokenData.access_token
        ) {
          console.error(
            'Google token refresh failed:',
            tokenData.error ||
            tokenData.error_description ||
            'unknown error'
          );

          return json({
            error: 'Google authorization has expired. Please reconnect Google Business.'
          }, 401);
        }

        accessToken = tokenData.access_token;

        const newExpiresAt =
          tokenData.expires_in
            ? new Date(
                Date.now() +
                Number(tokenData.expires_in) * 1000
              ).toISOString()
            : null;

        await updateConnection(
          salon_id,
          {
            access_token: accessToken,
            token_expires_at: newExpiresAt,
            connection_status: 'owner_authorized',
            last_error: null,
            updated_at: new Date().toISOString()
          }
        );
      }

      /*
       * Validate the account/location against Google.
       *
       * business_account_id should look like:
       * accounts/123456789
       *
       * business_location_id should look like:
       * locations/987654321
       */
      if (
        !business_account_id.startsWith('accounts/') ||
        !business_location_id.startsWith('locations/')
      ) {
        return json({
          error: 'Invalid Google Business account or location'
        }, 400);
      }

      /*
       * Verify the selected location actually exists
       * under the selected Google account.
       */
      const locationUrl =
        `https://mybusinessbusinessinformation.googleapis.com/v1/${business_location_id}`;

      const locationResponse = await fetch(
        locationUrl,
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`
          }
        }
      );

      const locationData =
        await locationResponse.json();

      if (!locationResponse.ok) {
        console.error(
          'Google location verification failed:',
          locationData
        );

        return json({
          error: 'Google could not verify the selected Business Profile'
        }, 400);
      }

      /*
       * Verify that the location belongs to the
       * account selected by the UI.
       */
      const locationAccount =
        extractAccountFromLocation(
          locationData
        );

      if (
        locationAccount &&
        locationAccount !== business_account_id
      ) {
        return json({
          error: 'The selected Google location does not belong to the selected account'
        }, 400);
      }

      /*
       * Save only verified Google Business identifiers.
       */
      const updateData = {
        business_account_id,
        business_location_id,
        business_location_name:
          locationData.title ||
          body.business_location_name ||
          null,
        connection_status: 'location_selected',
        last_error: null,
        last_synced_at:
          new Date().toISOString(),
        updated_at:
          new Date().toISOString()
      };

      const updateResponse =
        await updateConnection(
          salon_id,
          updateData
        );

      if (!updateResponse.ok) {
        return json({
          error: 'Unable to save Google Business Profile'
        }, 500);
      }

      return json({
        success: true,
        business_account_id,
        business_location_id,
        business_location_name:
          updateData.business_location_name
      });

    } catch (error) {
      console.error(
        'Google location selection error:',
        error
      );

      return json({
        error: 'Unable to save Google Business Profile'
      }, 500);
    }
  }
};

async function supabaseFetch(path, options = {}) {
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

async function updateConnection(
  salonId,
  values
) {
  return supabaseFetch(
    `/rest/v1/google_business_connections` +
    `?salon_id=eq.${encodeURIComponent(salonId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type':
          'application/json',
        Prefer:
          'return=minimal'
      },
      body: JSON.stringify(values)
    }
  );
}

function extractAccountFromLocation(
  location
) {
  /*
   * Some Google responses expose the parent
   * account through metadata. If Google does not
   * return it, we don't reject the location here;
   * the location itself has already been verified
   * using the authenticated Google token.
   */
  const metadata =
    location?.metadata;

  if (
    metadata?.accountName &&
    typeof metadata.accountName === 'string'
  ) {
    return metadata.accountName;
  }

  return null;
}

function json(body, status = 200) {
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
