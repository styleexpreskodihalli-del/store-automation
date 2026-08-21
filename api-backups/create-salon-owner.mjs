const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const APP_URL =
  process.env.APP_URL ||
  'https://store-automation.vercel.app';

export default {
  async fetch(request) {
    try {
      /* ---------------------------------
         ONLY POST
      --------------------------------- */

      if (request.method !== 'POST') {
        return json({
          success: false,
          error: 'Method not allowed'
        }, 405);
      }

      /* ---------------------------------
         SUPABASE CONFIG
      --------------------------------- */

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY
      ) {
        console.error(
          'Supabase configuration missing'
        );

        return json({
          success: false,
          error: 'Server configuration is incomplete'
        }, 500);
      }

      /* ---------------------------------
         AUTHORIZATION
      --------------------------------- */

      const authHeader =
        request.headers.get('authorization');

      if (
        !authHeader ||
        !authHeader.startsWith('Bearer ')
      ) {
        return json({
          success: false,
          error: 'Missing Supabase authorization'
        }, 401);
      }

      const accessToken =
        authHeader.slice(7).trim();

      if (!accessToken) {
        return json({
          success: false,
          error: 'Invalid Supabase authorization'
        }, 401);
      }

      /* ---------------------------------
         IDENTIFY CURRENT USER
      --------------------------------- */

      const userResponse =
        await fetch(
          `${SUPABASE_URL}/auth/v1/user`,
          {
            method: 'GET',
            headers: {
              apikey:
                SUPABASE_SERVICE_ROLE_KEY,

              Authorization:
                `Bearer ${accessToken}`
            }
          }
        );

      if (!userResponse.ok) {
        console.error(
          'Supabase user lookup failed:',
          await userResponse.text()
        );

        return json({
          success: false,
          error: 'Invalid Supabase session'
        }, 401);
      }

      const currentUser =
        await userResponse.json();

      if (!currentUser?.id) {
        return json({
          success: false,
          error: 'Unable to identify logged-in user'
        }, 401);
      }

      const currentUserId =
        currentUser.id;

      const currentUserEmail =
        String(
          currentUser.email || ''
        )
        .trim()
        .toLowerCase();

      /* ---------------------------------
         READ BODY
      --------------------------------- */

      const body =
        await request.json().catch(() => null);

      if (!body) {
        return json({
          success: false,
          error: 'Invalid request body'
        }, 400);
      }

      /*
       * Customer mode is explicitly requested
       * with onboarding_id.
       *
       * Existing admin calls do not contain
       * onboarding_id and continue through
       * the existing admin flow below.
       */

      const isCustomerFlow =
        !!body.onboarding_id;

      /* =================================================
         CUSTOMER / STORE OWNER FLOW
      ================================================= */

      if (isCustomerFlow) {
        return await createCustomerStore({
          body,
          currentUser,
          currentUserId,
          currentUserEmail
        });
      }

      /* =================================================
         EXISTING ADMIN FLOW
         DO NOT CHANGE THE EXISTING BEHAVIOUR
      ================================================= */

      return await createAdminSalonOwner({
        body,
        currentUser,
        currentUserId
      });

    } catch (error) {
      console.error(
        'Create salon owner error:',
        error
      );

      return json({
        success: false,
        error:
          'Unable to create salon and owner account',
        details:
          error?.message ||
          String(error)
      }, 500);
    }
  }
};


/* =====================================================
   CUSTOMER / STORE OWNER CREATION
===================================================== */

async function createCustomerStore({
  body,
  currentUser,
  currentUserId,
  currentUserEmail
}) {

  const onboardingId =
    String(
      body.onboarding_id || ''
    ).trim();

  if (!onboardingId) {
    return json({
      success: false,
      error: 'Onboarding session is required'
    }, 400);
  }

  /*
   * The onboarding page can send the selected
   * Google Business in several forms depending
   * on the returned Google Business API structure.
   */

  const selectedBusiness =
    body.selected_business ||
    body.business ||
    body.location ||
    null;

  if (!selectedBusiness) {
    return json({
      success: false,
      error:
        'Please select a Google Business before creating the store'
    }, 400);
  }

  /* ---------------------------------
     VERIFY ONBOARDING SESSION
  --------------------------------- */

  const onboardingResponse =
    await supabaseFetch(
      `/rest/v1/google_oauth_states` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}` +
      `&select=*` +
      `&limit=1`
    );

  if (!onboardingResponse.ok) {
    const detail =
      await onboardingResponse.text();

    console.error(
      'Customer onboarding lookup failed:',
      detail
    );

    return json({
      success: false,
      error:
        'Unable to verify the Google onboarding session'
    }, 500);
  }

  const onboardingRows =
    await onboardingResponse
      .json()
      .catch(() => []);

  if (!onboardingRows.length) {
    return json({
      success: false,
      error:
        'Google onboarding session was not found or has expired'
    }, 400);
  }

  const onboarding =
    onboardingRows[0];

  /*
   * Verify expiration.
   */

  if (onboarding.expires_at) {
    const expiresAt =
      new Date(
        onboarding.expires_at
      ).getTime();

    if (
      Number.isFinite(expiresAt) &&
      expiresAt < Date.now()
    ) {
      return json({
        success: false,
        error:
          'Google onboarding session has expired. Please connect Google again.'
      }, 400);
    }
  }

  /*
   * If the OAuth onboarding state contains the
   * customer's email, make sure it matches the
   * currently authenticated Supabase account.
   *
   * This prevents one logged-in customer from
   * using another customer's onboarding session.
   */

  const onboardingEmail =
    String(
      onboarding.customer_email || ''
    )
    .trim()
    .toLowerCase();

  if (
    onboardingEmail &&
    currentUserEmail &&
    onboardingEmail !== currentUserEmail
  ) {
    console.error(
      'Customer onboarding email mismatch:',
      {
        onboardingEmail,
        currentUserEmail
      }
    );

    return json({
      success: false,
      error:
        'Google onboarding session does not belong to the logged-in account'
    }, 403);
  }

  /* ---------------------------------
     EXTRACT GOOGLE BUSINESS
  --------------------------------- */

  const location =
    selectedBusiness.location ||
    selectedBusiness;

  const locationName =
    firstString([
      location.name,
      selectedBusiness.name,
      location.location_name,
      selectedBusiness.location_name
    ]);

  const businessName =
    firstString([
      location.title,
      selectedBusiness.title,
      location.business_name,
      selectedBusiness.business_name,
      onboarding.customer_name,
      currentUser.user_metadata?.business_name,
      currentUser.user_metadata?.full_name,
      currentUserEmail
    ]) ||
    'Store';

  const address =
    formatGoogleAddress(
      location.storefront_address ||
      location.address ||
      selectedBusiness.storefront_address ||
      selectedBusiness.address ||
      ''
    );

  const phone =
    firstString([
      location.phone_numbers?.primaryPhone,
      location.phone_numbers?.primary_phone,
      location.phone,
      selectedBusiness.phone
    ]);

  const website =
    firstString([
      location.website_uri,
      location.website,
      selectedBusiness.website_uri,
      selectedBusiness.website
    ]);

  const googleBusinessUrl =
    firstString([
      location.maps_uri,
      location.google_maps_uri,
      selectedBusiness.maps_uri,
      selectedBusiness.google_business_url
    ]);

  if (!businessName) {
    return json({
      success: false,
      error:
        'Unable to determine the selected business name'
    }, 400);
  }

  /* ---------------------------------
     CHECK EXISTING OWNER MEMBERSHIPS
  --------------------------------- */

  const existingMembershipResponse =
    await supabaseFetch(
      `/rest/v1/salon_members` +
      `?user_id=eq.${encodeURIComponent(
        currentUserId
      )}` +
      `&select=salon_id,role` +
      `&limit=100`
    );

  if (!existingMembershipResponse.ok) {
    console.error(
      'Existing salon membership lookup failed:',
      await existingMembershipResponse.text()
    );

    return json({
      success: false,
      error:
        'Unable to check existing store ownership'
    }, 500);
  }

  const existingMemberships =
    await existingMembershipResponse
      .json()
      .catch(() => []);

  /*
   * If this exact Google location is already
   * associated with one of the user's stores,
   * return that store instead of creating a duplicate.
   */

  if (locationName) {

    const existingSalonsResponse =
      await supabaseFetch(
        `/rest/v1/salons` +
        `?id=in.(${existingMemberships
          .map(item => item.salon_id)
          .filter(Boolean)
          .map(id => encodeURIComponent(id))
          .join(',')})` +
        `&select=id,salon_code,name,business_id,google_business_url` +
        `&limit=100`
      );

    if (
      existingSalonsResponse.ok &&
      existingMemberships.length
    ) {

      const existingSalons =
        await existingSalonsResponse
          .json()
          .catch(() => []);

      const matchingSalon =
        existingSalons.find(
          salon =>
            salon.google_business_url &&
            salon.google_business_url ===
              googleBusinessUrl
        );

      if (matchingSalon) {
        return json({
          success: true,
          already_exists: true,
          salon_id: matchingSalon.id,
          business_id:
            matchingSalon.business_id,
          salon_code:
            matchingSalon.salon_code,
          salon_name:
            matchingSalon.name,
          owner_user_id:
            currentUserId,
          invitation_status:
            'existing_user'
        });
      }
    }
  }

  /* ---------------------------------
     GENERATE SALON CODE
  --------------------------------- */

  const salonResponse =
    await supabaseFetch(
      `/rest/v1/salons?select=salon_code`
    );

  if (!salonResponse.ok) {
    console.error(
      'Existing salon lookup failed:',
      await salonResponse.text()
    );

    return json({
      success: false,
      error:
        'Unable to read existing stores'
    }, 500);
  }

  const existingSalons =
    await salonResponse
      .json()
      .catch(() => []);

  let highestNumber = 0;

  for (
    const salon of existingSalons
  ) {

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

  /* ---------------------------------
     CREATE BUSINESS
  --------------------------------- */

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
            business_name:
              businessName.trim(),

            business_type:
              'salon',

            phone:
              phone || null,

            website:
              website || null,

            address:
              address || null,

            status:
              'active',

            automation_enabled:
              true,

            approval_required:
              true
          })
      }
    );

  if (!businessResponse.ok) {

    console.error(
      'Customer business creation failed:',
      await businessResponse.text()
    );

    return json({
      success: false,
      error:
        'Unable to create business'
    }, 500);
  }

  const createdBusinesses =
    await businessResponse
      .json()
      .catch(() => []);

  const business =
    Array.isArray(createdBusinesses)
      ? createdBusinesses[0]
      : createdBusinesses;

  if (!business?.id) {
    return json({
      success: false,
      error:
        'Business was created but no business ID was returned'
    }, 500);
  }

  /* ---------------------------------
     CREATE SALON
  --------------------------------- */

  const newSalon = {

    salon_code:
      salonCode,

    business_id:
      business.id,

    name:
      businessName.trim(),

    owner_name:
      firstString([
        onboarding.customer_name,
        currentUser.user_metadata?.full_name,
        currentUserEmail
      ]) || businessName.trim(),

    owner_email:
      currentUserEmail,

    phone:
      phone || null,

    whatsapp:
      phone || null,

    address:
      address || null,

    website:
      website || null,

    google_business_url:
      googleBusinessUrl || locationName || null,

    instagram_url:
      null,

    automation_enabled:
      true,

    approval_required:
      true,

    status:
      'active',

    updated_at:
      new Date().toISOString()
  };

  const createSalonResponse =
    await supabaseFetch(
      `/rest/v1/salons`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'return=representation'
        },

        body:
          JSON.stringify(newSalon)
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
      'Customer salon creation failed:',
      createdSalons
    );

    /*
     * Roll back business if salon creation
     * failed.
     */

    await supabaseFetch(
      `/rest/v1/businesses` +
      `?id=eq.${encodeURIComponent(
        business.id
      )}`,
      {
        method: 'DELETE'
      }
    );

    return json({
      success: false,
      error:
        'Unable to create store'
    }, 500);
  }

  const salon =
    createdSalons[0];

  /* ---------------------------------
     CREATE / UPDATE PROFILE
  --------------------------------- */

  const profileResponse =
    await supabaseFetch(
      `/rest/v1/profiles`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=minimal'
        },

        body:
          JSON.stringify({
            id:
              currentUserId,

            full_name:
              firstString([
                onboarding.customer_name,
                currentUser.user_metadata?.full_name,
                businessName
              ]) || businessName,

            role:
              'salon_owner',

            phone:
              phone || null,

            updated_at:
              new Date().toISOString()
          })
      }
    );

  if (!profileResponse.ok) {

    console.error(
      'Customer profile creation/update failed:',
      await profileResponse.text()
    );

    return json({
      success: false,
      error:
        'Store created, but owner profile could not be created'
    }, 500);
  }

  /* ---------------------------------
     CREATE BUSINESS OWNERSHIP
  --------------------------------- */

  const businessMembershipResponse =
    await supabaseFetch(
      `/rest/v1/business_users`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=minimal'
        },

        body:
          JSON.stringify({
            business_id:
              business.id,

            user_id:
              currentUserId,

            role:
              'owner'
          })
      }
    );

  if (!businessMembershipResponse.ok) {

    console.error(
      'Customer business ownership creation failed:',
      await businessMembershipResponse.text()
    );

    return json({
      success: false,
      error:
        'Store was created, but business ownership could not be established'
    }, 500);
  }

  /* ---------------------------------
     CREATE SALON MEMBERSHIP
  --------------------------------- */

  const membershipResponse =
    await supabaseFetch(
      `/rest/v1/salon_members`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=minimal'
        },

        body:
          JSON.stringify({
            salon_id:
              salon.id,

            user_id:
              currentUserId,

            role:
              'owner'
          })
      }
    );

  if (!membershipResponse.ok) {

    console.error(
      'Customer salon membership creation failed:',
      await membershipResponse.text()
    );

    return json({
      success: false,
      error:
        'Store was created, but the owner could not be linked to the store'
    }, 500);
  }

  /* ---------------------------------
     SUCCESS
  --------------------------------- */

  console.log(
    'CUSTOMER STORE CREATED',
    {
      user_id:
        currentUserId,

      email:
        currentUserEmail,

      salon_id:
        salon.id,

      business_id:
        business.id,

      salon_code:
        salon.salon_code
    }
  );

  return json({
    success: true,

    salon_id:
      salon.id,

    business_id:
      business.id,

    salon_code:
      salon.salon_code,

    salon_name:
      salon.name,

    owner_name:
      salon.owner_name,

    owner_email:
      currentUserEmail,

    owner_user_id:
      currentUserId,

    invitation_status:
      'existing_user',

    google_location_name:
      locationName || null
  });
}


/* =====================================================
   EXISTING ADMIN FLOW
===================================================== */

async function createAdminSalonOwner({
  body,
  currentUser,
  currentUserId
}) {

  /*
   * Verify that the current user is an STall admin.
   */

  const profileResponse =
    await supabaseFetch(
      `/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(
        currentUserId
      )}` +
      `&select=id,role` +
      `&limit=1`
    );

  if (!profileResponse.ok) {

    console.error(
      'Admin profile lookup failed:',
      await profileResponse.text()
    );

    return json({
      success: false,
      error:
        'Unable to verify administrator'
    }, 500);
  }

  const profiles =
    await profileResponse
      .json()
      .catch(() => []);

  if (
    !profiles.length ||
    profiles[0].role !== 'admin'
  ) {

    return json({
      success: false,
      error:
        'Administrator access required'
    }, 403);
  }

  /* ---------------------------------
     READ ADMIN BODY
  --------------------------------- */

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
      success: false,
      error:
        'Salon name, owner name and owner email are required'
    }, 400);
  }

  const email =
    owner_email
      .trim()
      .toLowerCase();

  /* ---------------------------------
     GENERATE SALON CODE
  --------------------------------- */

  const salonResponse =
    await supabaseFetch(
      `/rest/v1/salons?select=salon_code`
    );

  if (!salonResponse.ok) {

    console.error(
      'Existing salon lookup failed:',
      await salonResponse.text()
    );

    return json({
      success: false,
      error:
        'Unable to read existing salons'
    }, 500);
  }

  const existingSalons =
    await salonResponse
      .json()
      .catch(() => []);

  let highestNumber = 0;

  for (
    const salon of existingSalons
  ) {

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

  /* ---------------------------------
     CREATE BUSINESS
  --------------------------------- */

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
            business_name:
              name.trim(),

            business_type:
              'salon',

            phone:
              phone?.trim() || null,

            website:
              website?.trim() || null,

            address:
              address?.trim() || null,

            status:
              'active',

            automation_enabled:
              true,

            approval_required:
              true
          })
      }
    );

  if (!businessResponse.ok) {

    console.error(
      'Business creation failed:',
      await businessResponse.text()
    );

    return json({
      success: false,
      error:
        'Unable to create business'
    }, 500);
  }

  const createdBusinesses =
    await businessResponse
      .json()
      .catch(() => []);

  const business =
    Array.isArray(createdBusinesses)
      ? createdBusinesses[0]
      : createdBusinesses;

  if (!business?.id) {

    return json({
      success: false,
      error:
        'Business was created but no business ID was returned'
    }, 500);
  }

  /* ---------------------------------
     CREATE SALON
  --------------------------------- */

  const newSalon = {

    salon_code:
      salonCode,

    business_id:
      business.id,

    name:
      name.trim(),

    owner_name:
      owner_name.trim(),

    owner_email:
      email,

    phone:
      phone?.trim() || null,

    whatsapp:
      whatsapp?.trim() || null,

    address:
      address?.trim() || null,

    website:
      website?.trim() || null,

    google_business_url:
      google_business_url?.trim() || null,

    instagram_url:
      instagram_url?.trim() || null,

    automation_enabled:
      true,

    approval_required:
      true,

    status:
      'active',

    updated_at:
      new Date().toISOString()
  };

  const createSalonResponse =
    await supabaseFetch(
      `/rest/v1/salons`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'return=representation'
        },

        body:
          JSON.stringify(newSalon)
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
      success: false,
      error:
        'Unable to create salon'
    }, 500);
  }

  const salon =
    createdSalons[0];

  /* ---------------------------------
     FIND EXISTING AUTH USER
  --------------------------------- */

  let ownerUserId =
    null;

  let invitationStatus =
    'existing_user';

  const usersResponse =
    await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
      {
        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY},`
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

    return json({
      success: false,
      error:
        'Unable to check whether the salon owner already has an account'
    }, 500);
  }

  const existingUser =
    (usersData?.users || [])
      .find(
        user =>
          user.email?.toLowerCase() ===
          email
      );

  if (existingUser) {

    ownerUserId =
      existingUser.id;

    invitationStatus =
      'existing_user';

  } else {

    /* ---------------------------------
       INVITE NEW ADMIN-CREATED OWNER
    --------------------------------- */

    const inviteResponse =
      await fetch(
        `${SUPABASE_URL}/auth/v1/invite`,
        {
          method: 'POST',

          headers: {
            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              email,

              data: {
                full_name:
                  owner_name.trim(),

                role:
                  'salon_owner',

                salon_id:
                  salon.id,

                salon_code:
                  salon.salon_code
              },

              redirect_to:
                APP_URL
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

          data:
            inviteData
        }
      );

      return json({
        success: false,
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

  /* ---------------------------------
     PROFILE
  --------------------------------- */

  const profileInsertResponse =
    await supabaseFetch(
      `/rest/v1/profiles`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=minimal'
        },

        body:
          JSON.stringify({
            id:
              ownerUserId,

            full_name:
              owner_name.trim(),

            role:
              'salon_owner',

            phone:
              phone?.trim() || null,

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
      success: false,
      error:
        'Salon created, but owner profile could not be created'
    }, 500);
  }

  /* ---------------------------------
     BUSINESS OWNERSHIP
  --------------------------------- */

  const businessMembershipResponse =
    await supabaseFetch(
      `/rest/v1/business_users`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=minimal'
        },

        body:
          JSON.stringify({
            business_id:
              business.id,

            user_id:
              ownerUserId,

            role:
              'owner'
          })
      }
    );

  if (!businessMembershipResponse.ok) {

    console.error(
      'Business ownership creation failed:',
      await businessMembershipResponse.text()
    );

    return json({
      success: false,
      error:
        'Salon was created, but universal business ownership could not be established'
    }, 500);
  }

  /* ---------------------------------
     SALON MEMBERSHIP
  --------------------------------- */

  const membershipResponse =
    await supabaseFetch(
      `/rest/v1/salon_members`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=minimal'
        },

        body:
          JSON.stringify({
            salon_id:
              salon.id,

            user_id:
              ownerUserId,

            role:
              'owner'
          })
      }
    );

  if (!membershipResponse.ok) {

    console.error(
      'Salon membership creation failed:',
      await membershipResponse.text()
    );

    return json({
      success: false,
      error:
        'Salon was created, but the owner could not be linked to the salon'
    }, 500);
  }

  /* ---------------------------------
     ADMIN SUCCESS
  --------------------------------- */

  return json({
    success: true,

    salon_id:
      salon.id,

    business_id:
      business.id,

    salon_code:
      salon.salon_code,

    salon_name:
      salon.name,

    owner_name:
      owner_name.trim(),

    owner_email:
      email,

    owner_user_id:
      ownerUserId,

    invitation_status:
      invitationStatus
  });
}


/* =====================================================
   SUPABASE REST HELPER
===================================================== */

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
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY`,

        ...(options.headers || {})
      }
    }
  );
}


/* =====================================================
   JSON RESPONSE
===================================================== */

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


/* =====================================================
   HELPERS
===================================================== */

function firstString(
  values
) {

  for (
    const value of values || []
  ) {

    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return '';
}


function formatGoogleAddress(
  address
) {

  if (!address) {
    return '';
  }

  if (
    typeof address === 'string'
  ) {
    return address.trim();
  }

  const lines =
    Array.isArray(
      address.addressLines
    )
      ? address.addressLines
          .filter(Boolean)
          .join(', ')
      : address.addressLines || '';

  return [
    lines,
    address.locality,
    address.administrativeArea,
    address.postalCode,
    address.regionCode
  ]
    .filter(Boolean)
    .join(', ');
}
