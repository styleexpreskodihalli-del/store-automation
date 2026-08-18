const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'GET') {
        return json(
          { error: 'Method not allowed' },
          405
        );
      }

      const authHeader =
        request.headers.get('authorization') || '';

      if (!authHeader.startsWith('Bearer ')) {
        return json(
          { error: 'Missing Supabase authorization' },
          401
        );
      }

      const supabaseAccessToken =
        authHeader.slice(7);

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY
      ) {
        return json(
          { error: 'Supabase server configuration missing' },
          500
        );
      }

      /*
       * Validate the logged-in STore user.
       */
      const userResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          headers: {
            apikey:
              SUPABASE_SERVICE_ROLE_KEY,
            Authorization:
              `Bearer ${supabaseAccessToken}`
          }
        }
      );

      if (!userResponse.ok) {
        return json(
          { error: 'Invalid Supabase session' },
          401
        );
      }

      const user =
        await userResponse.json();

      const url =
        new URL(request.url);

      const businessId =
        url.searchParams.get('business_id');

      console.log(
        'GBP LOCATIONS STEP 01',
        JSON.stringify({
          business_id: businessId
        })
      );

      if (!businessId) {
        return json(
          { error: 'business_id is required' },
          400
        );
      }

      /*
       * Verify the authenticated user belongs
       * to this universal business.
       */
      const memberResponse =
        await supabaseFetch(
          `/rest/v1/business_users` +
          `?business_id=eq.${encodeURIComponent(businessId)}` +
          `&user_id=eq.${encodeURIComponent(user.id)}` +
          `&select=id,role` +
          `&limit=1`
        );

      if (!memberResponse.ok) {
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

      console.log(
        'GBP LOCATIONS STEP 02 MEMBERS',
        JSON.stringify({
          count: Array.isArray(members)
            ? members.length
            : 0
        })
      );

      if (!members.length) {
        return json(
          {
            error:
              'You are not authorized to manage this business'
          },
          403
        );
      }

      /*
       * Load the Google connection for this business.
       */
      const connectionResponse =
        await supabaseFetch(
          `/rest/v1/google_connections` +
          `?business_id=eq.${encodeURIComponent(businessId)}` +
          `&select=id,business_id,google_account_id,google_account_email,access_token,refresh_token,token_expires_at,scope,google_place_id,business_profile_account_id,business_profile_location_id,business_profile_location_name,authorization_status,access_status,connection_status,last_error` +
          `&limit=1`
        );

      if (!connectionResponse.ok) {
        console.error(
          'Google connection lookup failed:',
          await connectionResponse.text()
        );

        return json(
          {
            error:
              'Unable to load Google connection'
          },
          500
        );
      }

      const connections =
        await connectionResponse.json();

      console.log(
        'GBP LOCATIONS STEP 03 CONNECTION',
        JSON.stringify({
          count: Array.isArray(connections)
            ? connections.length
            : 0
        })
      );

      if (!connections.length) {
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

      if (!connection.refresh_token) {
        return json(
          {
            error:
              'Google connection is missing a refresh token'
          },
          400
        );
      }

      /*
       * Authorization is not the same as verified Business Profile access.
       *
       * Until the exact Google Place ID -> GBP location match succeeds,
       * Google automation must remain disabled.
       */
      const locationVerified =
        connection.access_status === 'verified' &&
        connection.connection_status === 'location_selected';

      if (
        connection.authorization_status === 'authorized' &&
        !locationVerified
      ) {
        console.log(
          'Google authorization exists, but GBP location is not verified:',
          {
            business_id: businessId,
            connection_status:
              connection.connection_status || null,
            access_status:
              connection.access_status || null
          }
        );
      }

      /*
       * Refresh the Google access token when needed.
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
        if (
          !GOOGLE_CLIENT_ID ||
          !GOOGLE_CLIENT_SECRET
        ) {
          return json(
            {
              error:
                'Google OAuth configuration missing'
            },
            500
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
      }

      /*
       * Get all Google Business Profile accounts
       * available to the authorized Google user.
       *
       * Current Account Management API:
       * GET /v1/accounts
       */
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

        console.log(
          'GBP LOCATIONS STEP 04 GOOGLE ACCOUNTS',
          JSON.stringify({
            status: accountsResponse.status,
            ok: accountsResponse.ok,
            account_count:
              Array.isArray(accountsData.accounts)
                ? accountsData.accounts.length
                : 0,
            error:
              accountsData.error?.message ||
              null
          })
        );

        if (!accountsResponse.ok) {
          console.error(
            'Google accounts lookup failed:',
            {
              status:
                accountsResponse.status,
              error:
                accountsData.error ||
                null
            }
          );

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
       * Retrieve locations from each accessible
       * account.
       *
       * We use the v1 Business Information API.
       */
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

          console.log(
            'GBP LOCATIONS STEP 05 GOOGLE LOCATIONS',
            JSON.stringify({
              account: accountName,
              status: locationsResponse.status,
              ok: locationsResponse.ok,
              location_count:
                Array.isArray(locationsData.locations)
                  ? locationsData.locations.length
                  : 0,
              error:
                locationsData.error?.message ||
                null
            })
          );

          if (!locationsResponse.ok) {
            /*
             * One account failing should not prevent
             * us from returning locations from other
             * accessible accounts.
             */
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

      /*
       * Load the mapped Google Place ID from the
       * universal business record.
       */
      const businessResponse =
        await supabaseFetch(
          `/rest/v1/businesses` +
          `?id=eq.${encodeURIComponent(businessId)}` +
          `&select=id,business_name,google_place_id` +
          `&limit=1`
        );

      let mappedPlaceId = null;
      let normalizedPlaceId = null;
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

      /*
       * Phase 3B:
       * Match the universal business Google Place ID
       * against Google Business Profile locations.
       *
       * Google Business Information API exposes the
       * public Place ID through location.metadata.placeId.
       *
       * We only auto-select when there is an exact match.
       * We never guess based on business name alone.
       */
      let matchedLocation = null;

      if (mappedPlaceId) {
        normalizedPlaceId =
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
            matchedLocation = item;
            break;
          }
        }
      }

      /*
       * Persist the exact Google Business Profile mapping
       * when an exact Place ID match is found.
       */
      if (matchedLocation) {
        const accountName =
          matchedLocation.account?.name || null;

        const locationName =
          matchedLocation.location?.name || null;

        const locationTitle =
          matchedLocation.location?.title || null;

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
              body: JSON.stringify({
                google_place_id:
                  normalizedPlaceId,

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

          console.error(
            'Google Business Profile mapping save failed:',
            detail
          );

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

        console.log(
          'Google Business Profile location matched:',
          {
            business_id:
              businessId,
            google_place_id:
              normalizedPlaceId,
            account:
              accountName,
            location:
              locationName,
            title:
              locationTitle
          }
        );
      }

      /*
       * OAuth authorization alone does not activate Google Business
       * automation. The authorized Google account must contain the
       * exact Google Business Profile location matching the Business
       * Place ID.
       */
      if (!matchedLocation) {
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
        success: true,

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

          /*
           * Google automation is enabled ONLY after the exact
           * Google Place ID -> GBP location match succeeds.
           */
          access_status:
            matchedLocation
              ? 'verified'
              : 'unverified',

          connection_status:
            matchedLocation
              ? 'location_selected'
              : 'location_matching'
        },

        accounts: accounts.map(
          account => ({
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
          })
        ),

        locations:
          allLocations,

        locations_found:
          allLocations.length
      });

    } catch (error) {
      console.error(
        'Google business locations error:',
        {
          name:
            error?.name || null,
          message:
            error?.message || String(error),
          stack:
            error?.stack || null
        }
      );

      return json(
        {
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
