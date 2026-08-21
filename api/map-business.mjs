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

      const accessToken =
        authHeader.slice(7);

      // ------------------------------------------------------------
      // 1. VALIDATE CURRENT STore USER
      // ------------------------------------------------------------

      const userResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          headers: {
            apikey:
              SUPABASE_SERVICE_ROLE_KEY,
            Authorization:
              `Bearer ${accessToken}`
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

      // ------------------------------------------------------------
      // 2. CHECK ADMIN STATUS
      // ------------------------------------------------------------

      let isStallAdmin = false;

      const profileResponse =
        await supabaseFetch(
          `/rest/v1/profiles` +
          `?id=eq.${encodeURIComponent(user.id)}` +
          `&select=id,role` +
          `&limit=1`
        );

      if (profileResponse.ok) {
        const profiles =
          await profileResponse.json();

        isStallAdmin =
          profiles.length > 0 &&
          profiles[0].role === 'admin';
      }

      // ------------------------------------------------------------
      // 3. READ REQUEST
      // ------------------------------------------------------------

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
        place_id,
        business_name,
        business_type,
        phone,
        website,
        address,
        city,
        state,
        country,
        postal_code,
        latitude,
        longitude,
        google_maps_url,
        google_rating,
        google_review_count
      } = body;

      if (!place_id || !business_name) {
        return json({
          error:
            'Google Place ID and business name are required'
        }, 400);
      }

      // ------------------------------------------------------------
      // 4. FIND EXISTING STore BUSINESS
      // ------------------------------------------------------------

      const existingResponse =
        await supabaseFetch(
          `/rest/v1/businesses` +
          `?google_place_id=eq.${encodeURIComponent(place_id)}` +
          `&select=*` +
          `&limit=1`
        );

      if (!existingResponse.ok) {
        console.error(
          'Existing business lookup failed:',
          await existingResponse.text()
        );

        return json({
          error:
            'Unable to check existing business'
        }, 500);
      }

      const existing =
        await existingResponse.json();

      let business;

      // ------------------------------------------------------------
      // 5. REUSE EXISTING BUSINESS
      // ------------------------------------------------------------

      if (existing.length) {

        business = existing[0];

        /*
         * IMPORTANT:
         *
         * The business already exists in STore.
         *
         * We deliberately do NOT automatically transfer ownership.
         *
         * We also do not use Google email matching as proof that
         * the current user should replace the existing STore owner.
         */

      } else {

        // ----------------------------------------------------------
        // 6. CREATE NEW BUSINESS
        // ----------------------------------------------------------

        const businessResponse =
          await supabaseFetch(
            `/rest/v1/businesses`,
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',

                Prefer:
                  'return=representation'
              },

              body:
                JSON.stringify({
                  business_name,

                  business_type:
                    business_type || null,

                  phone:
                    phone || null,

                  website:
                    website || null,

                  address:
                    address || null,

                  city:
                    city || null,

                  state:
                    state || null,

                  country:
                    country || null,

                  postal_code:
                    postal_code || null,

                  latitude:
                    latitude ?? null,

                  longitude:
                    longitude ?? null,

                  google_place_id:
                    place_id,

                  google_maps_url:
                    google_maps_url || null,

                  google_rating:
                    google_rating ?? null,

                  google_review_count:
                    google_review_count ?? null,

                  status:
                    'active',

                  automation_enabled:
                    false,

                  approval_required:
                    true
                })
            }
          );

        if (!businessResponse.ok) {
          const detail =
            await businessResponse.text();

          console.error(
            'Business creation failed:',
            detail
          );

          return json({
            error:
              'Unable to create business',
            detail
          }, 500);
        }

        const created =
          await businessResponse.json();

        business =
          Array.isArray(created)
            ? created[0]
            : created;
      }

      if (!business?.id) {
        return json({
          error:
            'Business was created/found but no business ID was returned'
        }, 500);
      }

      // ------------------------------------------------------------
      // 7. ADMIN FLOW
      // ------------------------------------------------------------

      if (isStallAdmin) {

        console.log(
          'Business mapped for STall admin onboarding:',
          {
            business_id:
              business.id,

            place_id,

            admin_user_id:
              user.id
          }
        );

        return json({
          success: true,

          business: {
            id:
              business.id,

            business_name:
              business.business_name,

            business_type:
              business.business_type,

            google_place_id:
              business.google_place_id,

            google_maps_url:
              business.google_maps_url
          },

          onboarding_source:
            'admin',

          onboarding_status:
            'pending_owner_approval',

          next_step:
            'owner_approval'
        });
      }

      // ------------------------------------------------------------
      // 8. FIND EXISTING STore OWNER
      // ------------------------------------------------------------

      const ownerResponse =
        await supabaseFetch(
          `/rest/v1/business_users` +
          `?business_id=eq.${encodeURIComponent(business.id)}` +
          `&role=eq.owner` +
          `&select=id,user_id,role` +
          `&limit=1`
        );

      if (!ownerResponse.ok) {
        console.error(
          'Business owner lookup failed:',
          await ownerResponse.text()
        );

        return json({
          error:
            'Unable to verify business ownership'
        }, 500);
      }

      const owners =
        await ownerResponse.json();

      // ------------------------------------------------------------
      // 9. BUSINESS ALREADY HAS AN OWNER
      // ------------------------------------------------------------

      if (owners.length) {

        const existingOwner =
          owners[0];

        /*
         * Current user is already the owner.
         *
         * This is allowed.
         */
        if (existingOwner.user_id === user.id) {

          console.log(
            'Existing STore owner confirmed:',
            {
              business_id:
                business.id,

              user_id:
                user.id
            }
          );

          return successResponse(
            business,
            'existing_owner'
          );
        }

        /*
         * DIFFERENT USER
         *
         * This is the critical security rule.
         *
         * NEVER:
         * - compare Google email and transfer ownership
         * - delete the existing owner
         * - automatically replace the owner
         *
         * A separate ownership-transfer/access workflow must be used.
         */

        console.warn(
          'Business access denied - different STore owner:',
          {
            business_id:
              business.id,

            place_id,

            requesting_user_id:
              user.id,

            owner_user_id:
              existingOwner.user_id
          }
        );

        return json({
          success: false,

          business_id:
            business.id,

          next_step:
            'access_required',

          error:
            'This business profile is already connected to another STore account. The account owner must grant access or transfer ownership.'
        });
      }

      // ------------------------------------------------------------
      // 10. NO OWNER EXISTS
      // ------------------------------------------------------------

      /*
       * The business exists but currently has no STore owner.
       *
       * The authenticated user can become the first STore owner.
       *
       * This is what allows a new owner to connect multiple
       * previously-unclaimed businesses.
       */

      const createOwnerResponse =
        await supabaseFetch(
          `/rest/v1/business_users`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              Prefer:
                'resolution=ignore-duplicates,return=minimal'
            },

            body:
              JSON.stringify({
                business_id:
                  business.id,

                user_id:
                  user.id,

                role:
                  'owner'
              })
          }
        );

      if (!createOwnerResponse.ok) {

        const detail =
          await createOwnerResponse.text();

        console.error(
          'Business owner creation failed:',
          detail
        );

        return json({
          error:
            'Business created/found but owner access could not be assigned',

          detail
        }, 500);
      }

      console.log(
        'New STore owner created:',
        {
          business_id:
            business.id,

          user_id:
            user.id
        }
      );

      return successResponse(
        business,
        'new_owner'
      );

    } catch (error) {

      console.error(
        'Map business error:',
        error
      );

      return json({
        error:
          'Unable to map business',

        detail:
          error?.message ||
          String(error)
      }, 500);
    }
  }
};


// ================================================================
// SUPABASE SERVICE-ROLE REQUEST
// ================================================================

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


// ================================================================
// SUCCESS RESPONSE
// ================================================================

function successResponse(
  business,
  connectionType
) {
  return json({

    success: true,

    business: {

      id:
        business.id,

      business_name:
        business.business_name,

      business_type:
        business.business_type,

      phone:
        business.phone,

      website:
        business.website,

      address:
        business.address,

      city:
        business.city,

      state:
        business.state,

      country:
        business.country,

      postal_code:
        business.postal_code,

      latitude:
        business.latitude,

      longitude:
        business.longitude,

      google_place_id:
        business.google_place_id,

      google_maps_url:
        business.google_maps_url,

      google_rating:
        business.google_rating,

      google_review_count:
        business.google_review_count
    },

    connection_type:
      connectionType,

    next_step:
      'authorize_google'
  });
}


// ================================================================
// JSON RESPONSE
// ================================================================

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
