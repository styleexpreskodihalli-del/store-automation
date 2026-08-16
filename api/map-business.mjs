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

      /*
       * Validate logged-in STore user.
       */
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

      /*
       * Determine whether the authenticated STall user is an admin.
       *
       * Admins can discover/map a business for onboarding, but must
       * NEVER become the business owner automatically.
       */
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

      /*
       * Check whether this Google Place is already mapped.
       */
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

      if (existing.length) {

        business = existing[0];

      } else {

        /*
         * Create universal business record.
         */
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
            'Business was created but no business ID was returned'
        }, 500);
      }

      /*
       * ADMIN ONBOARDING FLOW
       *
       * An STall admin may discover/map a business for onboarding,
       * but mapping a Google business must NOT make the admin its owner.
       *
       * Ownership will be established through the actual owner approval
       * and Google authorization workflow.
       */
      if (isStallAdmin) {

        console.log(
          'Business mapped for STall admin onboarding:',
          {
            business_id: business.id,
            place_id,
            admin_user_id: user.id
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

      /*
       * OWNER FLOW
       *
       * Non-admin users continue through the existing ownership
       * protection logic. This preserves the current owner-created
       * store flow while we build the approval workflow separately.
       */
      /*
       * Verify whether this business already has an owner.
       *
       * Ownership is intentionally separate from Business identity.
       * A user may own multiple Businesses, but a Business may not
       * silently acquire a second owner through this mapping flow.
       */
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

      if (owners.length) {
        const existingOwner = owners[0];

        /*
         * Business already has an owner.
         *
         * Existing owner may continue using the Business.
         * A different user must go through the access workflow.
         */
        if (existingOwner.user_id !== user.id) {
          console.warn(
            'Business access denied - already owned by another user:',
            {
              business_id: business.id,
              place_id,
              requesting_user_id: user.id,
              owner_user_id: existingOwner.user_id
            }
          );

          return json({
            success: false,
            business_id: business.id,
            next_step: 'access_required',
            error:
              'This business profile is already connected to another account. ' +
              'The account owner must grant you access.'
          });
        }

        /*
         * Current user is already the owner.
         * Ownership is already satisfied.
         */
        console.log(
          'Business ownership already established:',
          {
            business_id: business.id,
            user_id: user.id
          }
        );

      } else {

        /*
         * No owner exists.
         *
         * Create ownership. The database UNIQUE constraint on
         * (business_id, user_id) makes this relationship idempotent
         * against duplicate requests.
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
              'Business created but owner access could not be assigned',
            detail
          }, 500);
        }
      }

      console.log(
        'Business mapped:',
        {
          business_id:
            business.id,
          place_id,
          user_id:
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

        next_step:
          'authorize_google'
      });

    } catch (error) {

      console.error(
        'Map business error:',
        error
      );

      return json({
        error:
          'Unable to map business'
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
