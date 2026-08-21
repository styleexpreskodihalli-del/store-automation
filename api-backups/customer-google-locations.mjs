const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET;


/* ---------------------------------
   JSON RESPONSE
--------------------------------- */

function json(
  body,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
}


/* ---------------------------------
   SUPABASE REQUEST
--------------------------------- */

async function supabaseFetch(
  path,
  options = {}
) {

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Supabase configuration is missing."
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


/* ---------------------------------
   UPDATE GOOGLE TOKEN
--------------------------------- */

async function updateState(
  id,
  values
) {

  return supabaseFetch(
    `/rest/v1/google_oauth_states?id=eq.${encodeURIComponent(id)}`,
    {
      method:
        "PATCH",

      headers: {
        "Content-Type":
          "application/json",

        Prefer:
          "return=minimal"
      },

      body:
        JSON.stringify(values)
    }
  );

}


/* ---------------------------------
   REFRESH GOOGLE ACCESS TOKEN
--------------------------------- */

async function refreshGoogleToken(
  refreshToken
) {

  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET
  ) {
    throw new Error(
      "Google client configuration is missing."
    );
  }

  const response =
    await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/x-www-form-urlencoded"
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
              "refresh_token"

          })
      }
    );


  const data =
    await response
      .json()
      .catch(() => ({}));


  if (
    !response.ok ||
    !data.access_token
  ) {

    console.error(
      "Google token refresh failed",
      {
        status:
          response.status,

        error:
          data?.error || null,

        description:
          data?.error_description || null
      }
    );

    throw new Error(
      "Google authorization has expired. Please reconnect Google Business."
    );

  }


  return {

    accessToken:
      data.access_token,

    expiresAt:
      data.expires_in
        ? new Date(
            Date.now() +
            Number(data.expires_in) *
              1000
          ).toISOString()
        : null

  };

}


/* ---------------------------------
   GOOGLE BUSINESS ACCOUNTS
--------------------------------- */

async function getGoogleAccounts(
  accessToken
) {

  const accounts = [];

  let pageToken = null;


  do {

    const url =
      new URL(
        "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
      );


    url.searchParams.set(
      "pageSize",
      "20"
    );


    if (pageToken) {

      url.searchParams.set(
        "pageToken",
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
        .catch(() => ({}));


    console.log(
      "CUSTOMER GBP ACCOUNTS",
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


    if (!response.ok) {

      throw new Error(
        data?.error?.message ||
        "Unable to load Google Business accounts."
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


  } while (pageToken);


  return accounts;

}


/* ---------------------------------
   GOOGLE BUSINESS LOCATIONS
--------------------------------- */

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


  let pageToken = null;


  do {

    const url =
      new URL(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`
      );


    url.searchParams.set(
      "readMask",
      [
        "name",
        "title",
        "storeCode",
        "websiteUri",
        "phoneNumbers",
        "storefrontAddress",
        "metadata"
      ].join(",")
    );


    url.searchParams.set(
      "pageSize",
      "100"
    );


    if (pageToken) {

      url.searchParams.set(
        "pageToken",
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
        .catch(() => ({}));


    console.log(
      "CUSTOMER GBP LOCATIONS",
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


    if (!response.ok) {

      /*
       * Do NOT crash the entire onboarding
       * if one Google account cannot return
       * locations.
       */

      console.warn(
        "Google locations request failed",
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


  } while (pageToken);


  return locations;

}


/* ---------------------------------
   MAIN FUNCTION
--------------------------------- */

export default {

  async fetch(request) {

    try {

      /* -----------------------------
         METHOD
      ----------------------------- */

      if (
        request.method !== "GET"
      ) {

        return json(
          {
            success:
              false,

            error:
              "Method not allowed"
          },
          405
        );

      }


      /* -----------------------------
         CONFIGURATION
      ----------------------------- */

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY ||
        !GOOGLE_CLIENT_ID ||
        !GOOGLE_CLIENT_SECRET
      ) {

        console.error(
          "Customer GBP configuration missing",
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
              "Customer Google Business configuration missing"
          },
          500
        );

      }


      /* -----------------------------
         ONBOARDING ID
      ----------------------------- */

      const requestUrl =
        new URL(
          request.url
        );


      const onboardingId =
        requestUrl.searchParams.get(
          "onboarding_id"
        );


      if (!onboardingId) {

        return json(
          {
            success:
              false,

            error:
              "onboarding_id is required"
          },
          400
        );

      }


      console.log(
        "CUSTOMER GBP START",
        JSON.stringify({
          onboarding_id:
            onboardingId
        })
      );


      /* -----------------------------
         LOAD OAUTH STATE
      ----------------------------- */

      const stateResponse =
        await supabaseFetch(

          `/rest/v1/google_oauth_states` +

          `?onboarding_id=eq.${encodeURIComponent(
            onboardingId
          )}` +

          `&select=` +

          [
            "id",
            "onboarding_id",
            "customer_name",
            "customer_email",
            "customer_phone",
            "google_account_id",
            "google_account_email",
            "google_access_token",
            "google_refresh_token",
            "google_token_expires_at",
            "google_scope"
          ].join(",") +

          `&limit=1`

        );


      if (
        !stateResponse.ok
      ) {

        const detail =
          await stateResponse.text();


        console.error(
          "OAuth state lookup failed",
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
              "Unable to load onboarding connection"
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
              "Onboarding connection not found"
          },
          404
        );

      }


      const state =
        states[0];


      /* -----------------------------
         CHECK REFRESH TOKEN
      ----------------------------- */

      if (
        !state.google_refresh_token
      ) {

        return json(
          {
            success:
              false,

            error:
              "Google connection is not authorized yet"
          },
          400
        );

      }


      console.log(
        "CUSTOMER GBP STATE FOUND",
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


      /* -----------------------------
         ACCESS TOKEN
      ----------------------------- */

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
          60 * 1000;


      if (needsRefresh) {

        console.log(
          "CUSTOMER GBP REFRESHING TOKEN"
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


      /* -----------------------------
         GET GOOGLE ACCOUNTS
      ----------------------------- */

      const accounts =
        await getGoogleAccounts(
          accessToken
        );


      /* -----------------------------
         GET LOCATIONS
      ----------------------------- */

      const locations = [];


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


      /* -----------------------------
         COMPLETE
      ----------------------------- */

      console.log(
        "CUSTOMER GBP COMPLETE",
        JSON.stringify({

          onboarding_id:
            onboardingId,

          accounts_found:
            accounts.length,

          locations_found:
            locations.length

        })
      );


      /* -----------------------------
         RESPONSE
      ----------------------------- */

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


    } catch (error) {

      /* -----------------------------
         NEVER CRASH SILENTLY
      ----------------------------- */

      console.error(
        "CUSTOMER GOOGLE BUSINESS LOCATIONS ERROR",
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


      return json(
        {
          success:
            false,

          error:
            error?.message ||
            "Unable to load Google Business locations"
        },
        500
      );

    }

  }

};
