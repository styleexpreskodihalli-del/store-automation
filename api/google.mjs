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

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY;

const STORE_GOOGLE_MANAGER_EMAIL =
  process.env.STORE_GOOGLE_MANAGER_EMAIL;


/* =========================================================
   COMMON RESPONSE / SUPABASE HELPERS
========================================================= */

function json(body, status = 200) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  );
}

function html(status, body) {
  return new Response(
    body,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  );
}

async function supabaseFetch(path, options = {}) {
  return fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(options.headers || {})
      }
    }
  );
}

async function getAuthenticatedUser(request) {
  const authHeader =
    request.headers.get('authorization') || '';

  if (!authHeader.startsWith('Bearer ')) {
    return {
      error: json(
        { error: 'Missing Supabase authorization' },
        401
      )
    };
  }

  const accessToken =
    authHeader.slice(7);

  const publishableKey =
    SUPABASE_PUBLISHABLE_KEY ||
    SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !publishableKey) {
    return {
      error: json(
        { error: 'Supabase server configuration missing' },
        500
      )
    };
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    return {
      error: json(
        { error: 'Invalid Supabase session' },
        401
      )
    };
  }

  return {
    user: await response.json(),
    accessToken
  };
}

async function verifyBusinessMembership(
  businessId,
  userId
) {
  if (!businessId || !userId) {
    return {
      ok: false,
      response: json(
        { error: 'Business ID is required' },
        400
      )
    };
  }

  const response =
    await supabaseFetch(
      `/rest/v1/business_users` +
      `?business_id=eq.${encodeURIComponent(businessId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&select=id,role` +
      `&limit=1`
    );

  if (!response.ok) {
    console.error(
      'Business membership lookup failed:',
      await response.text()
    );

    return {
      ok: false,
      response: json(
        { error: 'Unable to verify business membership' },
        500
      )
    };
  }

  const members =
    await response.json();

  if (!members.length) {
    return {
      ok: false,
      response: json(
        {
          error:
            'You are not authorized to manage this business'
        },
        403
      )
    };
  }

  return {
    ok: true,
    member: members[0]
  };
}

async function getGoogleConnection(
  businessId
) {
  const response =
    await supabaseFetch(
      `/rest/v1/google_connections` +
      `?business_id=eq.${encodeURIComponent(businessId)}` +
      `&select=` +
      [
        'id',
        'business_id',
        'google_account_id',
        'google_account_email',
        'access_token',
        'refresh_token',
        'token_expires_at',
        'scope',
        'google_place_id',
        'business_profile_account_id',
        'business_profile_location_id',
        'business_profile_location_name',
        'authorization_status',
        'access_status',
        'connection_status',
        'last_error',
        'store_manager_email',
        'store_manager_invitation_status',
        'store_manager_invitation_id'
      ].join(',') +
      `&limit=1`
    );

  if (!response.ok) {
    console.error(
      'Google connection lookup failed:',
      await response.text()
    );

    return {
      ok: false,
      response: json(
        { error: 'Unable to load Google connection' },
        500
      )
    };
  }

  const connections =
    await response.json();

  if (!connections.length) {
    return {
      ok: false,
      response: json(
        { error: 'Google Business is not connected' },
        404
      )
    };
  }

  return {
    ok: true,
    connection: connections[0]
  };
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
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(values)
      }
    );

  if (!response.ok) {
    console.error(
      'Google connection update failed:',
      await response.text()
    );
  }

  return response;
}

async function refreshGoogleAccessToken(
  connection,
  businessId
) {
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

  if (!needsRefresh) {
    return {
      ok: true,
      accessToken
    };
  }

  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET
  ) {
    return {
      ok: false,
      response: json(
        { error: 'Google OAuth configuration missing' },
        500
      )
    };
  }

  if (!connection.refresh_token) {
    return {
      ok: false,
      response: json(
        {
          error:
            'Google connection is missing a refresh token'
        },
        400
      )
    };
  }

  const tokenResponse =
    await fetch(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
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
      .catch(() => ({}));

  if (
    !tokenResponse.ok ||
    !tokenData.access_token
  ) {
    console.error(
      'Google access token refresh failed:',
      {
        status:
          tokenResponse.status,
        error:
          tokenData.error ||
          'unknown'
      }
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

    return {
      ok: false,
      response: json(
        {
          error:
            'Google authorization has expired. Please reconnect Google Business.'
        },
        401
      )
    };
  }

  accessToken =
    tokenData.access_token;

  const newExpiresAt =
    tokenData.expires_in
      ? new Date(
          Date.now() +
          Number(tokenData.expires_in) * 1000
        ).toISOString()
      : null;

  await updateConnection(
    businessId,
    {
      access_token:
        accessToken,
      token_expires_at:
        newExpiresAt,
      last_error:
        null,
      updated_at:
        new Date().toISOString()
    }
  );

  return {
    ok: true,
    accessToken
  };
}


/* =========================================================
   GOOGLE OAUTH START
   GET /api/google?business_id=...
========================================================= */

async function googleStart(request) {
  if (request.method !== 'GET') {
    return json(
      { error: 'Method not allowed' },
      405
    );
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !SUPABASE_PUBLISHABLE_KEY
  ) {
    return json(
      { error: 'Supabase server configuration missing' },
      500
    );
  }

  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_REDIRECT_URI
  ) {
    return json(
      { error: 'Google OAuth configuration missing' },
      500
    );
  }

  const auth =
    await getAuthenticatedUser(request);

  if (auth.error) {
    return auth.error;
  }

  const url =
    new URL(request.url);

  const businessId =
    url.searchParams.get('business_id');

  if (!businessId) {
    return json(
      { error: 'business_id is required' },
      400
    );
  }

  const membership =
    await verifyBusinessMembership(
      businessId,
      auth.user.id
    );

  if (!membership.ok) {
    return membership.response;
  }

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
      10 * 60 * 1000
    ).toISOString();

  const stateResponse =
    await supabaseFetch(
      `/rest/v1/google_oauth_states`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          Prefer:
            'return=minimal'
        },
        body:
          JSON.stringify({
            state_hash:
              stateHash,
            expires_at:
              expiresAt,
            business_id:
              businessId
          })
      }
    );

  if (!stateResponse.ok) {
    console.error(
      'OAuth state insert failed:',
      await stateResponse.text()
    );

    return json(
      {
        error:
          'Unable to initialize Google connection'
      },
      500
    );
  }

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

  console.log(
    'Google OAuth start:',
    {
      business_id:
        businessId,
      user_id:
        auth.user.id
    }
  );

  return json({
    authorizationUrl
  });
}


/* =========================================================
   GOOGLE OAUTH CALLBACK
   GET /api/google?code=...&state=...
========================================================= */

async function googleCallback(request) {
  const url =
    new URL(request.url);

  const code =
    url.searchParams.get('code');

  const state =
    url.searchParams.get('state');

  const error =
    url.searchParams.get('error');

  if (error) {
    return html(
      400,
      `
      <h2>Google authorization failed</h2>
      <p>${escapeHtml(error)}</p>
      `
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
    return html(
      500,
      '<h2>Google connection is not configured.</h2>'
    );
  }

  const stateHash =
    crypto
      .createHash('sha256')
      .update(state)
      .digest('hex');

  const stateResponse =
    await supabaseFetch(
      `/rest/v1/google_oauth_states` +
      `?state_hash=eq.${encodeURIComponent(stateHash)}` +
      `&used_at=is.null` +
      `&expires_at=gt.${encodeURIComponent(
        new Date().toISOString()
      )}` +
      `&select=id,business_id` +
      `&limit=1`
    );

  if (!stateResponse.ok) {
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

  if (!Array.isArray(states) || !states.length) {
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

  const markUsedResponse =
    await supabaseFetch(
      `/rest/v1/google_oauth_states` +
      `?id=eq.${encodeURIComponent(
        oauthState.id
      )}` +
      `&used_at=is.null`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type':
            'application/json'
        },
        body:
          JSON.stringify({
            used_at:
              new Date().toISOString()
          })
      }
    );

  if (!markUsedResponse.ok) {
    return html(
      500,
      '<h2>Unable to secure Google connection.</h2>'
    );
  }

  const tokenResponse =
    await fetch(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
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
      .catch(() => ({}));

  if (!tokenResponse.ok) {
    console.error(
      'Google token exchange failed:',
      tokenData
    );

    return html(
      400,
      `
      <h2>Google token exchange failed.</h2>
      <p>Please start the connection again.</p>
      `
    );
  }

  const requiredScope =
    'https://www.googleapis.com/auth/business.manage';

  const grantedScopes =
    String(
      tokenData.scope || ''
    )
      .split(/\s+/)
      .filter(Boolean);

  if (
    !grantedScopes.includes(
      requiredScope
    )
  ) {
    return html(
      403,
      `
      <h2>Google Business Profile permission required.</h2>
      <p>
        Please reconnect Google and approve Business Profile access.
      </p>
      `
    );
  }

  let googleAccountId =
    null;

  let googleAccountEmail =
    null;

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
      await userInfoResponse
        .json()
        .catch(() => ({}));

    if (!userInfoResponse.ok) {
      return html(
        400,
        `
        <h2>Unable to identify the Google account.</h2>
        <p>Please reconnect Google Business.</p>
        `
      );
    }

    googleAccountId =
      userInfo.sub || null;

    googleAccountEmail =
      userInfo.email || null;
  }

  if (!tokenData.refresh_token) {
    return html(
      400,
      `
      <h2>Google did not provide a refresh token.</h2>
      <p>Please reconnect and grant offline access.</p>
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

  const now =
    new Date().toISOString();

  if (!businessId) {
    return html(
      400,
      '<h2>Google connection is missing the business ID.</h2>'
    );
  }

  const saveResponse =
    await supabaseFetch(
      `/rest/v1/google_connections?on_conflict=business_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          Prefer:
            'resolution=merge-duplicates,return=minimal'
        },
        body:
          JSON.stringify({
            business_id:
              businessId,
            google_account_id:
              googleAccountId,
            google_account_email:
              googleAccountEmail,
            access_token:
              tokenData.access_token || null,
            refresh_token:
              tokenData.refresh_token,
            token_expires_at:
              tokenExpiresAt,
            scope:
              tokenData.scope || null,
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
          })
      }
    );

  if (!saveResponse.ok) {
    console.error(
      'Google connection storage failed:',
      await saveResponse.text()
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

  const redirectUrl =
    `/?google_connected=1&business_id=${encodeURIComponent(
      businessId
    )}`;

  return new Response(
    null,
    {
      status: 302,
      headers: {
        Location:
          redirectUrl,
        'cache-control':
          'no-store'
      }
    }
  );
}
/* =========================================================
   GOOGLE BUSINESS LOCATIONS
   GET /api/google?action=locations&business_id=...
========================================================= */

async function googleLocations(request) {
  if (request.method !== 'GET') {
    return json(
      { error: 'Method not allowed' },
      405
    );
  }

  const auth =
    await getAuthenticatedUser(request);

  if (auth.error) {
    return auth.error;
  }

  const url =
    new URL(request.url);

  const businessId =
    url.searchParams.get('business_id');

  if (!businessId) {
    return json(
      { error: 'business_id is required' },
      400
    );
  }

  const membership =
    await verifyBusinessMembership(
      businessId,
      auth.user.id
    );

  if (!membership.ok) {
    return membership.response;
  }

  const connectionResult =
    await getGoogleConnection(
      businessId
    );

  if (!connectionResult.ok) {
    return connectionResult.response;
  }

  const connection =
    connectionResult.connection;

  if (!connection.refresh_token) {
    return json(
      {
        error:
          'Google connection is missing a refresh token'
      },
      400
    );
  }

  const tokenResult =
    await refreshGoogleAccessToken(
      connection,
      businessId
    );

  if (!tokenResult.ok) {
    return tokenResult.response;
  }

  const accessToken =
    tokenResult.accessToken;

  const accounts = [];

  let accountsPageToken = null;

  do {
    const accountsUrl =
      new URL(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
      );

    accountsUrl.searchParams.set(
      'pageSize',
      '20'
    );

    if (accountsPageToken) {
      accountsUrl.searchParams.set(
        'pageToken',
        accountsPageToken
      );
    }

    const accountsResponse =
      await fetch(
        accountsUrl.toString(),
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`
          }
        }
      );

    const accountsData =
      await accountsResponse
        .json()
        .catch(() => ({}));

    if (!accountsResponse.ok) {
      return json(
        {
          error:
            'Unable to load Google Business accounts',
          google_status:
            accountsResponse.status,
          details:
            accountsData.error?.message ||
            null
        },
        502
      );
    }

    if (
      Array.isArray(
        accountsData.accounts
      )
    ) {
      accounts.push(
        ...accountsData.accounts
      );
    }

    accountsPageToken =
      accountsData.nextPageToken ||
      null;

  } while (accountsPageToken);

  const allLocations = [];

  for (const account of accounts) {
    if (!account?.name) {
      continue;
    }

    const accountName =
      account.name;

    let locationsPageToken = null;

    do {
      const locationsUrl =
        new URL(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`
        );

      locationsUrl.searchParams.set(
        'readMask',
        [
          'name',
          'title',
          'storeCode',
          'websiteUri',
          'phoneNumbers',
          'storefrontAddress',
          'metadata'
        ].join(',')
      );

      locationsUrl.searchParams.set(
        'pageSize',
        '100'
      );

      if (locationsPageToken) {
        locationsUrl.searchParams.set(
          'pageToken',
          locationsPageToken
        );
      }

      const locationsResponse =
        await fetch(
          locationsUrl.toString(),
          {
            headers: {
              Authorization:
                `Bearer ${accessToken}`
            }
          }
        );

      const locationsData =
        await locationsResponse
          .json()
          .catch(() => ({}));

      if (!locationsResponse.ok) {
        console.warn(
          'Google locations lookup failed for account:',
          {
            account:
              accountName,
            status:
              locationsResponse.status,
            error:
              locationsData.error?.message ||
              null
          }
        );

        break;
      }

      const locations =
        Array.isArray(
          locationsData.locations
        )
          ? locationsData.locations
          : [];

      for (const location of locations) {
        allLocations.push({
          account: {
            name:
              account.name || null,
            account_name:
              account.accountName || null,
            type:
              account.type || null,
            role:
              account.role || null,
            permission_level:
              account.permissionLevel || null
          },

          location: {
            name:
              location.name || null,
            title:
              location.title || null,
            store_code:
              location.storeCode || null,
            website_uri:
              location.websiteUri || null,
            phone_numbers:
              location.phoneNumbers || null,
            storefront_address:
              location.storefrontAddress || null,
            metadata:
              location.metadata || null
          }
        });
      }

      locationsPageToken =
        locationsData.nextPageToken ||
        null;

    } while (locationsPageToken);
  }

  const businessResponse =
    await supabaseFetch(
      `/rest/v1/businesses` +
      `?id=eq.${encodeURIComponent(businessId)}` +
      `&select=id,business_name,google_place_id` +
      `&limit=1`
    );

  let mappedPlaceId = null;
  let businessName = null;

  if (businessResponse.ok) {
    const businesses =
      await businessResponse.json();

    if (businesses.length) {
      mappedPlaceId =
        businesses[0].google_place_id ||
        null;

      businessName =
        businesses[0].business_name ||
        null;
    }
  }

  let matchedLocation = null;

  if (mappedPlaceId) {
    const normalizedPlaceId =
      String(mappedPlaceId).trim();

    for (const item of allLocations) {
      const locationPlaceId =
        item.location?.metadata?.placeId ||
        item.location?.metadata?.place_id ||
        null;

      if (
        locationPlaceId &&
        String(locationPlaceId).trim() ===
          normalizedPlaceId
      ) {
        matchedLocation =
          item;

        break;
      }
    }
  }

  if (matchedLocation) {
    const accountName =
      matchedLocation.account?.name ||
      null;

    const locationName =
      matchedLocation.location?.name ||
      null;

    const locationTitle =
      matchedLocation.location?.title ||
      null;

    const saveResponse =
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
            JSON.stringify({
              google_place_id:
                String(mappedPlaceId).trim(),

              business_profile_account_id:
                accountName,

              business_profile_location_id:
                locationName,

              business_profile_location_name:
                locationTitle,

              authorization_status:
                'authorized',

              access_status:
                'verified',

              connection_status:
                'location_selected',

              last_synced_at:
                new Date().toISOString(),

              last_error:
                null,

              updated_at:
                new Date().toISOString()
            })
        }
      );

    if (!saveResponse.ok) {
      const detail =
        await saveResponse.text();

      return json(
        {
          error:
            'Google location was found but could not be saved',

          details:
            detail || null
        },
        500
      );
    }

  } else {

    await updateConnection(
      businessId,
      {
        authorization_status:
          'authorized',

        access_status:
          'unverified',

        connection_status:
          'location_matching',

        last_error:
          'No Google Business Profile location matched the stored Google Place ID',

        updated_at:
          new Date().toISOString()
      }
    );
  }

  return json({
    success:
      true,

    google_business_connected:
      Boolean(matchedLocation),

    business: {
      id:
        businessId,

      business_name:
        businessName,

      google_place_id:
        mappedPlaceId
    },

    connection: {
      google_account_id:
        connection.google_account_id ||
        null,

      google_account_email:
        connection.google_account_email ||
        null,

      authorization_status:
        connection.authorization_status ||
        null,

      access_status:
        matchedLocation
          ? 'verified'
          : 'unverified',

      connection_status:
        matchedLocation
          ? 'location_selected'
          : 'location_matching'
    },

    accounts:
      accounts.map(account => ({
        name:
          account.name || null,

        account_name:
          account.accountName || null,

        type:
          account.type || null,

        role:
          account.role || null,

        permission_level:
          account.permissionLevel ||
          null,

        verification_state:
          account.verificationState ||
          null
      })),

    locations:
      allLocations,

    locations_found:
      allLocations.length
  });
}


/* =========================================================
   GOOGLE PLACES DISCOVERY
   GET /api/google?action=discover&city=...&query=...
========================================================= */

async function googleDiscover(request) {
  if (request.method !== 'GET') {
    return json(
      { error: 'Method not allowed' },
      405
    );
  }

  const auth =
    await getAuthenticatedUser(request);

  if (auth.error) {
    return auth.error;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    console.error(
      'GOOGLE_MAPS_API_KEY is not configured'
    );

    return json(
      {
        error:
          'Google Places discovery is not configured'
      },
      500
    );
  }

  const url =
    new URL(request.url);

  const country =
    clean(
      url.searchParams.get('country')
    );

  const city =
    clean(
      url.searchParams.get('city')
    );

  const area =
    clean(
      url.searchParams.get('area')
    );

  const requestedQuery =
    clean(
      url.searchParams.get('query')
    );

  if (!city && !requestedQuery) {
    return json(
      {
        error:
          'Please select a city or enter a business search.'
      },
      400
    );
  }

  const searchParts = [];

  if (requestedQuery) {
    searchParts.push(
      requestedQuery
    );
  } else {
    searchParts.push(
      'business'
    );
  }

  if (area) {
    searchParts.push(
      area
    );
  }

  if (city) {
    searchParts.push(
      city
    );
  }

  if (country) {
    searchParts.push(
      country
    );
  }

  const textQuery =
    searchParts.join(', ');

  const minLat =
    numberParam(
      url.searchParams.get('minLat')
    );

  const minLng =
    numberParam(
      url.searchParams.get('minLng')
    );

  const maxLat =
    numberParam(
      url.searchParams.get('maxLat')
    );

  const maxLng =
    numberParam(
      url.searchParams.get('maxLng')
    );

  const hasRestriction =
    [
      minLat,
      minLng,
      maxLat,
      maxLng
    ].every(
      value =>
        value !== null
    );

  const placesBody = {
    textQuery,

    pageSize:
      20,

    languageCode:
      'en',

    includePureServiceAreaBusinesses:
      false
  };

  if (hasRestriction) {
    placesBody.locationRestriction = {
      rectangle: {
        low: {
          latitude:
            minLat,

          longitude:
            minLng
        },

        high: {
          latitude:
            maxLat,

          longitude:
            maxLng
        }
      }
    };
  }

  console.log(
    'Google Places discovery:',
    {
      user_id:
        auth.user.id,

      textQuery,

      country,

      city,

      area,

      restricted:
        hasRestriction
    }
  );

  const placesResponse =
    await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          'X-Goog-Api-Key':
            GOOGLE_MAPS_API_KEY,

          'X-Goog-FieldMask':
            [
              'places.id',
              'places.name',
              'places.displayName',
              'places.formattedAddress',
              'places.shortFormattedAddress',
              'places.googleMapsUri',
              'places.websiteUri',
              'places.nationalPhoneNumber',
              'places.internationalPhoneNumber',
              'places.location',
              'places.types',
              'places.primaryType',
              'places.primaryTypeDisplayName',
              'places.rating',
              'places.userRatingCount',
              'places.addressComponents'
            ].join(',')
        },

        body:
          JSON.stringify(
            placesBody
          )
      }
    );

  const placesData =
    await placesResponse
      .json()
      .catch(() => null);

  if (!placesResponse.ok) {
    console.error(
      'Google Places search failed:',
      {
        status:
          placesResponse.status,

        data:
          placesData
      }
    );

    return json(
      {
        error:
          placesData?.error?.message ||
          'Unable to search Google Places',

        google_status:
          placesResponse.status
      },
      502
    );
  }

  const places =
    Array.isArray(
      placesData?.places
    )
      ? placesData.places
      : [];

  const locations =
    places.map(place => {
      const addressComponents =
        place.addressComponents ||
        [];

      let cityName =
        null;

      let state =
        null;

      let countryName =
        null;

      let postalCode =
        null;

      for (
        const component
        of addressComponents
      ) {
        const types =
          component.types ||
          [];

        if (
          types.includes('locality') &&
          !cityName
        ) {
          cityName =
            component.longText;

        } else if (
          (
            types.includes(
              'administrative_area_level_1'
            ) ||
            types.includes(
              'administrative_area_level_2'
            )
          ) &&
          !state
        ) {
          state =
            component.longText;

        } else if (
          types.includes('country') &&
          !countryName
        ) {
          countryName =
            component.longText;

        } else if (
          types.includes('postal_code') &&
          !postalCode
        ) {
          postalCode =
            component.longText;
        }
      }

      return {
        place_id:
          place.id ||
          null,

        location_id:
          place.id ||
          null,

        location_name:
          place.displayName?.text ||
          null,

        address:
          place.formattedAddress ||
          place.shortFormattedAddress ||
          null,

        city:
          cityName,

        state:
          state,

        country:
          countryName,

        postal_code:
          postalCode,

        phone:
          place.nationalPhoneNumber ||
          place.internationalPhoneNumber ||
          null,

        website:
          place.websiteUri ||
          null,

        google_maps_url:
          place.googleMapsUri ||
          null,

        latitude:
          place.location?.latitude ??
          null,

        longitude:
          place.location?.longitude ??
          null,

        primary_type:
          place.primaryType ||
          null,

        primary_type_display_name:
          place.primaryTypeDisplayName?.text ||
          null,

        rating:
          place.rating ??
          null,

        user_rating_count:
          place.userRatingCount ??
          null,

        source:
          'google_places'
      };
    });

  return json({
    success:
      true,

    search: {
      country:
        country ||
        null,

      city:
        city ||
        null,

      area:
        area ||
        null,

      query:
        requestedQuery ||
        null,

      text_query:
        textQuery,

      restricted:
        hasRestriction
    },

    locations_found:
      locations.length,

    locations:
      locations.slice(0, 10)
  });
}
/* =========================================================
   GOOGLE MANAGER INVITATION
   POST /api/google?action=invite-manager
========================================================= */

async function googleInviteManager(request) {
  if (request.method !== 'POST') {
    return json(
      { error: 'Method not allowed' },
      405
    );
  }

  if (!STORE_GOOGLE_MANAGER_EMAIL) {
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

  const auth =
    await getAuthenticatedUser(request);

  if (auth.error) {
    return auth.error;
  }

  const body =
    await request
      .json()
      .catch(() => null);

  if (!body?.business_id) {
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

  const membership =
    await verifyBusinessMembership(
      businessId,
      auth.user.id
    );

  if (!membership.ok) {
    return membership.response;
  }

  const connectionResult =
    await getGoogleConnection(
      businessId
    );

  if (!connectionResult.ok) {
    return connectionResult.response;
  }

  const connection =
    connectionResult.connection;

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

  const tokenResult =
    await refreshGoogleAccessToken(
      connection,
      businessId
    );

  if (!tokenResult.ok) {
    return tokenResult.response;
  }

  const accessToken =
    tokenResult.accessToken;

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
   * Check existing admins first.
   *
   * This prevents sending the same invitation again.
   */
  const adminsCheckUrl =
    `https://mybusinessaccountmanagement.googleapis.com/v1/${locationId}/admins`;

  const adminsCheckResponse =
    await fetch(
      adminsCheckUrl,
      {
        method: 'GET',

        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

  const adminsCheckData =
    await adminsCheckResponse
      .json()
      .catch(() => ({}));

  if (!adminsCheckResponse.ok) {
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

  /*
   * Invitation already exists.
   *
   * IMPORTANT:
   * This is the correction for the Google
   * "This admin has already been invited"
   * error we just discovered during testing.
   */
  if (existingPendingInvitation) {

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

  /*
   * Send new invitation.
   */
  const inviteUrl =
    `https://mybusinessaccountmanagement.googleapis.com/v1/${locationId}/admins`;

  console.log(
    'STore INVITE PAYLOAD VERSION 20260821-B',
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
      .catch(() => ({}));

  if (!inviteResponse.ok) {

    /*
     * Google can still report the invitation
     * as already existing even if the GET check
     * did not expose it.
     *
     * Treat that condition as success.
     */
    const alreadyInvited =
      inviteData?.error?.details?.some(
        detail =>
          Array.isArray(
            detail?.fieldViolations
          ) &&
          detail.fieldViolations.some(
            violation =>
              String(
                violation?.description ||
                ''
              )
                .toLowerCase()
                .includes(
                  'already been invited'
                )
          )
      );

    if (alreadyInvited) {

      await updateConnection(
        businessId,
        {
          store_manager_email:
            STORE_GOOGLE_MANAGER_EMAIL,

          store_manager_invitation_status:
            'awaiting_acceptance',

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

        business_id:
          businessId,

        business_profile_location_id:
          locationId,

        business_profile_location_name:
          connection.business_profile_location_name,

        message:
          'STore Manager invitation is already pending acceptance.'
      });
    }

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
          JSON.stringify(inviteData)
      },
      502
    );
  }

  const invitationId =
    inviteData.name ||
    null;

  const invitationStatus =
    inviteData.pendingInvitation
      ? 'awaiting_acceptance'
      : 'invitation_sent';

  await updateConnection(
    businessId,
    {
      store_manager_email:
        STORE_GOOGLE_MANAGER_EMAIL,

      store_manager_invitation_status:
        invitationStatus,

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
      invitationStatus,

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
   GOOGLE API ROUTER
========================================================= */

export default {
  async fetch(request) {

    try {

      const url =
        new URL(request.url);

      const action =
        url.searchParams.get(
          'action'
        );

      const code =
        url.searchParams.get(
          'code'
        );

      const state =
        url.searchParams.get(
          'state'
        );

      /*
       * ---------------------------------------------------
       * GOOGLE OAUTH CALLBACK
       * ---------------------------------------------------
       *
       * Existing callback URL:
       *
       * /api/google?code=...&state=...
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
       * ---------------------------------------------------
       * GOOGLE PLACES DISCOVERY
       * ---------------------------------------------------
       *
       * /api/google?action=discover
       */
      if (
        request.method === 'GET' &&
        action === 'discover'
      ) {

        return await googleDiscover(
          request
        );
      }

      /*
       * ---------------------------------------------------
       * GOOGLE BUSINESS LOCATIONS
       * ---------------------------------------------------
       *
       * /api/google?action=locations&business_id=...
       */
      if (
        request.method === 'GET' &&
        action === 'locations'
      ) {

        return await googleLocations(
          request
        );
      }

      /*
       * ---------------------------------------------------
       * GOOGLE OAUTH START
       * ---------------------------------------------------
       *
       * Existing frontend call:
       *
       * /api/google?business_id=...
       */
      if (
        request.method === 'GET'
      ) {

        return await googleStart(
          request
        );
      }

      /*
       * ---------------------------------------------------
       * GOOGLE MANAGER INVITATION
       * ---------------------------------------------------
       *
       * /api/google?action=invite-manager
       */
      if (
        request.method === 'POST' &&
        action === 'invite-manager'
      ) {

        return await googleInviteManager(
          request
        );
      }

      /*
       * ---------------------------------------------------
       * INVALID GOOGLE REQUEST
       * ---------------------------------------------------
       */

      return json(
        {
          error:
            'Invalid Google API request',

          supported_operations: [
            'GET /api/google?business_id=...',

            'GET /api/google?code=...&state=...',

            'GET /api/google?action=locations&business_id=...',

            'GET /api/google?action=discover&city=...&query=...',

            'POST /api/google?action=invite-manager'
          ]
        },
        400
      );

    } catch (error) {

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


/* =========================================================
   SMALL HELPERS
========================================================= */

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clean(value) {
  const text =
    String(value || '').trim();

  return text
    ? text.slice(0, 120)
    : '';
}

function numberParam(value) {

  if (
    value === null ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}
function numberParam(value) {

  if (
    value === null ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}
