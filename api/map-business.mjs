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
       * ------------------------------------------------------------
       * 1. VALIDATE CURRENT STore USER
       * ------------------------------------------------------------
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

      const currentEmail =
        String(user.email || '')
          .trim()
          .toLowerCase();

      /*
       * ------------------------------------------------------------
       * 2. CHECK ADMIN STATUS
       * ------------------------------------------------------------
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

      /*
       * ------------------------------------------------------------
       * 3. READ REQUEST
       * ------------------------------------------------------------
       */
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
       * ------------------------------------------------------------
       * 4. FIND EXISTING STore BUSINESS BY GOOGLE PLACE ID
       * ------------------------------------------------------------
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

      /*
       * ------------------------------------------------------------
       * 5. REUSE EXISTING BUSINESS
       * ------------------------------------------------------------
       */
      if (existing.length) {

        business = existing[0];

        /*
         * IMPORTANT:
         *
         * This is an EXISTING Google Business.
         *
         * We must NOT create another STore business.
         *
         * We also refresh the Google-derived business information.
         */
        const updateResponse =
          await supabaseFetch(
            `/rest/v1/businesses` +
            `?id=eq.${encodeURIComponent(business.id)}`,
            {
              method: 'PATCH',

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
                    business_type || business.business_type || null,

                  phone:
                    phone || business.phone || null,

                  website:
                    website || business.website || null,

                  address:
                    address || business.address || null,

                  city:
                    city || business.city || null,

                  state:
                    state || business.state || null,

                  country:
                    country || business.country || null,

                  postal_code:
                    postal_code ||
                    business.postal_code ||
                    null,

                  latitude:
                    latitude ??
                    business.latitude ??
                    null,

                  longitude:
                    longitude ??
                    business.longitude ??
                    null,

                  google_maps_url:
                    google_maps_url ||
                    business.google_maps_url ||
                    null,

                  google_rating:
                    google_rating ??
                    business.google_rating ??
                    null,

                  google_review_count:
                    google_review_count ??
                    business.google_review_count ??
                    null
                })
            }
          );

        if(updateResponse.ok){
          const updated =
            await updateResponse.json();

          if(Array.isArray(updated) && updated[0]){
            business = updated[0];
          }
        }
      }

      /*
       * ------------------------------------------------------------
       * 6. CREATE BUSINESS ONLY IF IT DOES NOT EXIST
       * ------------------------------------------------------------
       */
      else {

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

      /*
       * ------------------------------------------------------------
       * 7. ADMIN FLOW
       * ------------------------------------------------------------
       */
      if (isStallAdmin) {

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
       * ------------------------------------------------------------
       * 8. FIND EXISTING STore OWNER
       * ------------------------------------------------------------
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

      /*
       * ------------------------------------------------------------
       * 9. EXISTING OWNER
       * ------------------------------------------------------------
       */
      if (owners.length) {

        const existingOwner =
          owners[0];

        /*
         * If the current Supabase user is already the owner,
         * everything is fine.
         */
        if(existingOwner.user_id === user.id){

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
         * --------------------------------------------------------
         * 10. GOOGLE IDENTITY CHECK
         * --------------------------------------------------------
         *
         * THIS IS THE IMPORTANT FIX.
         *
         * A Google Business can already be connected to an older
         * STore user ID while the same Gmail is now logging in
         * through a new Supabase user.
         *
         * We therefore check the Google connection before declaring
         * "another account".
         * --------------------------------------------------------
         */

        if(currentEmail){

          const googleConnectionResponse =
            await supabaseFetch(
              `/rest/v1/google_connections` +
              `?business_id=eq.${encodeURIComponent(business.id)}` +
              `&select=*` +
              `&limit=10`
            );

          if(googleConnectionResponse.ok){

            const connections =
              await googleConnectionResponse.json();

            const matchingConnection =
              connections.find(connection => {

                const googleEmail =
                  String(
                    connection.google_account_email ||
                    connection.account_email ||
                    connection.email ||
                    ''
                  )
                  .trim()
                  .toLowerCase();

                return (
                  googleEmail &&
                  googleEmail === currentEmail
                );
              });

            /*
             * SAME GOOGLE ACCOUNT
             *
             * The STore user ID changed, but the Google identity
             * is the same. Reassign the STore owner relationship.
             */
            if(matchingConnection){

              console.log(
                'Same Google identity detected. Reassigning STore ownership:',
                {
                  business_id:
                    business.id,

                  old_user_id:
                    existingOwner.user_id,

                  new_user_id:
                    user.id,

                  google_email:
                    currentEmail
                }
              );

              /*
               * Remove the stale owner relationship.
               */
              const deleteOwnerResponse =
                await supabaseFetch(
                  `/rest/v1/business_users` +
                  `?id=eq.${encodeURIComponent(existingOwner.id)}`,
                  {
                    method:
                      'DELETE'
                  }
                );

              if(!deleteOwnerResponse.ok){

                console.error(
                  'Unable to remove stale owner:',
                  await deleteOwnerResponse.text()
                );

                return json({
                  success: false,

                  business_id:
                    business.id,

                  next_step:
                    'owner_reassignment_required',

                  error:
                    'The Google account matches this business, but the existing STore ownership record could not be updated.'
                }, 500);
              }

              /*
               * Create the new owner relationship.
               */
              const createOwnerResponse =
                await supabaseFetch(
                  `/rest/v1/business_users`,
                  {
                    method:
                      'POST',

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

              if(!createOwnerResponse.ok){

                const detail =
                  await createOwnerResponse.text();

                console.error(
                  'New owner creation failed:',
                  detail
                );

                return json({
                  success: false,

                  business_id:
                    business.id,

                  next_step:
                    'owner_reassignment_required',

                  error:
                    'Google identity matched, but STore owner access could not be reassigned.',

                  detail
                }, 500);
              }

              return successResponse(
                business,
                'google_identity_owner_reconnected'
              );
            }
          }
        }

        /*
         * --------------------------------------------------------
         * 11. DIFFERENT GOOGLE ACCOUNT
         * --------------------------------------------------------
         *
         * Only NOW do we return access_required.
         */
        console.warn(
          'Business access denied - different owner/account:',
          {
            business_id:
              business.id,

            place_id,

            requesting_user_id:
              user.id,

            owner_user_id:
              existingOwner.user_id,

            requesting_google_email:
              currentEmail
          }
        );

        return json({
          success: false,

          business_id:
            business.id,

          next_step:
            'access_required',

          error:
            'This business profile is already connected to another Google account. The account owner must grant you access.'
        });
      }

      /*
       * ------------------------------------------------------------
       * 12. NO OWNER EXISTS
       * ------------------------------------------------------------
       */
      const createOwnerResponse =
        await supabaseFetch(
          `/rest/v1/business_users`,
          {
            method:
              'POST',

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


/*
 * ================================================================
 * SUCCESS RESPONSE
 * ================================================================
 */
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


/*
 * ================================================================
 * SUPABASE SERVICE-ROLE REQUEST
 * ================================================================
 */
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


/*
 * ================================================================
 * JSON RESPONSE
 * ================================================================
 */
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
