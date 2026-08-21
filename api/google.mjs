import crypto from 'node:crypto';

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET;

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI;

const STORE_GOOGLE_MANAGER_EMAIL =
  process.env.STORE_GOOGLE_MANAGER_EMAIL;


/* =========================================================
   RESPONSE HELPERS
========================================================= */

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
          'application/json; charset=utf-8',

        'cache-control':
          'no-store'
      }
    }
  );
}


function html(
  status,
  body
) {
  return new Response(
    body,
    {
      status,
      headers: {
        'content-type':
          'text/html; charset=utf-8',

        'cache-control':
          'no-store'
      }
    }
  );
}


function escapeHtml(
  value
) {
  return String(
    value || ''
  )
    .replaceAll(
      '&',
      '&amp;'
    )
    .replaceAll(
      '<',
      '&lt;'
    )
    .replaceAll(
      '>',
      '&gt;'
    )
    .replaceAll(
      '"',
      '&quot;'
    )
    .replaceAll(
      "'",
      '&#039;'
    );
}


/* =========================================================
   SUPABASE SERVICE REQUEST
========================================================= */

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


/* =========================================================
   GOOGLE OAUTH START
========================================================= */

async function googleStart(
  request
) {

  if (
    request.method !== 'GET'
  ) {
    return json(
      {
        error:
          'Method not allowed'
      },
      405
    );
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !SUPABASE_PUBLISHABLE_KEY
  ) {
    return json(
      {
        error:
          'Supabase server configuration missing'
      },
      500
    );
  }

  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_REDIRECT_URI
  ) {
    return json(
      {
        error:
          'Google OAuth configuration missing'
      },
      500
    );
  }

  /*
   * Validate logged-in STall user.
   */

  const authHeader =
    request.headers.get(
      'authorization'
    ) || '';

  if (
    !authHeader.startsWith(
      'Bearer '
    )
  ) {
    return json(
      {
        error:
          'Missing Supabase authorization'
      },
      401
    );
  }

  const accessToken =
    authHeader.slice(7);

  const userResponse =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

  if (
    !userResponse.ok
  ) {
    return json(
      {
        error:
          'Invalid Supabase session'
      },
      401
    );
  }

  const user =
    await userResponse.json();

  const url =
    new URL(
      request.url
    );

  const businessId =
    url.searchParams.get(
      'business_id'
    );

  let targetBusinessId =
    null;

  /*
   * Universal Business flow.
   */

  if (
    businessId
  ) {

    targetBusinessId =
      businessId;

    const membershipResponse =
      await supabaseFetch(
        `/rest/v1/business_users?` +
        `business_id=eq.${encodeURIComponent(
          businessId
        )}&` +
        `user_id=eq.${encodeURIComponent(
          user.id
        )}&` +
        `select=id,role&limit=1`
      );

    if (
      !membershipResponse.ok
    ) {
      return json(
        {
          error:
            'Unable to verify business membership'
        },
        500
      );
    }

    const memberships =
      await membershipResponse.json();

    if (
      !memberships.length
    ) {
      return json(
        {
          error:
            'You are not authorized to manage this business'
        },
        403
      );
    }

    console.log(
      'OAuth flow initiated for business:',
      {
        business_id:
          businessId,

        user_id:
          user.id,

        user_role:
          memberships[0].role
      }
    );
  }

  /*
   * Generate cryptographically secure state.
   */

  const state =
    crypto.randomBytes(
      32
    ).toString(
      'hex'
    );

  const stateHash =
    crypto
      .createHash(
        'sha256'
      )
      .update(
        state
      )
      .digest(
        'hex'
      );

  const expiresAt =
    new Date(
      Date.now() +
      10 *
      60 *
      1000
    ).toISOString();

  /*
   * Store only state hash.
   */

  const stateBody = {
    state_hash:
      stateHash,

    expires_at:
      expiresAt
  };

  if (
    targetBusinessId
  ) {
    stateBody.business_id =
      targetBusinessId;
  }

  const stateResponse =
    await supabaseFetch(
      `/rest/v1/google_oauth_states`,
      {
        method:
          'POST',

        headers: {
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
      'OAuth state insert failed:',
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
   * Google OAuth authorization URL.
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

  return json({
    authorizationUrl
  });
}


/* =========================================================
   GOOGLE OAUTH CALLBACK
========================================================= */

async function googleCallback(
  request
) {

  const url =
    new URL(
      request.url
    );

  const code =
    url.searchParams.get(
      'code'
    );

  const state =
    url.searchParams.get(
      'state'
    );

  const error =
    url.searchParams.get(
      'error'
    );

  if (
    error
  ) {
    return html(
      400,
      `
      <h2>Google authorization failed</h2>
      <p>${escapeHtml(error)}</p>
      `
    );
  }

  if (
    !code ||
    !state
  ) {
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
    console.error(
      'Missing required OAuth environment variables'
    );

    return html(
      500,
      '<h2>Google connection is not configured.</h2>'
    );
  }

  /*
   * Hash raw OAuth state.
   */

  const stateHash =
    crypto
      .createHash(
        'sha256'
      )
      .update(
        state
      )
      .digest(
        'hex'
      );

  /*
   * Find unused, non-expired state.
   */

  const stateResponse =
    await supabaseFetch(
      `/rest/v1/google_oauth_states` +
      `?state_hash=eq.${encodeURIComponent(
        stateHash
      )}` +
      `&used_at=is.null` +
      `&expires_at=gt.${encodeURIComponent(
        new Date().toISOString()
      )}` +
      `&select=id,business_id` +
      `&limit=1`
    );

  if (
    !stateResponse.ok
  ) {

    console.error(
      'OAuth state lookup failed:',
      await stateResponse.text()
    );

    return html(
      500,
      '<h2>Unable to verify Google connection.</h2>'
    );
  }

  const states =
    await stateResponse.json();

  if (
    !Array.isArray(states) ||
    !states.length
  ) {
    return html(
      400,
      `
      <h2>Google connection expired or invalid.</h2>
      <p>Please start the connection again.</p>
      `
    );
  }

  const oauthState =
    states[0];

  const businessId =
    oauthState.business_id;

  /*
   * Consume state before code exchange.
   */

  const usedAt =
    new Date().toISOString();

  const markUsedResponse =
    await supabaseFetch(
      `/rest/v1/google_oauth_states` +
      `?id=eq.${encodeURIComponent(
        oauthState.id
      )}` +
      `&used_at=is.null`,
      {
        method:
          'PATCH',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            used_at:
              usedAt
          })
      }
    );

  if (
    !markUsedResponse.ok
  ) {

    console.error(
      'Unable to consume OAuth state:',
      await markUsedResponse.text()
    );

    return html(
      500,
      '<h2>Unable to secure Google connection.</h2>'
    );
  }

  /*
   * Exchange Google authorization code.
   */

  const tokenResponse =
    await fetch(
      'https://oauth2.googleapis.com/token',
      {
        method:
          'POST',

        headers: {
          'content-type':
            'application/x-www-form-urlencoded'
        },

        body:
          new URLSearchParams({
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
    await tokenResponse
      .json()
      .catch(
        () => ({})
      );

  if (
    !tokenResponse.ok
  ) {

    console.error(
      'Google token exchange failed:',
      tokenData.error ||
      tokenData.error_description ||
      'unknown error'
    );

    return html(
      400,
      `
      <h2>Google token exchange failed.</h2>
      <p>Please start the connection again.</p>
      `
    );
  }

  /*
   * Verify Business Profile scope.
   */

  const requiredGoogleScope =
    'https://www.googleapis.com/auth/business.manage';

  const grantedScopes =
    String(
      tokenData.scope ||
      ''
    )
      .split(/\s+/)
      .filter(Boolean);

  console.log(
    'Google OAuth granted scopes:',
    JSON.stringify({
      scopes:
        grantedScopes,

      hasBusinessManage:
        grantedScopes.includes(
          requiredGoogleScope
        )
    })
  );

  if (
    !grantedScopes.includes(
      requiredGoogleScope
    )
  ) {

    return html(
      403,
      `
      <h2>Google Business Profile permission required.</h2>
      <p>
        This Google account was connected, but Business Profile
        access was not granted.
      </p>
      <p>
        Please reconnect Google and approve Business Profile access.
      </p>
      `
    );
  }

  /*
   * Identify Google account.
   */

  let googleAccountId =
    null;

  let googleAccountEmail =
    null;

  if (
    tokenData.access_token
  ) {

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
      await userInfoResponse
        .json()
        .catch(
          () => ({})
        );

    if (
      !userInfoResponse.ok
    ) {

      console.error(
        'Google user identity lookup failed:',
        userInfo
      );

      return html(
        400,
        `
        <h2>Unable to identify the Google account.</h2>
        <p>Please reconnect Google Business.</p>
        `
      );
    }

    googleAccountId =
      userInfo.sub ||
      null;

    googleAccountEmail =
      userInfo.email ||
      null;
  }

  console.log(
    'Google OAuth account:',
    googleAccountEmail ||
    'email unavailable'
  );

  if (
    !tokenData.refresh_token
  ) {

    console.error(
      'Google did not return a refresh token'
    );

    return html(
      400,
      `
      <h2>Google did not provide a refresh token.</h2>
      <p>
        Please reconnect and grant offline access.
      </p>
      `
    );
  }

  /*
   * Token expiry.
   */

  const tokenExpiresAt =
    tokenData.expires_in
      ? new Date(
          Date.now() +
          Number(
            tokenData.expires_in
          ) *
          1000
        ).toISOString()
      : null;

  const now =
    new Date().toISOString();

  /*
   * Business connection.
   *
   * business_id is required for the universal
   * business flow.
   */

  if (
    businessId
  ) {

    const googleConnection = {

      business_id:
        businessId,

      google_account_id:
        googleAccountId,

      google_account_email:
        googleAccountEmail,

      access_token:
        tokenData.access_token ||
        null,

      refresh_token:
        tokenData.refresh_token,

      token_expires_at:
        tokenExpiresAt,

      scope:
        tokenData.scope ||
        null,

      authorization_status:
        'authorized',

      connection_status:
        'owner_authorized',

      owner_authorized_at:
        now,

      last_error:
        null,

      updated_at:
        now
    };

    const businessConnResponse =
      await supabaseFetch(
        `/rest/v1/google_connections?on_conflict=business_id`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            Prefer:
              'resolution=merge-duplicates,return=minimal'
          },

          body:
            JSON.stringify(
              googleConnection
            )
        }
      );

    if (
      !businessConnResponse.ok
    ) {

      const detail =
        await businessConnResponse.text();

      console.error(
        'Google connection storage failed:',
        detail
      );

      return html(
        500,
        `
        <h2>
          Google was authorized, but the connection could not be saved.
        </h2>
        `
      );
    }

    console.log(
      'Google Business connection saved for business:',
      businessId
    );

    /*
     * Preserve existing universal business redirect.
     */

    const redirectUrl =
      `/?google_connected=1&business_id=${encodeURIComponent(
        businessId
      )}`;

    return new Response(
      null,
      {
        status:
          302,

        headers: {
          Location:
            redirectUrl,

          'cache-control':
            'no-store'
        }
      }
    );
  }

  /*
   * Fallback when no business ID exists.
   */

  return html(
    200,
    `
    <html>
      <head>
        <title>Google Business Connected</title>
      </head>

      <body
        style="
          font-family:Arial,sans-serif;
          padding:40px
        "
      >
        <h2>✅ Google Business connected</h2>

        <p>
          Your Google Business connection has been
          securely saved.
        </p>

        <p>
          You can close this window and return to
          STore Automation.
        </p>
      </body>
    </html>
    `
  );
}


/* =========================================================
   GOOGLE MANAGER INVITATION
========================================================= */

async function googleInviteManager(
  request
) {

  if (
    request.method !== 'POST'
  ) {
    return json(
      {
        error:
          'Method not allowed'
      },
      405
    );
  }

  if (
    !STORE_GOOGLE_MANAGER_EMAIL
  ) {
    return json(
      {
        error:
          'STore Google manager email is not configured'
      },
      500
    );
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET
  ) {
    return json(
      {
        error:
          'Google server configuration missing'
      },
      500
    );
  }

  const authHeader =
    request.headers.get(
      'authorization'
    );

  if (
    !authHeader?.startsWith(
      'Bearer '
    )
  ) {
    return json(
      {
        error:
          'Missing Supabase authorization'
      },
      401
    );
  }

  const supabaseAccessToken =
    authHeader.slice(7);

  /*
   * Validate logged-in STall user.
   */

  const userResponse =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SUPABASE_PUBLISHABLE_KEY ||
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${supabaseAccessToken}`
        }
      }
    );

  if (
    !userResponse.ok
  ) {
    return json(
      {
        error:
          'Invalid Supabase session'
      },
      401
    );
  }

  const user =
    await userResponse.json();

  const body =
    await request
      .json()
      .catch(
        () => null
      );

  if (
    !body?.business_id
  ) {
    return json(
      {
        error:
          'Business ID is required'
      },
      400
    );
  }

  const businessId =
    body.business_id;

  /*
   * Verify Business membership.
   */

  const memberResponse =
    await supabaseFetch(
      `/rest/v1/business_users` +
      `?business_id=eq.${encodeURIComponent(
        businessId
      )}` +
      `&user_id=eq.${encodeURIComponent(
        user.id
      )}` +
      `&select=business_id,role` +
      `&limit=1`
    );

  if (
    !memberResponse.ok
  ) {

    console.error(
      'Business membership lookup failed:',
      await memberResponse.text()
    );

    return json(
      {
        error:
          'Unable to verify business membership'
      },
      500
    );
  }

  const members =
    await memberResponse.json();

  if (
    !members.length
  ) {
    return json(
      {
        error:
          'You are not authorized to manage this business'
      },
      403
    );
  }

  /*
   * Load verified Google connection.
   */

  const connectionResponse =
    await supabaseFetch(
      `/rest/v1/google_connections` +
      `?business_id=eq.${encodeURIComponent(
        businessId
      )}` +
      `&select=` +
      [
        'id',
        'business_id',
        'business_profile_account_id',
        'business_profile_location_id',
        'business_profile_location_name',
        'access_token',
        'refresh_token',
        'token_expires_at',
        'authorization_status',
        'access_status',
        'connection_status'
      ].join(',') +
      `&limit=1`
    );

  if (
    !connectionResponse.ok
  ) {

    console.error(
      'Google connection lookup failed:',
      await connectionResponse.text()
    );

    return json(
      {
        error:
          'Unable to load Google Business connection'
      },
      500
    );
  }

  const connections =
    await connectionResponse.json();

  if (
    !connections.length
  ) {
    return json(
      {
        error:
          'Google Business is not connected'
      },
      404
    );
  }

  const connection =
    connections[0];

  /*
   * Require verified location.
   */

  if (
    connection.access_status !==
      'verified' ||
    connection.connection_status !==
      'location_selected' ||
    !connection.business_profile_location_id
  ) {

    return json(
      {
        error:
          'The Google Business Profile listing has not been verified yet'
      },
      409
    );
  }

  if (
    !connection.refresh_token
  ) {
    return json(
      {
        error:
          'Google connection is missing a refresh token'
      },
      400
    );
  }

  /*
   * Refresh Google access token if required.
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
      Date.now() +
      60 *
      1000;

  if (
    needsRefresh
  ) {

    const tokenResponse =
      await fetch(
        'https://oauth2.googleapis.com/token',
        {
          method:
            'POST',

          headers: {
            'content-type':
              'application/x-www-form-urlencoded'
          },

          body:
            new URLSearchParams({
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
      await tokenResponse
        .json()
        .catch(
          () => ({})
        );

    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {

      console.error(
        'Google token refresh failed:',
        tokenData
      );

      await updateConnection(
        businessId,
        {
          connection_status:
            'error',

          last_error:
            'Google access token refresh failed',

          updated_at:
            new Date().toISOString()
        }
      );

      return json(
        {
          error:
            'Google authorization has expired. Please reconnect Google Business.'
        },
        401
      );
    }

    accessToken =
      tokenData.access_token;

    const newExpiresAt =
      tokenData.expires_in
        ? new Date(
            Date.now() +
            Number(
              tokenData.expires_in
            ) *
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

        last_error:
          null,

        updated_at:
          new Date().toISOString()
      }
    );
  }

  /*
   * Validate Google location ID.
   */

  const locationId =
    connection.business_profile_location_id;

  if (
    !locationId.startsWith(
      'locations/'
    )
  ) {
    return json(
      {
        error:
          'Invalid Google Business location ID'
      },
      400
    );
  }

  /*
   * Check existing invitation.
   */

  const adminsCheckUrl =
    `https://mybusinessaccountmanagement.googleapis.com/v1/${locationId}/admins`;

  const adminsCheckResponse =
    await fetch(
      adminsCheckUrl,
      {
        method:
          'GET',

        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

  const adminsCheckData =
    await adminsCheckResponse
      .json()
      .catch(
        () => ({})
      );

  if (
    adminsCheckResponse.ok
  ) {

    const existingPendingInvitation =
      Array.isArray(
        adminsCheckData.admins
      )
        ? adminsCheckData.admins.find(
            admin =>
              admin?.admin ===
                STORE_GOOGLE_MANAGER_EMAIL &&
              admin?.pendingInvitation ===
                true
          )
        : null;

    if (
      existingPendingInvitation
    ) {

      await updateConnection(
        businessId,
        {
          store_manager_email:
            STORE_GOOGLE_MANAGER_EMAIL,

          store_manager_invitation_status:
            'awaiting_acceptance',

          store_manager_invitation_id:
            existingPendingInvitation.name ||
            null,

          connection_status:
            'awaiting_acceptance',

          last_error:
            null,

          updated_at:
            new Date().toISOString()
        }
      );

      return json({
        success:
          true,

        status:
          'awaiting_acceptance',

        store_manager_email:
          STORE_GOOGLE_MANAGER_EMAIL,

        invitation_id:
          existingPendingInvitation.name ||
          null,

        business_id:
          businessId,

        business_profile_location_id:
          locationId,

        message:
          'STore Manager invitation is already pending acceptance.'
      });
    }

  } else {

    console.error(
      'STore EXISTING INVITATION CHECK failed:',
      JSON.stringify({
        status:
          adminsCheckResponse.status,

        error:
          adminsCheckData.error ||
          null
      })
    );

    return json(
      {
        error:
          'Unable to verify existing Google Manager invitation.',

        google_status:
          adminsCheckResponse.status,

        details:
          adminsCheckData.error ||
          null
      },
      502
    );
  }

  /*
   * Send Manager invitation.
   */

  const inviteUrl =
    `https://mybusinessaccountmanagement.googleapis.com/v1/${locationId}/admins`;

  console.log(
    'STore INVITE PAYLOAD VERSION 20260818-A',
    JSON.stringify({
      admin:
        STORE_GOOGLE_MANAGER_EMAIL,

      role:
        'MANAGER'
    })
  );

  const inviteResponse =
    await fetch(
      inviteUrl,
      {
        method:
          'POST',

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            admin:
              STORE_GOOGLE_MANAGER_EMAIL,

            role:
              'MANAGER'
          })
      }
    );

  const inviteData =
    await inviteResponse
      .json()
      .catch(
        () => ({})
      );

  if (
    !inviteResponse.ok
  ) {

    console.error(
      'STore GOOGLE INVITE FAILURE',
      JSON.stringify({
        status:
          inviteResponse.status,

        statusText:
          inviteResponse.statusText,

        response:
          inviteData
      })
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

    return json(
      {
        error:
          'Unable to send STore Google manager invitation',

        google_status:
          inviteResponse.status,

        google_status_text:
          inviteResponse.statusText ||
          null,

        google_error:
          inviteData.error ||
          null,

        details:
          inviteData.error?.message ||
          inviteData.error?.status ||
          JSON.stringify(
            inviteData
          )
      },
      502
    );
  }

  /*
   * Google accepted invitation.
   */

  const invitationId =
    inviteData.name ||
    null;

  await updateConnection(
    businessId,
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

      last_error:
        null,

      updated_at:
        new Date().toISOString()
    }
  );

  return json({
    success:
      true,

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
}


/* =========================================================
   UPDATE GOOGLE CONNECTION
========================================================= */

async function updateConnection(
  businessId,
  values
) {

  const response =
    await supabaseFetch(
      `/rest/v1/google_connections` +
      `?business_id=eq.${encodeURIComponent(
        businessId
      )}`,
      {
        method:
          'PATCH',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'return=minimal'
        },

        body:
          JSON.stringify(
            values
          )
      }
    );

  if (
    !response.ok
  ) {

    console.error(
      'Google connection update failed:',
      await response.text()
    );
  }

  return response;
}


/* =========================================================
   MAIN ROUTER
========================================================= */

export default {

  async fetch(
    request
  ) {

    try {

      const url =
        new URL(
          request.url
        );

      const code =
        url.searchParams.get(
          'code'
        );

      const state =
        url.searchParams.get(
          'state'
        );

      const action =
        url.searchParams.get(
          'action'
        );

      /*
       * GOOGLE CALLBACK
       *
       * Google sends:
       * ?code=...
       * ?state=...
       */

      if (
        request.method === 'GET' &&
        code &&
        state
      ) {

        return await googleCallback(
          request
        );
      }

      /*
       * GOOGLE START
       *
       * GET /api/google?business_id=...
       */

      if (
        request.method === 'GET'
      ) {

        return await googleStart(
          request
        );
      }

      /*
       * MANAGER INVITATION
       *
       * POST /api/google?action=invite-manager
       */

      if (
        request.method === 'POST' &&
        action ===
          'invite-manager'
      ) {

        return await googleInviteManager(
          request
        );
      }

      /*
       * Unknown operation.
       */

      return json(
        {
          error:
            'Invalid Google API request',

          supported_operations: [
            'GET /api/google?business_id=...',
            'GET /api/google?code=...&state=...',
            'POST /api/google?action=invite-manager'
          ]
        },
        400
      );

    } catch (
      error
    ) {

      console.error(
        'Google API error:',
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

      /*
       * OAuth callback returns HTML.
       */

      if (
        request.method === 'GET'
      ) {

        return html(
          500,
          `
          <h2>Google connection failed.</h2>
          <p>
            An unexpected server error occurred.
            Please return to STore Automation and try again.
          </p>
          `
        );
      }

      return json(
        {
          error:
            'Unable to process Google request'
        },
        500
      );
    }
  }
};
