const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

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

async function updateState(id, values) {
  return supabaseFetch(
    `/rest/v1/google_oauth_states?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(values)
    }
  );
}

export default {
  async fetch(request) {
    try {
      if (request.method !== 'GET') {
        return json(
          { error: 'Method not allowed' },
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
          'Customer GBP configuration missing'
        );

        return json(
          {
            error:
              'Customer Google Business configuration missing'
          },
          500
        );
      }

      const url =
        new URL(request.url);

      const onboardingId =
        url.searchParams.get(
          'onboarding_id'
        );

      if (!onboardingId) {
        return json(
          {
            error:
              'onboarding_id is required'
          },
          400
        );
      }

      /*
       * Load the customer OAuth state.
       *
       * The state must contain:
       * - onboarding_id
       * - Google authorization data
       *
       * We deliberately do not require a Supabase
       * user session because this is pre-store onboarding.
       */
      const stateResponse =
        await supabaseFetch(
          `/rest/v1/google_oauth_states` +
          `?onboarding_id=eq.${encodeURIComponent(onboardingId)}` +
          `&select=id,onboarding_id,customer_name,customer_email,customer_phone,google_account_id,google_account_email,google_access_token,google_refresh_token,google_token_expires_at,google_scope` +
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
            error:
              'Unable to load onboarding connection'
          },
          500
        );
      }

      const states =
        await stateResponse.json();

      if (!Array.isArray(states) || !states.length) {
        return json(
          {
            error:
              'Onboarding connection not found'
          },
          404
        );
      }

      const state =
        states[0];

      if (!state.google_refresh_token) {
        return json(
          {
            error:
              'Google connection is not authorized yet'
          },
          400
        );
      }

      console.log(
        'CUSTOMER GBP STEP 01 STATE',
        JSON.stringify({
          onboarding_id:
            onboardingId,
          google_account_id:
            state.google_account_id || null,
          google_account_email:
            state.google_account_email || null
        })
      );

      /*
       * Refresh Google access token when required.
       */
      let accessToken =
        state.google_access_token || null;

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
              body:
                new URLSearchParams({
                  client_id:
                    GOOGLE_CLIENT_ID,
                  client_secret:
                    GOOGLE_CLIENT_SECRET,
                  refresh_token:
                    state.google_refresh_token,
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
            'Customer Google token refresh failed:',
            {
              status:
                tokenResponse.status,
              error:
                tokenData.error || null
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

      /*
       * Retrieve all Google Business Profile accounts.
       */
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

        console.log(
          'CUSTOMER GBP STEP 02 ACCOUNTS',
          JSON.stringify({
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
              accountsData.error?.message ||
              null
          })
        );

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

      /*
       * Retrieve locations from every accessible
       * Google Business Profile account.
       */
      const locations = [];

      for (const account of accounts) {
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

          console.log(
            'CUSTOMER GBP STEP 03 LOCATIONS',
            JSON.stringify({
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
                locationsData.error?.message ||
                null
            })
          );

          if (!locationsResponse.ok) {
            console.warn(
              'Google locations lookup failed:',
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
            locations.push({
              account: {
                name:
                  account.name || null,
                account_name:
                  account.accountName ||
                  null,
                type:
                  account.type || null,
                role:
                  account.role || null,
                permission_level:
                  account.permissionLevel ||
                  null
              },

              location: {
                name:
                  location.name || null,
                title:
                  location.title || null,
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

          locationsPageToken =
            locationsData.nextPageToken ||
            null;

        } while (locationsPageToken);
      }

      console.log(
        'CUSTOMER GBP STEP 04 COMPLETE',
        JSON.stringify({
          onboarding_id:
            onboardingId,
          accounts_found:
            accounts.length,
          locations_found:
            locations.length
        })
      );

      return json({
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

        accounts:
          accounts.map(account => ({
            name:
              account.name || null,
            account_name:
              account.accountName ||
              null,
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

        locations,

        locations_found:
          locations.length
      });

    } catch (error) {
      console.error(
        'Customer Google business locations error:',
        {
          name:
            error?.name || null,
          message:
            error?.message ||
            String(error),
          stack:
            error?.stack || null
        }
      );

      return json(
        {
          error:
            'Unable to load Google Business locations'
        },
        500
      );
    }
  }
};
