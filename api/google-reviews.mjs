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


// ============================================================
// MAIN HANDLER
// POST /api/google-reviews
//
// Body:
// {
//   "business_id": "..."
//
// }
//
// This version:
// 1. Authenticates STall user
// 2. Verifies business membership
// 3. Loads that business's Google connection
// 4. Refreshes Google token when required
// 5. Fetches Google reviews
// 6. Upserts reviews into public.reviews
//
// No AI.
// No automatic replies.
// No index.html changes.
// ============================================================

export default {
  async fetch(request) {
    try {

      if (request.method !== 'POST') {
        return json(
          {
            error:
              'Method not allowed'
          },
          405
        );
      }


      // --------------------------------------------------------
      // SERVER CONFIGURATION
      // --------------------------------------------------------

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY ||
        !GOOGLE_CLIENT_ID ||
        !GOOGLE_CLIENT_SECRET
      ) {
        console.error(
          'Google reviews server configuration missing'
        );

        return json(
          {
            error:
              'Google reviews server configuration is missing'
          },
          500
        );
      }


      // --------------------------------------------------------
      // AUTHENTICATE CURRENT STore USER
      // --------------------------------------------------------

      const auth =
        await getAuthenticatedUser(
          request
        );

      if (auth.error) {
        return auth.error;
      }

      const user =
        auth.user;


      // --------------------------------------------------------
      // READ REQUEST
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // VERIFY USER HAS ACCESS TO THIS BUSINESS
      // --------------------------------------------------------

      const membership =
        await verifyBusinessMembership(
          businessId,
          user.id
        );

      if (!membership.ok) {
        return membership.response;
      }


      // --------------------------------------------------------
      // LOAD GOOGLE CONNECTION
      // --------------------------------------------------------

      const connectionResult =
        await getGoogleConnection(
          businessId
        );

      if (!connectionResult.ok) {
        return connectionResult.response;
      }

      const connection =
        connectionResult.connection;


      // --------------------------------------------------------
      // VERIFY GOOGLE BUSINESS CONNECTION
      // --------------------------------------------------------

      if (
        connection.authorization_status !==
          'authorized'
      ) {
        return json(
          {
            error:
              'Google Business authorization is not active for this store.'
          },
          409
        );
      }


      if (
        connection.access_status !==
          'verified'
      ) {
        return json(
          {
            error:
              'Google Business access is not verified for this store.'
          },
          409
        );
      }


      if (
        connection.connection_status !==
          'location_selected'
      ) {
        return json(
          {
            error:
              'A Google Business Profile location has not been selected for this store.'
          },
          409
        );
      }


      if (
        !connection.business_profile_account_id ||
        !connection.business_profile_location_id
      ) {
        return json(
          {
            error:
              'Google Business Profile location information is missing.'
          },
          409
        );
      }


      // --------------------------------------------------------
      // REFRESH GOOGLE ACCESS TOKEN IF REQUIRED
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // FETCH GOOGLE REVIEWS
      // --------------------------------------------------------

      const googleResult =
        await fetchAllGoogleReviews(
          connection,
          accessToken
        );

      if (!googleResult.ok) {
        return googleResult.response;
      }


      // --------------------------------------------------------
      // SAVE REVIEWS TO STore DATABASE
      // --------------------------------------------------------

      const syncResult =
        await syncReviewsToDatabase(
          businessId,
          googleResult.reviews
        );

      if (!syncResult.ok) {
        return syncResult.response;
      }


      // --------------------------------------------------------
      // UPDATE LAST SYNC TIME
      // --------------------------------------------------------

      await updateGoogleConnection(
        businessId,
        {
          last_synced_at:
            new Date().toISOString(),

          last_error:
            null,

          updated_at:
            new Date().toISOString()
        }
      );


      // --------------------------------------------------------
      // SUCCESS
      // --------------------------------------------------------

      return json({
        success: true,

        business_id:
          businessId,

        business_name:
          connection.business_profile_location_name,

        google_review_count:
          googleResult.reviews.length,

        synced_count:
          syncResult.syncedCount,

        reviews:
          syncResult.reviews
      });

    } catch (error) {

      console.error(
        'Google reviews error:',
        error
      );

      return json(
        {
          error:
            'Unable to sync Google reviews',

          detail:
            error?.message ||
            String(error)
        },
        500
      );
    }
  }
};


// ============================================================
// AUTHENTICATE STore USER
// ============================================================

async function getAuthenticatedUser(
  request
) {

  const authHeader =
    request.headers.get(
      'authorization'
    );

  if (
    !authHeader ||
    !authHeader.startsWith(
      'Bearer '
    )
  ) {
    return {
      error:
        json(
          {
            error:
              'Missing Supabase authorization'
          },
          401
        )
    };
  }


  const accessToken =
    authHeader.slice(7);


  const publishableKey =
    SUPABASE_PUBLISHABLE_KEY ||
    SUPABASE_SERVICE_ROLE_KEY;


  if (
    !SUPABASE_URL ||
    !publishableKey
  ) {
    return {
      error:
        json(
          {
            error:
              'Supabase server configuration missing'
          },
          500
        )
    };
  }

const tokenInfoResponse =
  await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );

const tokenInfo =
  await tokenInfoResponse
    .json()
    .catch(() => ({}));

console.log(
  'GOOGLE TOKEN INFO:',
  {
    status:
      tokenInfoResponse.status,

    scope:
      tokenInfo.scope,

    email:
      tokenInfo.email,

    audience:
      tokenInfo.aud
  }
);
  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            publishableKey,

          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );


  if (!response.ok) {

    return {
      error:
        json(
          {
            error:
              'Invalid Supabase session'
          },
          401
        )
    };
  }


  return {
    user:
      await response.json(),

    accessToken
  };
}


// ============================================================
// VERIFY BUSINESS MEMBERSHIP
// ============================================================

async function verifyBusinessMembership(
  businessId,
  userId
) {

  if (
    !businessId ||
    !userId
  ) {
    return {
      ok: false,

      response:
        json(
          {
            error:
              'Business ID is required'
          },
          400
        )
    };
  }


  const response =
    await supabaseFetch(
      `/rest/v1/business_users` +
      `?business_id=eq.${encodeURIComponent(
        businessId
      )}` +
      `&user_id=eq.${encodeURIComponent(
        userId
      )}` +
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

      response:
        json(
          {
            error:
              'Unable to verify business membership'
          },
          500
        )
    };
  }


  const members =
    await response.json();


  if (!members.length) {

    return {
      ok: false,

      response:
        json(
          {
            error:
              'You do not have access to this business'
          },
          403
        )
    };
  }


  return {
    ok: true,

    member:
      members[0]
  };
}
// ============================================================
// GET GOOGLE CONNECTION
// ============================================================

async function getGoogleConnection(
  businessId
) {

  const response =
    await supabaseFetch(
      `/rest/v1/google_connections` +
      `?business_id=eq.${encodeURIComponent(
        businessId
      )}` +
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
        'last_error'
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

      response:
        json(
          {
            error:
              'Unable to load Google connection'
          },
          500
        )
    };
  }


  const connections =
    await response.json();


  if (!connections.length) {

    return {
      ok: false,

      response:
        json(
          {
            error:
              'Google Business is not connected for this store'
          },
          404
        )
    };
  }


  return {
    ok: true,

    connection:
      connections[0]
  };
}


// ============================================================
// REFRESH GOOGLE ACCESS TOKEN
// ============================================================

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
      Date.now() +
      60 * 1000;


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

      response:
        json(
          {
            error:
              'Google OAuth configuration missing'
          },
          500
        )
    };
  }


  if (!connection.refresh_token) {

    return {
      ok: false,

      response:
        json(
          {
            error:
              'Google connection is missing a refresh token. Please reconnect Google Business.'
          },
          401
        )
    };
  }


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


    await updateGoogleConnection(
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

      response:
        json(
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
          Number(
            tokenData.expires_in
          ) *
          1000
        ).toISOString()
      : null;


  await updateGoogleConnection(
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


  return {
    ok: true,

    accessToken
  };
}


// ============================================================
// FETCH ALL GOOGLE REVIEWS
// ============================================================

async function fetchAllGoogleReviews(
  connection,
  accessToken
) {

  const GOOGLE_CLOUD_PROJECT_ID =
    'stall-app-1aab7';

  const accountName =
    connection.business_profile_account_id;

  const locationName =
    connection.business_profile_location_id;

  if (!accountName || !locationName) {
    return {
      ok: false,

      response:
        json(
          {
            error:
              'Google Business Profile account or location is missing'
          },
          409
        )
    };
  }

  const accountId =
    String(accountName)
      .replace(/^accounts\//, '')
      .replace(/\/+$/, '');

  const locationId =
    String(locationName)
      .replace(/^locations\//, '')
      .replace(/\/+$/, '');

  if (!accountId || !locationId) {
    return {
      ok: false,

      response:
        json(
          {
            error:
              'Invalid Google Business Profile account or location ID',

            account:
              accountName,

            location:
              locationName
          },
          409
        )
    };
  }

  const reviews = [];

  let pageToken =
    null;

  do {

    const params =
      new URLSearchParams();

    params.set(
      'pageSize',
      '50'
    );

    params.set(
      'orderBy',
      'updateTime desc'
    );

    if (pageToken) {
      params.set(
        'pageToken',
        pageToken
      );
    }

    const url =
      `https://mybusiness.googleapis.com/v4/accounts/` +
      `${encodeURIComponent(accountId)}/locations/` +
      `${encodeURIComponent(locationId)}/reviews?` +
      params.toString();

    console.log(
      'Google Reviews request:',
      {
        project:
          GOOGLE_CLOUD_PROJECT_ID,

        accountId,

        locationId
      }
    );

    const response =
      await fetch(
        url,
        {
          method:
            'GET',

          headers: {
            Authorization:
              `Bearer ${accessToken}`,

            Accept:
              'application/json',

            'x-goog-user-project':
              GOOGLE_CLOUD_PROJECT_ID
          }
        }
      );

    const rawText =
      await response.text();

    let data = {};

    try {
      data =
        rawText
          ? JSON.parse(rawText)
          : {};
    } catch {
      data = {
        raw_response:
          rawText
      };
    }

    if (!response.ok) {

      console.error(
        'Google Reviews API failed:',
        {
          status:
            response.status,

          statusText:
            response.statusText,

          project:
            GOOGLE_CLOUD_PROJECT_ID,

          accountId,

          locationId,

          response:
            data
        }
      );

      return {
        ok: false,

        response:
          json(
            {
              error:
                'Google could not return reviews',

              google_status:
                response.status,

              google_status_text:
                response.statusText,

              google_error:
                data?.error?.message ||
                data?.error ||
                data?.raw_response ||
                'Unknown Google API error',

              google_error_code:
                data?.error?.code ||
                response.status,

              google_error_status:
                data?.error?.status ||
                null,

              google_error_details:
                data?.error?.details ||
                null,

              project_id:
                GOOGLE_CLOUD_PROJECT_ID,

              account_id:
                accountId,

              location_id:
                locationId
            },

            response.status === 401
              ? 401
              : response.status === 403
                ? 403
                : 502
          )
      };
    }

    const pageReviews =
      Array.isArray(
        data.reviews
      )
        ? data.reviews
        : [];

    reviews.push(
      ...pageReviews
    );

    pageToken =
      data.nextPageToken ||
      null;

  } while (pageToken);

  console.log(
    'Google Reviews fetched successfully:',
    {
      project:
        GOOGLE_CLOUD_PROJECT_ID,

      accountId,

      locationId,

      count:
        reviews.length
    }
  );

  return {
    ok: true,

    reviews
  };
}
// ============================================================
// SYNC REVIEWS INTO public.reviews
// ============================================================

async function syncReviewsToDatabase(
  businessId,
  googleReviews
) {

  if (!Array.isArray(googleReviews)) {

    return {
      ok: false,

      response:
        json(
          {
            error:
              'Invalid Google review data'
          },
          500
        )
    };
  }


  if (!googleReviews.length) {

    return {
      ok: true,

      syncedCount:
        0,

      reviews: []
    };
  }


  const rows =
    googleReviews
      .filter(
        review =>
          review &&
          (
            review.reviewId ||
            review.name
          )
      )
      .map(
        review => {

          const externalReviewId =
            review.reviewId ||
            extractReviewId(
              review.name
            );


          const reviewerName =
            review?.reviewer?.displayName ||
            (
              review?.reviewer?.isAnonymous
                ? 'Anonymous'
                : null
            );


          const rating =
            convertGoogleRating(
              review.starRating
            );


          const responseText =
            review?.reviewReply?.comment ||
            null;


          const responseStatus =
            responseText
              ? 'published'
              : 'pending';


          const respondedAt =
            review?.reviewReply?.updateTime ||
            null;


          return {
            business_id:
              businessId,

            external_review_id:
              externalReviewId,

            reviewer_name:
              reviewerName,

            rating,

            review_text:
              review.comment ||
              null,

            review_date:
              review.createTime ||
              null,

            response_text:
              responseText,

            response_status:
              responseStatus,

            responded_at:
              respondedAt
          };
        }
      )
      .filter(
        row =>
          row.external_review_id
      );


  if (!rows.length) {

    return {
      ok: true,

      syncedCount:
        0,

      reviews: []
    };
  }


  const response =
    await supabaseFetch(
      `/rest/v1/reviews` +
      `?on_conflict=business_id,external_review_id`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=representation'
        },

        body:
          JSON.stringify(
            rows
          )
      }
    );


  if (!response.ok) {

    const detail =
      await response.text();


    console.error(
      'Review database sync failed:',
      detail
    );


    return {
      ok: false,

      response:
        json(
          {
            error:
              'Unable to save Google reviews in STall',

            detail
          },
          500
        )
    };
  }


  const saved =
    await response.json()
      .catch(() => []);


  return {
    ok: true,

    syncedCount:
      rows.length,

    reviews:
      Array.isArray(saved)
        ? saved
        : rows
  };
}


// ============================================================
// GOOGLE STAR RATING → INTEGER
// ============================================================

function convertGoogleRating(
  rating
) {

  switch (rating) {

    case 'ONE':
      return 1;

    case 'TWO':
      return 2;

    case 'THREE':
      return 3;

    case 'FOUR':
      return 4;

    case 'FIVE':
      return 5;

    default:
      return null;
  }
}


// ============================================================
// EXTRACT REVIEW ID
// ============================================================

function extractReviewId(
  name
) {

  if (!name) {
    return null;
  }


  const parts =
    String(name)
      .split('/');


  return (
    parts[parts.length - 1] ||
    null
  );
}


// ============================================================
// UPDATE GOOGLE CONNECTION
// ============================================================

async function updateGoogleConnection(
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


  if (!response.ok) {

    console.error(
      'Google connection update failed:',
      await response.text()
    );
  }


  return response;
}


// ============================================================
// SUPABASE SERVICE ROLE REQUEST
// ============================================================

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


// ============================================================
// REMOVE TRAILING SLASH
// ============================================================

function stripTrailingSlash(
  value
) {

  return String(
    value || ''
  ).replace(
    /\/+$/,
    ''
  );
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  body,
  status = 200
) {

  return new Response(
    JSON.stringify(
      body
    ),

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
