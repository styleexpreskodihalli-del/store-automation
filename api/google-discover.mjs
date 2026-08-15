const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'GET') {
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

      /*
       * Find the salon owned by the authenticated user.
       */
      const memberResponse = await supabaseFetch(
        `/rest/v1/salon_members` +
        `?user_id=eq.${encodeURIComponent(user.id)}` +
        `&select=salon_id,role` +
        `&limit=1`
      );

      if (!memberResponse.ok) {
        console.error(
          'Salon membership lookup failed:',
          await memberResponse.text()
        );
        return json({ error: 'Unable to find salon' }, 500);
      }

      const members = await memberResponse.json();

      if (!members.length) {
        return json({ error: 'No salon is assigned to this account' }, 404);
      }

      const salonId = members[0].salon_id;

      /*
       * Read salon information for matching.
       */
      const salonResponse = await supabaseFetch(
        `/rest/v1/salons` +
        `?id=eq.${encodeURIComponent(salonId)}` +
        `&select=id,name,address,phone,website` +
        `&limit=1`
      );

      if (!salonResponse.ok) {
        console.error(
          'Salon lookup failed:',
          await salonResponse.text()
        );
        return json({ error: 'Unable to load salon' }, 500);
      }

      const salons = await salonResponse.json();

      if (!salons.length) {
        return json({ error: 'Salon not found' }, 404);
      }

      const salon = salons[0];

      /*
       * Read the stored Google connection.
       */
      const connectionResponse = await supabaseFetch(
        `/rest/v1/google_business_connections` +
        `?salon_id=eq.${encodeURIComponent(salonId)}` +
        `&select=id,google_account_id,google_account_email,access_token,refresh_token,token_expires_at,scope,connection_status` +
        `&limit=1`
      );

      if (!connectionResponse.ok) {
        console.error(
          'Google connection lookup failed:',
          await connectionResponse.text()
        );
        return json({ error: 'Unable to load Google connection' }, 500);
      }

      const connections = await connectionResponse.json();

      if (!connections.length) {
        return json({ error: 'Google Business is not connected' }, 404);
      }

      const connection = connections[0];

      if (!connection.refresh_token) {
        return json({
          error: 'Google connection is missing a refresh token. Please reconnect Google Business.'
        }, 400);
      }

      /*
       * Refresh access token when missing or expired.
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
              'content-type': 'application/x-www-form-urlencoded'
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

        if (!tokenResponse.ok || !tokenData.access_token) {
          console.error(
            'Google token refresh failed:',
            tokenData.error || tokenData.error_description || 'unknown error'
          );

          await updateConnection(salonId, {
            connection_status: 'error',
            last_error: 'Google access token refresh failed',
            updated_at: new Date().toISOString()
          });

          return json({
            error: 'Google authorization has expired. Please reconnect Google Business.'
          }, 401);
        }

        accessToken = tokenData.access_token;

        const newExpiresAt = tokenData.expires_in
          ? new Date(
              Date.now() + Number(tokenData.expires_in) * 1000
            ).toISOString()
          : null;

        await updateConnection(salonId, {
          access_token: accessToken,
          token_expires_at: newExpiresAt,
          connection_status: 'connected',
          last_error: null,
          updated_at: new Date().toISOString()
        });
      }

      /*
       * Discover all Business Profile accounts accessible
       * to the connected Google user.
       */
      const accounts = [];

      let accountPageToken = null;

      do {
        const accountUrl =
          new URL(
            'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
          );

        accountUrl.searchParams.set('pageSize', '20');

        if (accountPageToken) {
          accountUrl.searchParams.set(
            'pageToken',
            accountPageToken
          );
        }

        const accountsResponse = await fetch(
          accountUrl.toString(),
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        const accountsData = await accountsResponse.json();

        if (!accountsResponse.ok) {
          console.error(
            'Google accounts.list failed:',
            accountsData
          );

          return json({
            error: 'Unable to retrieve Google Business accounts',
            google_status: accountsResponse.status
          }, 502);
        }

        if (Array.isArray(accountsData.accounts)) {
          accounts.push(...accountsData.accounts);
        }

        accountPageToken = accountsData.nextPageToken || null;

      } while (accountPageToken);

      /*
       * Retrieve locations from each accessible account.
       *
       * We request only the fields required for matching and display.
       */
      const locations = [];

      for (const account of accounts) {
        if (!account?.name) continue;

        let pageToken = null;

        do {
          const locationUrl =
            new URL(
              `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`
            );

          locationUrl.searchParams.set(
            'readMask',
            [
              'name',
              'title',
              'storeCode',
              'phoneNumbers',
              'websiteUri',
              'storefrontAddress'
            ].join(',')
          );

          locationUrl.searchParams.set('pageSize', '100');

          if (pageToken) {
            locationUrl.searchParams.set(
              'pageToken',
              pageToken
            );
          }

          const locationsResponse = await fetch(
            locationUrl.toString(),
            {
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            }
          );

          const locationsData =
            await locationsResponse.json();

          if (!locationsResponse.ok) {
            console.error(
              'Google locations.list failed:',
              locationsData
            );

            /*
             * Continue to other accessible accounts instead
             * of failing the entire discovery.
             */
            break;
          }

          for (const location of locationsData.locations || []) {
            locations.push({
              account_name: account.name,
              account_display_name: account.accountName || null,
              account_type: account.type || null,

              location_id: location.name || null,
              location_name: location.title || null,
              store_code: location.storeCode || null,

              phone:
                location.phoneNumbers?.primaryPhone || null,

              website:
                location.websiteUri || null,

              address:
                formatAddress(location.storefrontAddress),

              raw_name:
                location.name || null
            });
          }

          pageToken =
            locationsData.nextPageToken || null;

        } while (pageToken);
      }

      /*
       * Match the discovered locations against the salon.
       */
      const rankedLocations = locations
        .map(location => ({
          ...location,
          match_score: matchLocation(salon, location)
        }))
        .sort((a, b) => b.match_score - a.match_score);

      /*
       * Do not automatically attach a weak match.
       * Return candidates to the owner/UI.
       */
      const bestMatch =
        rankedLocations.length
          ? rankedLocations[0]
          : null;

      return json({
        success: true,

        salon: {
          id: salon.id,
          name: salon.name
        },

        google_account: {
          email: connection.google_account_email || null,
          accounts_found: accounts.length
        },

        locations_found: rankedLocations.length,

        best_match:
          bestMatch && bestMatch.match_score >= 60
            ? bestMatch
            : null,

        locations: rankedLocations.slice(0, 50)
      });

    } catch (error) {
      console.error('Google discovery error:', error);

      return json({
        error: 'Unable to discover Google Business locations'
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
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(options.headers || {})
      }
    }
  );
}

async function updateConnection(salonId, values) {
  const response = await supabaseFetch(
    `/rest/v1/google_business_connections` +
    `?salon_id=eq.${encodeURIComponent(salonId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
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
}

function formatAddress(address) {
  if (!address) return null;

  return [
    ...(address.addressLines || []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
    address.regionCode
  ]
    .filter(Boolean)
    .join(', ');
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchLocation(salon, location) {
  let score = 0;

  const salonName = normalize(salon.name);
  const locationName = normalize(location.location_name);

  if (salonName && locationName) {
    if (salonName === locationName) {
      score += 50;
    } else if (
      locationName.includes(salonName) ||
      salonName.includes(locationName)
    ) {
      score += 35;
    } else {
      const salonWords = salonName.split(' ').filter(Boolean);
      const matchedWords = salonWords.filter(word =>
        locationName.includes(word)
      );

      score += Math.min(
        30,
        matchedWords.length * 10
      );
    }
  }

  const salonPhone = normalize(salon.phone);
  const locationPhone = normalize(location.phone);

  if (
    salonPhone &&
    locationPhone &&
    salonPhone.slice(-10) === locationPhone.slice(-10)
  ) {
    score += 25;
  }

  const salonWebsite = normalize(salon.website);
  const locationWebsite = normalize(location.website);

  if (
    salonWebsite &&
    locationWebsite &&
    (
      salonWebsite.includes(locationWebsite) ||
      locationWebsite.includes(salonWebsite)
    )
  ) {
    score += 15;
  }

  const salonAddress = normalize(salon.address);
  const locationAddress = normalize(location.address);

  if (salonAddress && locationAddress) {
    const words = salonAddress
      .split(' ')
      .filter(word => word.length >= 4);

    const matched = words.filter(word =>
      locationAddress.includes(word)
    );

    if (matched.length >= 2) {
      score += 20;
    }
  }

  return Math.min(score, 100);
}

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
