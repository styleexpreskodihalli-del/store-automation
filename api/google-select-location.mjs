const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json(
          { error: 'Method not allowed' },
          405
        );
      }

      const authHeader =
        request.headers.get('authorization');

      if (!authHeader?.startsWith('Bearer ')) {
        return json(
          { error: 'Missing Supabase authorization' },
          401
        );
      }

      const supabaseAccessToken =
        authHeader.slice(7);

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

      const body =
        await request.json()
          .catch(() => null);

      if (!body) {
        return json(
          { error: 'Invalid request body' },
          400
        );
      }

      const {
        salon_id,
        place_id,
        business_location_name,
        address,
        website,
        google_maps_url
      } = body;

      if (!salon_id || !place_id) {
        return json({
          error:
            'Salon and Google Place ID are required'
        }, 400);
      }

      /*
       * Verify that the authenticated user
       * belongs to this salon.
       */
      const memberResponse =
        await supabaseFetch(
          `/rest/v1/salon_members` +
          `?salon_id=eq.${encodeURIComponent(salon_id)}` +
          `&user_id=eq.${encodeURIComponent(user.id)}` +
          `&select=salon_id,role` +
          `&limit=1`
        );

      if (!memberResponse.ok) {
        console.error(
          'Salon membership lookup failed:',
          await memberResponse.text()
        );

        return json({
          error:
            'Unable to verify salon membership'
        }, 500);
      }

      const members =
        await memberResponse.json();

      if (!members.length) {
        return json({
          error:
            'You are not authorized to manage this salon'
        }, 403);
      }

      /*
       * Confirm the salon exists.
       */
      const salonResponse =
        await supabaseFetch(
          `/rest/v1/salons` +
          `?id=eq.${encodeURIComponent(salon_id)}` +
          `&select=id,name,salon_code` +
          `&limit=1`
        );

      if (!salonResponse.ok) {
        return json({
          error:
            'Unable to load salon'
        }, 500);
      }

      const salons =
        await salonResponse.json();

      if (!salons.length) {
        return json({
          error: 'Salon not found'
        }, 404);
      }

      /*
       * Save the selected Google Place.
       *
       * business_location_id is intentionally used
       * to store the Google Place ID.
       */
      const updateData = {
        business_account_id:
          'places',

        business_location_id:
          place_id,

        business_location_name:
          business_location_name || null,

        connection_status:
          'location_selected',

        last_synced_at:
          new Date().toISOString(),

        last_error:
          null,

        updated_at:
          new Date().toISOString()
      };

      const updateResponse =
        await supabaseFetch(
          `/rest/v1/google_business_connections` +
          `?salon_id=eq.${encodeURIComponent(salon_id)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json',
              Prefer:
                'return=minimal'
            },
            body:
              JSON.stringify(updateData)
          }
        );

      if (!updateResponse.ok) {
        const saveError =
          await updateResponse.text();

        console.error(
          'Google Place mapping save failed:',
          {
            status: updateResponse.status,
            detail: saveError
          }
        );

        return json({
          error:
            'Unable to save Google Business Profile mapping',
          supabase_status:
            updateResponse.status,
          detail:
            saveError || null
        }, 500);
      }

      /*
       * Save the public Google listing URL into
       * the salon profile when supplied.
       */
      if (
        google_maps_url ||
        address ||
        website
      ) {
        const salonUpdate = {};

        if (google_maps_url) {
          salonUpdate.google_business_url =
            google_maps_url;
        }

        if (website) {
          salonUpdate.website =
            website;
        }

        if (address) {
          salonUpdate.address =
            address;
        }

        if (Object.keys(salonUpdate).length) {
          await supabaseFetch(
            `/rest/v1/salons` +
            `?id=eq.${encodeURIComponent(salon_id)}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type':
                  'application/json',
                Prefer:
                  'return=minimal'
              },
              body:
                JSON.stringify(salonUpdate)
            }
          );
        }
      }

      console.log(
        'Google Place mapped:',
        {
          salon_id,
          place_id,
          business_location_name
        }
      );

      return json({
        success: true,
        salon_id,
        place_id,
        business_location_name:
          business_location_name || null,
        connection_status:
          'location_selected'
      });

    } catch (error) {
      console.error(
        'Google Place selection error:',
        error
      );

      return json({
        error:
          'Unable to save Google Business Profile'
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
