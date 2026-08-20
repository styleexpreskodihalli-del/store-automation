const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }

      const authHeader =
        request.headers.get('authorization');

      if (!authHeader?.startsWith('Bearer ')) {
        return json({
          error: 'Missing Supabase authorization'
        }, 401);
      }

      const accessToken = authHeader.slice(7);

      /*
       * Identify the logged-in STall user.
       */
      const userResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!userResponse.ok) {
        return json({
          error: 'Invalid Supabase session'
        }, 401);
      }

      const adminUser = await userResponse.json();

      /*
       * Verify STall administrator.
       */
      const profileResponse = await supabaseFetch(
        `/rest/v1/profiles` +
        `?id=eq.${encodeURIComponent(adminUser.id)}` +
        `&select=id,role` +
        `&limit=1`
      );

      if (!profileResponse.ok) {
        console.error(
          'Admin profile lookup failed:',
          await profileResponse.text()
        );

        return json({
          error: 'Unable to verify administrator'
        }, 500);
      }

      const profiles = await profileResponse.json();

      if (
        !profiles.length ||
        profiles[0].role !== 'admin'
      ) {
        return json({
          error: 'Administrator access required'
        }, 403);
      }

      const body =
        await request.json().catch(() => null);

      if (!body) {
        return json({
          error: 'Invalid request body'
        }, 400);
      }

      const {
        business_id,
        owner_name,
        owner_email
      } = body;

      if (
        !business_id?.trim() ||
        !owner_name?.trim() ||
        !owner_email?.trim()
      ) {
        return json({
          error:
            'Business ID, owner name and owner email are required'
        }, 400);
      }

      const email =
        owner_email.trim().toLowerCase();

      /*
       * IMPORTANT:
       * We are NOT creating a new business here.
       *
       * The business was already created/reused by
       * /api/map-business using the selected Google Place ID.
       */
      const businessResponse = await supabaseFetch(
        `/rest/v1/businesses` +
        `?id=eq.${encodeURIComponent(business_id)}` +
        `&select=id,business_name,business_type,phone,website,address,google_place_id,status` +
        `&limit=1`
      );

      if (!businessResponse.ok) {
        console.error(
          'Business lookup failed:',
          await businessResponse.text()
        );

        return json({
          error: 'Unable to verify selected business'
        }, 500);
      }

      const businesses =
        await businessResponse.json();

      if (!businesses.length) {
        return json({
          error:
            'Selected Google business could not be found'
        }, 404);
      }

      const business = businesses[0];

      /*
       * Generate next SALON-XXX code.
       */
      const salonResponse = await supabaseFetch(
        `/rest/v1/salons?select=salon_code`
      );

      if (!salonResponse.ok) {
        console.error(
          'Existing salon lookup failed:',
          await salonResponse.text()
        );

        return json({
          error: 'Unable to read existing salons'
        }, 500);
      }

      const existingSalons =
        await salonResponse.json();

      let highestNumber = 0;

      for (const salon of existingSalons) {
        const match =
          /^SALON-(\d+)$/i.exec(
            salon.salon_code || ''
          );

        if (match) {
          highestNumber =
            Math.max(
              highestNumber,
              Number(match[1])
            );
        }
      }

      const salonCode =
        `SALON-${String(
          highestNumber + 1
        ).padStart(3, '0')}`;

      /*
       * Prevent the same business from being added twice.
       */
      const existingBusinessSalonResponse =
        await supabaseFetch(
          `/rest/v1/salons` +
          `?business_id=eq.${encodeURIComponent(business.id)}` +
          `&select=id,salon_code,name,owner_name,owner_email,business_id` +
          `&limit=1`
        );

      if (!existingBusinessSalonResponse.ok) {
        console.error(
          'Existing business salon lookup failed:',
          await existingBusinessSalonResponse.text()
        );

        return json({
          error:
            'Unable to verify whether this store already exists'
        }, 500);
      }

      const existingBusinessSalons =
        await existingBusinessSalonResponse.json();

      if (existingBusinessSalons.length) {
        const existingSalon =
          existingBusinessSalons[0];

        return json({
          success: true,
          already_exists: true,
          salon_id: existingSalon.id,
          salon_code: existingSalon.salon_code,
          salon_name: existingSalon.name,
          business_id: business.id,
          business_name: business.business_name,
          owner_name: existingSalon.owner_name,
          owner_email: existingSalon.owner_email,
          invitation_status: 'not_sent'
        });
      }

      /*
       * Create salon using the EXISTING Google business.
       */
      const newSalon = {
        salon_code: salonCode,
        business_id: business.id,
        name: business.business_name,
        owner_name: owner_name.trim(),
        owner_email: email,
        phone: business.phone || null,
        address: business.address || null,
        website: business.website || null,
        automation_enabled: true,
        approval_required: true,
        status: 'active',
        updated_at: new Date().toISOString()
      };

      const createSalonResponse =
        await supabaseFetch(
          `/rest/v1/salons`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'return=representation'
            },
            body: JSON.stringify(newSalon)
          }
        );

      const createdSalons =
        await createSalonResponse
          .json()
          .catch(() => []);

      if (
        !createSalonResponse.ok ||
        !createdSalons.length
      ) {
        console.error(
          'Salon creation failed:',
          createdSalons
        );

        return json({
          error: 'Unable to create store'
        }, 500);
      }

      const salon = createdSalons[0];

      /*
       * Find existing STore/Supabase user.
       */
      let ownerUserId = null;
      let invitationStatus = 'existing_user';

      const usersResponse =
        await fetch(
          `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
          {
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization:
                `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            }
          }
        );

      const usersData =
        await usersResponse
          .json()
          .catch(() => null);

      if (!usersResponse.ok) {
        console.error(
          'Existing user lookup failed:',
          usersData
        );

        await deleteSalon(salon.id);

        return json({
          error:
            'Unable to check whether the store owner already has an account'
        }, 500);
      }

      const existingUser =
        (usersData?.users || []).find(
          user =>
            user.email?.toLowerCase() === email
        );

      if (existingUser) {
        ownerUserId = existingUser.id;

        console.log(
          'Existing STore user found:',
          email,
          ownerUserId
        );

      } else {

        /*
         * New owner — send invitation.
         */
        const inviteResponse =
          await fetch(
            `${SUPABASE_URL}/auth/v1/invite`,
            {
              method: 'POST',
              headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization:
                  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type':
                  'application/json'
              },
              body: JSON.stringify({
                email,
                data: {
                  full_name:
                    owner_name.trim(),
                  role: 'salon_owner',
                  salon_id: salon.id,
                  salon_code: salon.salon_code,
                  business_id: business.id
                },
                redirect_to:
                  'https://store-automation.vercel.app'
              })
            }
          );

        const inviteData =
          await inviteResponse
            .json()
            .catch(() => null);

        if (
          !inviteResponse.ok ||
          !inviteData?.id
        ) {
          console.error(
            'Owner invitation failed:',
            {
              status:
                inviteResponse.status,
              data: inviteData
            }
          );

          await deleteSalon(salon.id);

          return json({
            error:
              inviteData?.msg ||
              inviteData?.message ||
              inviteData?.error_description ||
              inviteData?.error ||
              'Unable to invite store owner',
            auth_status:
              inviteResponse.status
          }, 502);
        }

        ownerUserId =
          inviteData.id;

        invitationStatus =
          'invitation_sent';
      }

      /*
       * Create/update application profile.
       */
      const profileInsertResponse =
        await supabaseFetch(
          `/rest/v1/profiles`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify({
              id: ownerUserId,
              full_name: owner_name.trim(),
              role: 'salon_owner',
              phone: business.phone || null,
              updated_at:
                new Date().toISOString()
            })
          }
        );

      if (!profileInsertResponse.ok) {
        console.error(
          'Owner profile creation failed:',
          await profileInsertResponse.text()
        );

        return json({
          error:
            'Store created, but owner profile could not be created'
        }, 500);
      }

      /*
       * Universal business ownership.
       */
      const businessMembershipResponse =
        await supabaseFetch(
          `/rest/v1/business_users`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'resolution=ignore-duplicates,return=minimal'
            },
            body: JSON.stringify({
              business_id: business.id,
              user_id: ownerUserId,
              role: 'owner'
            })
          }
        );

      if (!businessMembershipResponse.ok) {
        console.error(
          'Business ownership creation failed:',
          await businessMembershipResponse.text()
        );

        return json({
          error:
            'Store was created, but business ownership could not be established'
        }, 500);
      }

      /*
       * Backward-compatible salon membership.
       */
      const membershipResponse =
        await supabaseFetch(
          `/rest/v1/salon_members`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'resolution=ignore-duplicates,return=minimal'
            },
            body: JSON.stringify({
              salon_id: salon.id,
              user_id: ownerUserId,
              role: 'owner'
            })
          }
        );

      if (!membershipResponse.ok) {
        console.error(
          'Salon membership creation failed:',
          await membershipResponse.text()
        );

        return json({
          error:
            'Store was created, but the owner could not be linked to the store'
        }, 500);
      }

      /*
       * Store creation completed.
       */
      return json({
        success: true,
        already_exists: false,
        salon_id: salon.id,
        business_id: business.id,
        salon_code: salon.salon_code,
        salon_name: salon.name,
        business_name: business.business_name,
        google_place_id:
          business.google_place_id || null,
        owner_name: owner_name.trim(),
        owner_email: email,
        owner_user_id: ownerUserId,
        invitation_status: invitationStatus
      });

    } catch (error) {
      console.error(
        'Create store from Google error:',
        error
      );

      return json({
        error:
          'Unable to create store and owner account'
      }, 500);
    }
  }
};

async function deleteSalon(salonId) {
  try {
    await supabaseFetch(
      `/rest/v1/salons?id=eq.${encodeURIComponent(salonId)}`,
      {
        method: 'DELETE'
      }
    );
  } catch (error) {
    console.error(
      'Salon cleanup failed:',
      error
    );
  }
}

async function supabaseFetch(
  path,
  options = {}
) {
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
