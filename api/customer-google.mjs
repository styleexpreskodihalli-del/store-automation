import crypto from 'node:crypto';

/* =========================================================
   ENVIRONMENT
========================================================= */

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET;

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_CUSTOMER_REDIRECT_URI ||
  process.env.GOOGLE_REDIRECT_URI;


/* =========================================================
   JSON RESPONSE
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


/* =========================================================
   HTML RESPONSE
========================================================= */

function html(
  status,
  body
) {
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>STall Store Automation</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>

<body
  style="
    font-family:Arial,sans-serif;
    padding:40px;
    background:#07100d;
    color:#fff
  "
>
${body}
</body>
</html>`,
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


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(
  value
) {
  return String(
    value || ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}


/* =========================================================
   SUPABASE REQUEST
========================================================= */

async function supabaseFetch(
  path,
  options = {}
) {

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      'Supabase configuration is missing.'
    );
  }

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
   UPDATE OAUTH STATE
========================================================= */

async function updateState(
  id,
  values
) {

  return supabaseFetch(
    `/rest/v1/google_oauth_states?id=eq.${encodeURIComponent(id)}`,
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
}


/* =========================================================
   REFRESH GOOGLE ACCESS TOKEN
========================================================= */

async function refreshGoogleToken(
  refreshToken
) {

  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET
  ) {
    throw new Error(
      'Google client configuration is missing.'
    );
  }

  const response =
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
              refreshToken,

            grant_type:
              'refresh_token'
          })
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (
    !response.ok ||
    !data.access_token
  ) {

    console.error(
      'Google token refresh failed',
      {
        status:
          response.status,

        error:
          data?.error ||
          null,

        description:
          data?.error_description ||
          null
      }
    );

    throw new Error(
      'Google authorization has expired. Please reconnect Google Business.'
    );
  }

  return {
    accessToken:
      data.access_token,

    expiresAt:
      data.expires_in
        ? new Date(
            Date.now() +
            Number(
              data.expires_in
            ) *
            1000
          ).toISOString()
        : null
  };
}


/* =========================================================
   GOOGLE BUSINESS ACCOUNTS
========================================================= */

async function getGoogleAccounts(
  accessToken
) {

  const accounts = [];

  let pageToken =
    null;

  do {

    const url =
      new URL(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
      );

    url.searchParams.set(
      'pageSize',
      '20'
    );

    if (
      pageToken
    ) {

      url.searchParams.set(
        'pageToken',
        pageToken
      );
    }

    const response =
      await fetch(
        url.toString(),
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`
          }
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    console.log(
      'CUSTOMER GBP ACCOUNTS',
      JSON.stringify({
        status:
          response.status,

        ok:
          response.ok,

        count:
          Array.isArray(
            data.accounts
          )
            ? data.accounts.length
            : 0,

        error:
          data?.error?.message ||
          null
      })
    );

    if (
      !response.ok
    ) {

      throw new Error(
        data?.error?.message ||
        'Unable to load Google Business accounts.'
      );
    }

    if (
      Array.isArray(
        data.accounts
      )
    ) {

      accounts.push(
        ...data.accounts
      );
    }

    pageToken =
      data.nextPageToken ||
      null;

  } while (
    pageToken
  );

  return accounts;
}


/* =========================================================
   GOOGLE BUSINESS LOCATIONS
========================================================= */

async function getGoogleLocations(
  accessToken,
  account
) {

  const locations = [];

  if (
    !account ||
    !account.name
  ) {
    return locations;
  }

  let pageToken =
    null;

  do {

    const url =
      new URL(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`
      );

    url.searchParams.set(
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

    url.searchParams.set(
      'pageSize',
      '100'
    );

    if (
      pageToken
    ) {

      url.searchParams.set(
        'pageToken',
        pageToken
      );
    }

    const response =
      await fetch(
        url.toString(),
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`
          }
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    console.log(
      'CUSTOMER GBP LOCATIONS',
      JSON.stringify({
        account:
          account.name,

        status:
          response.status,

        ok:
          response.ok,

        count:
          Array.isArray(
            data.locations
          )
            ? data.locations.length
            : 0,

        error:
          data?.error?.message ||
          null
      })
    );

    if (
      !response.ok
    ) {

      /*
       * Do NOT crash the entire onboarding
       * if one Google account cannot return
       * locations.
       */

      console.warn(
        'Google locations request failed',
        {
          account:
            account.name,

          status:
            response.status,

          error:
            data?.error?.message ||
            null
        }
      );

      break;
    }

    if (
      Array.isArray(
        data.locations
      )
    ) {

      locations.push(
        ...data.locations
      );
    }

    pageToken =
      data.nextPageToken ||
      null;

  } while (
    pageToken
  );

  return locations;
}


/* =========================================================
   START CUSTOMER GOOGLE OAUTH
========================================================= */

async function startCustomerGoogle(
  request
) {

  if (
    request.method !== 'POST'
  ) {

    return json(
      {
        success:
          false,

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
        success:
          false,

        error:
          'Google connection is not configured'
      },
      500
    );
  }

  let body =
    {};

  try {

    body =
      await request.json();

  } catch {

    body =
      {};
  }

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

  /*
   * ONBOARDING ID
   */

  const onboardingId =
    crypto.randomUUID();

  /*
   * SECURE GOOGLE OAUTH STATE
   */

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
      15 *
      60 *
      1000
    ).toISOString();

  /*
   * SAVE OAUTH STATE
   */

  const stateBody = {

    state_hash:
      stateHash,

    expires_at:
      expiresAt,

    customer_name:
      customerName ||
      null,

    customer_email:
      customerEmail ||
      null,

    customer_phone:
      customerPhone ||
      null,

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
        success:
          false,

        error:
          'Unable to initialize Google connection',

        supabase_status:
          stateResponse.status,

        supabase_details:
          detail ||
          null
      },
      500
    );
  }

  /*
   * GOOGLE OAUTH PARAMETERS
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
        [
          'openid',
          'email',
          'https://www.googleapis.com/auth/business.manage'
        ].join(' ')
    });

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

  return json(
    {
      success:
        true,

      onboarding_id:
        onboardingId,

      authorizationUrl
    }
  );
}


/* =========================================================
   CUSTOMER GOOGLE OAUTH CALLBACK
========================================================= */

async function customerGoogleCallback(
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

  const oauthError =
    url.searchParams.get(
      'error'
    );

  /*
   * GOOGLE CANCELLATION
   */

  if (
    oauthError
  ) {

    return html(
      400,
      `
      <h2>Google authorization was cancelled</h2>
      <p>${escapeHtml(oauthError)}</p>
      <p>You can close this window and return to STall.</p>
      `
    );
  }

  /*
   * MISSING OAUTH INFORMATION
   */

  if (
    !code ||
    !state
  ) {

    return html(
      400,
      `
      <h2>Google connection could not be completed</h2>
      <p>Missing authorization information.</p>
      `
    );
  }

  /*
   * CONFIGURATION
   */

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
   * HASH OAUTH STATE
   */

  const stateHash =
    crypto
      .createHash('sha256')
      .update(state)
      .digest('hex');

  /*
   * FIND CUSTOMER ONBOARDING STATE
   *
   * IMPORTANT:
   * onboarding_id MUST exist.
   *
   * This prevents a universal/admin OAuth
   * state from entering the customer flow.
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

  if (
    !stateResponse.ok
  ) {

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

  if (
    !Array.isArray(states) ||
    states.length === 0
  ) {

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
   * CONSUME STATE BEFORE TOKEN EXCHANGE
   *
   * Prevents replay attacks.
   */

  const usedAt =
    new Date().toISOString();

  const markUsedResponse =
    await fetch(
      `${SUPABASE_URL}/rest/v1/google_oauth_states` +
      `?id=eq.${encodeURIComponent(oauthState.id)}` +
      `&used_at=is.null`,
      {
        method:
          'PATCH',

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

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
      'Unable to consume customer OAuth state:',
      await markUsedResponse.text()
    );

    return html(
      500,
      '<h2>Unable to secure Google connection.</h2>'
    );
  }

  /*
   * EXCHANGE GOOGLE AUTHORIZATION CODE
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
   * VERIFY BUSINESS PROFILE SCOPE
   */

  const requiredScope =
    'https://www.googleapis.com/auth/business.manage';

  const grantedScopes =
    String(
      tokenData.scope ||
      ''
    )
      .split(/\s+/)
      .filter(Boolean);

  if (
    !grantedScopes.includes(
      requiredScope
    )
  ) {

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
   * IDENTIFY GOOGLE ACCOUNT
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
      userInfo.sub ||
      null;

    googleAccountEmail =
      userInfo.email ||
      null;
  }

  if (
    !googleAccountId
  ) {

    return html(
      400,
      '<h2>Unable to identify your Google account.</h2>'
    );
  }

  /*
   * REQUIRE REFRESH TOKEN
   *
   * Customer onboarding requires offline access.
   */

  if (
    !tokenData.refresh_token
  ) {

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

  /*
   * TOKEN EXPIRY
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

  /*
   * SAVE GOOGLE CONNECTION
   *
   * No business_id exists yet.
   * Business selection happens after authorization.
   */

  const updateResponse =
    await fetch(
      `${SUPABASE_URL}/rest/v1/google_oauth_states` +
      `?id=eq.${encodeURIComponent(oauthState.id)}`,
      {
        method:
          'PATCH',

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
          JSON.stringify({
            google_account_id:
              googleAccountId,

            google_account_email:
              googleAccountEmail,

            google_access_token:
              tokenData.access_token ||
              null,

            google_refresh_token:
              tokenData.refresh_token,

            google_token_expires_at:
              tokenExpiresAt,

            google_scope:
              tokenData.scope ||
              null
          })
      }
    );

  if (
    !updateResponse.ok
  ) {

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
   * RETURN TO CUSTOMER ONBOARDING
   *
   * Only onboarding_id is placed in URL.
   */

  const redirectUrl =
    `/onboarding.html?google_connected=1&onboarding_id=${encodeURIComponent(
      oauthState.onboarding_id
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


/* =========================================================
   CUSTOMER GOOGLE BUSINESS LOCATIONS
========================================================= */

async function loadCustomerGoogleLocations(
  request
) {

  if (
    request.method !== 'GET'
  ) {

    return json(
      {
        success:
          false,

        error:
          'Method not allowed'
      },
      405
    );
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET
  ) {

    console.error(
      'Customer GBP configuration missing',
      {
        supabase:
          !!SUPABASE_URL,

        serviceRole:
          !!SUPABASE_SERVICE_ROLE_KEY,

        googleClientId:
          !!GOOGLE_CLIENT_ID,

        googleClientSecret:
          !!GOOGLE_CLIENT_SECRET
      }
    );

    return json(
      {
        success:
          false,

        error:
          'Customer Google Business configuration missing'
      },
      500
    );
  }

  const requestUrl =
    new URL(
      request.url
    );

  const onboardingId =
    requestUrl.searchParams.get(
      'onboarding_id'
    );

  if (
    !onboardingId
  ) {

    return json(
      {
        success:
          false,

        error:
          'onboarding_id is required'
      },
      400
    );
  }

  console.log(
    'CUSTOMER GBP START',
    JSON.stringify({
      onboarding_id:
        onboardingId
    })
  );

  /*
   * LOAD OAUTH STATE
   */

  const stateResponse =
    await supabaseFetch(

      `/rest/v1/google_oauth_states` +

      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}` +

      `&select=` +

      [
        'id',
        'onboarding_id',
        'customer_name',
        'customer_email',
        'customer_phone',
        'google_account_id',
        'google_account_email',
        'google_access_token',
        'google_refresh_token',
        'google_token_expires_at',
        'google_scope'
      ].join(',') +

      `&limit=1`
    );

  if (
    !stateResponse.ok
  ) {

    const detail =
      await stateResponse.text();

    console.error(
      'OAuth state lookup failed',
      {
        status:
          stateResponse.status,

        detail
      }
    );

    return json(
      {
        success:
          false,

        error:
          'Unable to load onboarding connection'
      },
      500
    );
  }

  const states =
    await stateResponse
      .json();

  if (
    !Array.isArray(states) ||
    states.length === 0
  ) {

    return json(
      {
        success:
          false,

        error:
          'Onboarding connection not found'
      },
      404
    );
  }

  const state =
    states[0];

  /*
   * REQUIRE REFRESH TOKEN
   */

  if (
    !state.google_refresh_token
  ) {

    return json(
      {
        success:
          false,

        error:
          'Google connection is not authorized yet'
      },
      400
    );
  }

  console.log(
    'CUSTOMER GBP STATE FOUND',
    JSON.stringify({
      onboarding_id:
        onboardingId,

      google_account_id:
        state.google_account_id ||
        null,

      google_account_email:
        state.google_account_email ||
        null,

      has_access_token:
        !!state.google_access_token,

      has_refresh_token:
        !!state.google_refresh_token
    })
  );

  /*
   * ACCESS TOKEN
   */

  let accessToken =
    state.google_access_token ||
    null;

  const expiresAt =
    state.google_token_expires_at
      ? new Date(
          state.google_token_expires_at
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

    console.log(
      'CUSTOMER GBP REFRESHING TOKEN'
    );

    const refreshed =
      await refreshGoogleToken(
        state.google_refresh_token
      );

    accessToken =
      refreshed.accessToken;

    await updateState(
      state.id,
      {
        google_access_token:
          refreshed.accessToken,

        google_token_expires_at:
          refreshed.expiresAt
      }
    );
  }

  /*
   * GET GOOGLE ACCOUNTS
   */

  const accounts =
    await getGoogleAccounts(
      accessToken
    );

  /*
   * GET LOCATIONS
   */

  const locations =
    [];

  for (
    const account
    of accounts
  ) {

    const accountLocations =
      await getGoogleLocations(
        accessToken,
        account
      );

    for (
      const location
      of accountLocations
    ) {

      locations.push({

        account: {

          name:
            account.name ||
            null,

          account_name:
            account.accountName ||
            null,

          type:
            account.type ||
            null,

          role:
            account.role ||
            null,

          permission_level:
            account.permissionLevel ||
            null,

          verification_state:
            account.verificationState ||
            null
        },

        location: {

          name:
            location.name ||
            null,

          title:
            location.title ||
            null,

          store_code:
            location.storeCode ||
            null,

          website_uri:
            location.websiteUri ||
            null,

          phone_numbers:
            location.phoneNumbers ||
            null,

          storefront_address:
            location.storefrontAddress ||
            null,

          metadata:
            location.metadata ||
            null
        }
      });
    }
  }

  /*
   * COMPLETE
   */

  console.log(
    'CUSTOMER GBP COMPLETE',
    JSON.stringify({
      onboarding_id:
        onboardingId,

      accounts_found:
        accounts.length,

      locations_found:
        locations.length
    })
  );

  /*
   * RESPONSE
   */

  return json({
    success:
      true,

    onboarding_id:
      onboardingId,

    customer: {

      name:
        state.customer_name ||
        null,

      email:
        state.customer_email ||
        null,

      phone:
        state.customer_phone ||
        null
    },

    google_account: {

      id:
        state.google_account_id ||
        null,

      email:
        state.google_account_email ||
        null
    },

    accounts:
      accounts.map(
        account => ({

          name:
            account.name ||
            null,

          account_name:
            account.accountName ||
            null,

          type:
            account.type ||
            null,

          role:
            account.role ||
            null,

          permission_level:
            account.permissionLevel ||
            null,

          verification_state:
            account.verificationState ||
            null
        })
      ),

    locations,

    locations_found:
      locations.length
  });
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

      const onboardingId =
        url.searchParams.get(
          'onboarding_id'
        );

      /*
       * ROUTE 1
       *
       * POST
       * Customer Google OAuth START
       */

      if (
        request.method === 'POST'
      ) {

        return await startCustomerGoogle(
          request
        );
      }

      /*
       * ROUTE 2
       *
       * Google OAuth CALLBACK
       *
       * Google returns:
       * ?code=...
       * ?state=...
       */

      if (
        request.method === 'GET' &&
        code &&
        state
      ) {

        return await customerGoogleCallback(
          request
        );
      }

      /*
       * ROUTE 3
       *
       * Customer Google Business LOCATIONS
       *
       * ?onboarding_id=...
       */

      if (
        request.method === 'GET' &&
        onboardingId
      ) {

        return await loadCustomerGoogleLocations(
          request
        );
      }

      /*
       * UNKNOWN REQUEST
       */

      return json(
        {
          success:
            false,

          error:
            'Invalid customer Google request',

          supported_operations: [
            'POST /api/customer-google',
            'GET /api/customer-google?code=...&state=...',
            'GET /api/customer-google?onboarding_id=...'
          ]
        },
        400
      );

    } catch (
      error
    ) {

      console.error(
        'Customer Google API error:',
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
       * OAuth callback should return HTML.
       * API calls should return JSON.
       */

      if (
        request.method === 'GET'
      ) {

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

      return json(
        {
          success:
            false,

          error:
            'Unable to process customer Google request',

          details:
            error?.message ||
            String(error)
        },
        500
      );
    }
  }
};
