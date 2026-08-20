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

function json(body, status = 200) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store'
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
   UPDATE OAUTH STATE
--------------------------------- */

async function updateState(
  id,
  values
) {

  return supabaseFetch(
    `/rest/v1/google_oauth_states?id=eq.${encodeURIComponent(id)}`,
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
}


/* ---------------------------------
   MAIN
--------------------------------- */

export default {

  async fetch(request) {

    try {

      /* ---------------------------------
         METHOD
      --------------------------------- */

      if (request.method !== 'GET') {

        return json(
          {
            error:
              'Method not allowed'
          },
          405
        );

      }


      /* ---------------------------------
         CONFIGURATION
      --------------------------------- */

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY ||
        !GOOGLE_CLIENT_ID ||
        !GOOGLE_CLIENT_SECRET
      ) {

        console.error(
          'Customer GBP configuration missing'
        );

        return json(
          {
            success: false,
            error:
              'Customer Google Business configuration missing'
          },
          500
        );

      }


      /* ---------------------------------
         READ ONBOARDING ID
      --------------------------------- */

      const url =
        new URL(request.url);

      const onboardingId =
        url.searchParams.get(
          'onboarding_id'
        );


      if (!onboardingId) {

        return json(
          {
            success: false,
            error:
              'onboarding_id is required'
          },
          400
        );

      }


      /* ---------------------------------
         LOAD OAUTH STATE
      --------------------------------- */

      const stateResponse =
        await supabaseFetch(
          `/rest/v1/google_oauth_states` +
          `?onboarding_id=eq.${encodeURIComponent(onboardingId)}` +
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


      if (!stateResponse.ok) {

        const detail =
          await stateResponse.text();

        console.error(
          'Customer OAuth state lookup failed:',
          detail
        );

        return json(
          {
            success: false,

            error:
              'Unable to load onboarding connection',

            supabase_status:
              stateResponse.status,

            supabase_details:
              detail || null
          },
          500
        );

      }


      const states =
        await stateResponse.json();


      if (
        !Array.isArray(states) ||
        !states.length
      ) {

        return json(
          {
            success: false,

            error:
              'Onboarding connection not found',

            onboarding_id:
              onboardingId
          },
          404
        );

      }


      const state =
        states[0];


      /* ---------------------------------
         CHECK GOOGLE REFRESH TOKEN
      --------------------------------- */

      if (!state.google_refresh_token) {

        return json(
          {
            success: false,

            error:
              'Google connection is not authorized yet',

            onboarding_id:
              onboardingId
          },
          400
        );

      }


      console.log(
        'CUSTOMER GBP STEP 01 STATE',
        JSON.stringify(
          {
            onboarding_id:
              onboardingId,

            google_account_id:
              state.google_account_id ||
              null,

            google_account_email:
              state.google_account_email ||
              null,

            google_scope:
              state.google_scope ||
              null
          }
        )
      );


      /* ---------------------------------
         ACCESS TOKEN
      --------------------------------- */

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


      /* ---------------------------------
         REFRESH GOOGLE ACCESS TOKEN
      --------------------------------- */

      if (needsRefresh) {

        console.log(
          'CUSTOMER GBP TOKEN REFRESH REQUIRED'
        );


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
                new URLSearchParams(
                  {
                    client_id:
                      GOOGLE_CLIENT_ID,

                    client_secret:
                      GOOGLE_CLIENT_SECRET,

                    refresh_token:
                      state.google_refresh_token,

                    grant_type:
                      'refresh_token'
                  }
                )
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
            'Customer Google token refresh failed:',
            {
              status:
                tokenResponse.status,

              error:
                tokenData.error ||
                null,

              description:
                tokenData.error_description ||
                null
            }
          );


          await updateState(
            state.id,
            {
              google_access_token:
                null,

              google_token_expires_at:
                null
            }
          );


          return json(
            {
              success: false,

              error:
                'Google authorization has expired. Please reconnect Google Business.',

              google_status:
                tokenResponse.status,

              google_error:
                tokenData.error ||
                null,

              google_error_description:
                tokenData.error_description ||
                null
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
                ) * 1000
              ).toISOString()
            : null;


        await updateState(
          state.id,
          {
            google_access_token:
              accessToken,

            google_token_expires_at:
              newExpiresAt
          }
        );

      }


      /* ---------------------------------
         VERIFY ACCESS TOKEN EXISTS
      --------------------------------- */

      if (!accessToken) {

        return json(
          {
            success: false,

            error:
              'Google access token is unavailable. Please reconnect Google Business.'
          },
          401
        );

      }


      /* ---------------------------------
         GET GOOGLE BUSINESS ACCOUNTS
      --------------------------------- */

      const accounts = [];

      let accountsPageToken =
        null;


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


        console.log(
          'CUSTOMER GBP STEP 02 REQUEST',
          accountsUrl.toString()
        );


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
            .catch(
              () => ({})
            );


        console.log(
          'CUSTOMER GBP STEP 02 ACCOUNTS',
          JSON.stringify(
            {
              status:
                accountsResponse.status,

              ok:
                accountsResponse.ok,

              account_count:
                Array.isArray(
                  accountsData.accounts
                )
                  ? accountsData.accounts.length
                  : 0,

              error:
                accountsData.error ||
                null
            },
            null,
            2
          )
        );


        /* ---------------------------------
           IMPORTANT:
           RETURN ACTUAL GOOGLE ERROR
        --------------------------------- */

        if (!accountsResponse.ok) {

          console.error(
            'GOOGLE ACCOUNTS API ERROR:',
            JSON.stringify(
              accountsData,
              null,
              2
            )
          );


          return json(
            {
              success: false,

              error:
                accountsData.error?.message ||
                'Unable to load Google Business accounts',

              google_status:
                accountsResponse.status,

              google_error:
                accountsData.error?.status ||
                null,

              google_reason:
                accountsData.error?.reason ||
                null,

              google_details:
                accountsData.error?.details ||
                null,

              google_response:
                accountsData
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


      } while (
        accountsPageToken
      );


      /* ---------------------------------
         NO ACCOUNTS
      --------------------------------- */

      if (!accounts.length) {

        console.warn(
          'CUSTOMER GBP: NO ACCOUNTS FOUND'
        );


        return json(
          {
            success: true,

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

            accounts: [],

            locations: [],

            locations_found:
              0,

            message:
              'No Google Business Profile accounts were found for this Google account.'
          }
        );

      }


      /* ---------------------------------
         GET LOCATIONS
      --------------------------------- */

      const locations = [];


      for (
        const account
        of accounts
      ) {

        if (!account?.name) {
          continue;
        }


        const accountName =
          account.name;


        let locationsPageToken =
          null;


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


          console.log(
            'CUSTOMER GBP STEP 03 LOCATION REQUEST',
            locationsUrl.toString()
          );


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
              .catch(
                () => ({})
              );


          console.log(
            'CUSTOMER GBP STEP 03 LOCATIONS',
            JSON.stringify(
              {
                account:
                  accountName,

                status:
                  locationsResponse.status,

                ok:
                  locationsResponse.ok,

                location_count:
                  Array.isArray(
                    locationsData.locations
                  )
                    ? locationsData.locations.length
                    : 0,

                error:
                  locationsData.error ||
                  null
              },
              null,
              2
            )
          );


          /* ---------------------------------
             IMPORTANT:
             DO NOT SILENTLY IGNORE GOOGLE ERROR
          --------------------------------- */

          if (!locationsResponse.ok) {

            console.error(
              'GOOGLE LOCATIONS API ERROR:',
              JSON.stringify(
                locationsData,
                null,
                2
              )
            );


            return json(
              {
                success: false,

                error:
                  locationsData.error?.message ||
                  'Unable to load Google Business locations',

                google_status:
                  locationsResponse.status,

                google_error:
                  locationsData.error?.status ||
                  null,

                google_reason:
                  locationsData.error?.reason ||
                  null,

                google_details:
                  locationsData.error?.details ||
                  null,

                google_response:
                  locationsData,

                account:
                  accountName
              },
              502
            );

          }


          const accountLocations =
            Array.isArray(
              locationsData.locations
            )
              ? locationsData.locations
              : [];


          for (
            const location
            of accountLocations
          ) {

            locations.push(

              {

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

              }

            );

          }


          locationsPageToken =
            locationsData.nextPageToken ||
            null;


        } while (
          locationsPageToken
        );

      }


      /* ---------------------------------
         COMPLETE
      --------------------------------- */

      console.log(
        'CUSTOMER GBP STEP 04 COMPLETE',
        JSON.stringify(
          {
            onboarding_id:
              onboardingId,

            accounts_found:
              accounts.length,

            locations_found:
              locations.length
          },
          null,
          2
        )
      );


      /* ---------------------------------
         FINAL RESPONSE
      --------------------------------- */

      return json(
        {

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

        }
      );


    } catch (error) {

      console.error(
        'Customer Google business locations error:',
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
            'Unable to load Google Business locations',

          details:
            error?.message ||
            String(error)

        },
        500
      );

    }

  }

};
