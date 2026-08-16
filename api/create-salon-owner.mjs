const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const APP_URL =
  process.env.APP_URL ||
  'https://store-automation.vercel.app';

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
       * Identify the currently logged-in STall user.
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
       * Verify that the current user is an STall admin.
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
        name,
        owner_name,
        owner_email,
        phone,
        whatsapp,
        address,
        website,
        google_business_url,
        instagram_url
      } = body;

      if (
        !name?.trim() ||
        !owner_name?.trim() ||
        !owner_email?.trim()
      ) {
        return json({
          error:
            'Salon name, owner name and owner email are required'
        }, 400);
      }

      const email =
        owner_email.trim().toLowerCase();

      /*
       * Generate the next SALON-XXX code.
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
       * Create the universal business.
       *
       * This admin-created-owner flow creates a NEW business.
       * Existing businesses are never matched by name.
       *
       * Google listing identity is resolved separately through
       * google_place_id in the business-mapping flow.
       */
      const businessResponse =
        await supabaseFetch(
          `/rest/v1/businesses`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'return=representation'
            },
            body: JSON.stringify({
              business_name: name.trim(),
              business_type: 'salon',
              phone: phone?.trim() || null,
              website: website?.trim() || null,
              address: address?.trim() || null,
              status: 'active',
              automation_enabled: true,
              approval_required: true
            })
          }
        );

      if (!businessResponse.ok) {
        console.error(
          'Business creation failed:',
          await businessResponse.text()
        );

        return json({
          error: 'Unable to create business'
        }, 500);
      }

      const createdBusinesses =
        await businessResponse.json();

      const business =
        Array.isArray(createdBusinesses)
          ? createdBusinesses[0]
          : createdBusinesses;

      if (!business?.id) {
        return json({
          error:
            'Business was created but no business ID was returned'
        }, 500);
      }

      /*
       * Create the salon and explicitly link it to the business.
       */
      const newSalon = {
        salon_code: salonCode,
        business_id: business.id,
        name: name.trim(),
        owner_name: owner_name.trim(),
        owner_email: email,
        phone: phone?.trim() || null,
        whatsapp: whatsapp?.trim() || null,
        address: address?.trim() || null,
        website: website?.trim() || null,
        google_business_url:
          google_business_url?.trim() || null,
        instagram_url:
          instagram_url?.trim() || null,
        automation_enabled: true,
        approval_required: true,
        status: 'active',
        updated_at:
          new Date().toISOString()
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
          error: 'Unable to create salon'
        }, 500);
      }

      const salon = createdSalons[0];

      /*
       * Check whether the owner already has a STore account.
       *
       * Existing owners must NOT receive another invitation.
       * We simply attach their existing user account to this salon.
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

        await supabaseFetch(
          `/rest/v1/salons` +
          `?id=eq.${encodeURIComponent(salon.id)}`,
          {
            method: 'DELETE'
          }
        );

        return json({
          error:
            'Unable to check whether the salon owner already has an account'
        }, 500);
      }

      const existingUser =
        (usersData?.users || []).find(
          user =>
            user.email?.toLowerCase() === email
        );

      if (existingUser) {

        /*
         * Jack already has a STore/Supabase account.
         */
        ownerUserId = existingUser.id;
        invitationStatus = 'existing_user';

        console.log(
          'Existing STore user found:',
          email,
          ownerUserId
        );

      } else {

        /*
         * New owner:
         * create the Auth user through Supabase invitation.
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
                  salon_code:
                    salon.salon_code
                },
                redirect_to: APP_URL
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

          await supabaseFetch(
            `/rest/v1/salons` +
            `?id=eq.${encodeURIComponent(salon.id)}`,
            {
              method: 'DELETE'
            }
          );

          return json({
            error:
              inviteData?.msg ||
              inviteData?.message ||
              inviteData?.error_description ||
              inviteData?.error ||
              'Unable to invite salon owner',
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
       * Create application profile.
       */
      const profileInsertResponse =
        await supabaseFetch(
          `/rest/v1/profiles`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
            },
            body: JSON.stringify({
              id: ownerUserId,
              full_name: owner_name.trim(),
              role: 'salon_owner',
              phone: phone?.trim() || null,
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
            'Salon created, but owner profile could not be created'
        }, 500);
      }

      /*
       * Create universal business ownership.
       *
       * Business ownership is the canonical authorization layer.
       */
      const businessMembershipResponse =
        await supabaseFetch(
          `/rest/v1/business_users`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
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
            'Salon was created, but universal business ownership could not be established'
        }, 500);
      }

      /*
       * Create salon membership.
       *
       * Kept temporarily for backward compatibility with the existing
       * salon-based application flows.
       */
      const membershipResponse =
        await supabaseFetch(
          `/rest/v1/salon_members`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
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
            'Salon was created, but the owner could not be linked to the salon'
        }, 500);
      }

      return json({
        success: true,
        salon_id: salon.id,
        business_id: business.id,
        salon_code: salon.salon_code,
        salon_name: salon.name,
        owner_name: owner_name.trim(),
        owner_email: email,
        owner_user_id: ownerUserId,
        invitation_status: invitationStatus
      });

    } catch (error) {
      console.error(
        'Create salon owner error:',
        error
      );

      return json({
        error:
          'Unable to create salon and owner account'
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
