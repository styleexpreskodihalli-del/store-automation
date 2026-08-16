const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const STORE_GOOGLE_MANAGER_EMAIL =
  process.env.STORE_GOOGLE_MANAGER_EMAIL;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }

      if (!STORE_GOOGLE_MANAGER_EMAIL) {
        return json({
          error: 'STore Google manager email is not configured'
        }, 500);
      }

      const authHeader =
        request.headers.get('authorization');

      if (!authHeader?.startsWith('Bearer ')) {
        return json({
          error: 'Missing Supabase authorization'
        }, 401);
      }

      const supabaseAccessToken =
        authHeader.slice(7);

      const userResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization:
              `Bearer ${supabaseAccessToken}`
          }
        }
      );

      if (!userResponse.ok) {
        return json({
          error: 'Invalid Supabase session'
        }, 401);
      }

      const user = await userResponse.json();

      const body =
        await request.json().catch(() => null);

      if (!body?.business_id) {
        return json({
          error: 'Business ID is required'
        }, 400);
      }

      const businessId = body.business_id;

      /*
       * Verify that the authenticated STore user
       * belongs to this Business.
       */
      const memberResponse = await supabaseFetch(
        `/rest/v1/business_users` +
        `?business_id=eq.${encodeURIComponent(businessId)}` +
        `&user_id=eq.${encodeURIComponent(user.id)}` +
        `&select=business_id,role` +
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

      const members =
        await memberResponse.json();

      if (!members.length) {
        return json({
          error:
            'You are not authorized to manage this business'
        }, 403);
      }

      /*
       * Load the verified Google Business Profile connection.
       */
      const connectionResponse =
        await supabaseFetch(
          `/rest/v1/google_connections` +
          `?business_id=eq.${encodeURIComponent(businessId)}` +
          `&select=id,business_id,business_profile_account_id,business_profile_location_id,business_profile_location_name,access_token,refresh_token,token_expires_at,authorization_status,access_status,connection_status` +
          `&limit=1`
        );

      if (!connectionResponse.ok) {
        console.error(
          'Google connection lookup failed:',
          await connectionResponse.text()
        );

        return json({
          error:
            'Unable to load Google Business connection'
        }, 500);
      }

      const connections =
        await connectionResponse.json();

      if (!connections.length) {
        return json({
          error:
            'Google Business is not connected'
        }, 404);
      }

      const connection = connections[0];

      if (
        connection.access_status !== 'verified' ||
        connection.connection_status !== 'location_selected' ||
        !connection.business_profile_location_id
      ) {
        return json({
          error:
            'The Google Business Profile listing has not been verified yet'
        }, 409);
      }

      if (!connection.refresh_token) {
        return json({
          error:
            'Google connection is missing a refresh token'
        }, 400);
      }

      /*
       * Refresh the Google access token if required.
       */
      let accessToken =
        connection.access_token;

      const expiresAt =
        connection.token_expires_at
          ? new Date(
              connection.token_expires_at
            ).getTime()
          : 0;

      const needsRefresh =
        !accessToken ||
        !expiresAt ||
        expiresAt <=
          Date.now() + 60 * 1000;

      if (needsRefresh) {
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
                client_id:
                  GOOGLE_CLIENT_ID,
                client_secret:
                  GOOGLE_CLIENT_SECRET,
                refresh_token:
                  connection.refresh_token,
                grant_type:
                  'refresh_token'
              })
            }
          );

        const tokenData =
          await tokenResponse.json();

        if (
          !tokenResponse.ok ||
          !tokenData.access_token
        ) {
          console.error(
            'Google token refresh failed:',
            tokenData
          );

          await updateConnection(
            salonId,
            {
              connection_status:
                'error',
              last_error:
                'Google access token refresh failed',
              updated_at:
                new Date().toISOString()
            }
          );

          return json({
            error:
              'Google authorization has expired. Please reconnect Google Business.'
          }, 401);
        }

        accessToken =
          tokenData.access_token;

        const newExpiresAt =
          tokenData.expires_in
            ? new Date(
                Date.now() +
                Number(tokenData.expires_in) *
                  1000
              ).toISOString()
            : null;

        await updateConnection(
          businessId,
          {
            access_token:
              accessToken,
            token_expires_at:
              newExpiresAt,
            connection_status:
              'location_selected',
            last_error: null,
            updated_at:
              new Date().toISOString()
          }
        );
      }

      /*
       * Google expects:
       *
       * POST
       * /v1/locations/{locationId}/admins
       *
       * with the invitee email and MANAGER role.
       */
      const locationId =
        connection.business_profile_location_id;

      if (!locationId.startsWith('locations/')) {
        return json({
          error:
            'Invalid Google Business location ID'
        }, 400);
      }

      const inviteUrl =
        `https://mybusinessaccountmanagement.googleapis.com/v1/${locationId}/admins`;

      const inviteResponse =
        await fetch(inviteUrl, {
          method: 'POST',
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            admin:
              STORE_GOOGLE_MANAGER_EMAIL,
            role: 'MANAGER'
          })
        });

      const inviteData =
        await inviteResponse.json();

      if (!inviteResponse.ok) {
        console.error(
          'Google manager invitation failed:',
          inviteData
        );

        await updateConnection(
          businessId,
          {
            store_manager_email:
              STORE_GOOGLE_MANAGER_EMAIL,
            store_manager_invitation_status:
              'error',
            last_error:
              'Google manager invitation failed',
            updated_at:
              new Date().toISOString()
          }
        );

        return json({
          error:
            'Unable to send STore Google manager invitation',
          google_status:
            inviteResponse.status,
          details:
            inviteData.error?.message ||
            inviteData.error ||
            null
        }, 502);
      }

      /*
       * Google accepted the invitation request.
       * It may still be pending acceptance.
       */
      const invitationId =
        inviteData.name || null;

      await updateConnection(
        salonId,
        {
          store_manager_email:
            STORE_GOOGLE_MANAGER_EMAIL,
          store_manager_invitation_status:
            inviteData.pendingInvitation
              ? 'awaiting_acceptance'
              : 'invitation_sent',
          store_manager_invitation_id:
            invitationId,
          store_manager_invited_at:
            new Date().toISOString(),
          connection_status:
            'awaiting_acceptance',
          last_error: null,
          updated_at:
            new Date().toISOString()
        }
      );

      return json({
        success: true,
        status:
          inviteData.pendingInvitation
            ? 'awaiting_acceptance'
            : 'invitation_sent',
        store_manager_email:
          STORE_GOOGLE_MANAGER_EMAIL,
        invitation_id:
          invitationId,
        business_id:
          businessId,
        business_profile_location_id:
          locationId,
        business_profile_location_name:
          connection.business_profile_location_name
      });

    } catch (error) {
      console.error(
        'Google manager invitation error:',
        error
      );

      return json({
        error:
          'Unable to send STore Google manager invitation'
      }, 500);
    }
  }
};

async function supabaseFetch(
  path,
  options = {}
) {
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

async function updateConnection(
  businessId,
  values
) {
  const response =
    await supabaseFetch(
      `/rest/v1/google_connections` +
      `?business_id=eq.${encodeURIComponent(businessId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type':
            'application/json',
          Prefer:
            'return=minimal'
        },
        body:
          JSON.stringify(values)
      }
    );

  if (!response.ok) {
    console.error(
      'Google connection update failed:',
      await response.text()
    );
  }
}

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
