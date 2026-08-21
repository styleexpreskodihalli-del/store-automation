const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =====================================================
   MAIN
===================================================== */

export default {

  async fetch(request) {

    try {

      /* ---------------------------------
         ONLY POST
      --------------------------------- */

      if (
        request.method !== 'POST'
      ) {

        return json(
          {
            error:
              'Method not allowed'
          },
          405
        );

      }


      /* ---------------------------------
         AUTHORIZATION
      --------------------------------- */

      const authHeader =
        request.headers.get(
          'authorization'
        );

      if (
        !authHeader?.startsWith(
          'Bearer '
        )
      ) {

        return json(
          {
            error:
              'Missing Supabase authorization'
          },
          401
        );

      }


      const accessToken =
        authHeader
          .slice(7)
          .trim();


      if (!accessToken) {

        return json(
          {
            error:
              'Invalid Supabase authorization'
          },
          401
        );

      }


      /* ---------------------------------
         IDENTIFY LOGGED-IN USER
      --------------------------------- */

      const userResponse =
        await fetch(

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


      if (
        !userResponse.ok
      ) {

        console.error(
          'Supabase user lookup failed:',
          await userResponse.text()
        );

        return json(
          {
            error:
              'Invalid Supabase session'
          },
          401
        );

      }


      const currentUser =
        await userResponse.json();


      if (!currentUser?.id) {

        return json(
          {
            error:
              'Unable to identify logged-in user'
          },
          401
        );

      }


      /* ---------------------------------
         READ REQUEST BODY
      --------------------------------- */

      const body =
        await request
          .json()
          .catch(
            () => null
          );


      if (!body) {

        return json(
          {
            error:
              'Invalid request body'
          },
          400
        );

      }


      /*
       * CUSTOMER / STORE OWNER FLOW
       *
       * onboarding_id identifies the
       * customer Google onboarding flow.
       */

      if (
        body.onboarding_id
      ) {

        return await createCustomerStore(
          {
            body,
            currentUser
          }
        );

      }


      /*
       * Otherwise this is the existing
       * STall ADMIN flow.
       */

      return await createAdminStore(
        {
          body,
          currentUser
        }
      );


    } catch (error) {

      console.error(
        'Create store from Google error:',
        error
      );

      return json(
        {
          error:
            'Unable to create store and owner account',

          details:
            error?.message ||
            String(error)
        },
        500
      );

    }

  }

};


/* =====================================================
   ADMIN STORE FLOW
   EXISTING BEHAVIOUR
===================================================== */

async function createAdminStore({
  body,
  currentUser
}) {

  /* ---------------------------------
     VERIFY ADMIN
  --------------------------------- */

  const profileResponse =
    await supabaseFetch(

      `/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(
        currentUser.id
      )}` +
      `&select=id,role` +
      `&limit=1`

    );


  if (
    !profileResponse.ok
  ) {

    console.error(
      'Admin profile lookup failed:',
      await profileResponse.text()
    );

    return json(
      {
        error:
          'Unable to verify administrator'
      },
      500
    );

  }


  const profiles =
    await profileResponse
      .json();


  if (
    !profiles.length ||
    profiles[0].role !== 'admin'
  ) {

    return json(
      {
        error:
          'Administrator access required'
      },
      403
    );

  }


  /* ---------------------------------
     REQUEST DATA
  --------------------------------- */

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

    return json(
      {
        error:
          'Business ID, owner name and owner email are required'
      },
      400
    );

  }


  const email =
    owner_email
      .trim()
      .toLowerCase();


  /* ---------------------------------
     VERIFY EXISTING BUSINESS
  --------------------------------- */

  const businessResponse =
    await supabaseFetch(

      `/rest/v1/businesses` +
      `?id=eq.${encodeURIComponent(
        business_id
      )}` +
      `&select=id,business_name,business_type,phone,website,address,google_place_id,status` +
      `&limit=1`

    );


  if (
    !businessResponse.ok
  ) {

    console.error(
      'Business lookup failed:',
      await businessResponse.text()
    );

    return json(
      {
        error:
          'Unable to verify selected business'
      },
      500
    );

  }


  const businesses =
    await businessResponse
      .json();


  if (
    !businesses.length
  ) {

    return json(
      {
        error:
          'Selected Google business could not be found'
      },
      404
    );

  }


  const business =
    businesses[0];


  return await finishStoreCreation({

    business,

    ownerUserId:
      null,

    ownerName:
      owner_name.trim(),

    ownerEmail:
      email,

    ownerPhone:
      business.phone || null,

    adminMode:
      true

  });

}


/* =====================================================
   CUSTOMER / STORE OWNER FLOW
===================================================== */

async function createCustomerStore({
  body,
  currentUser
}) {

  const onboardingId =
    String(
      body.onboarding_id || ''
    ).trim();


  const selectedBusiness =
    body.selected_business ||
    body.business ||
    body.location ||
    null;


  if (!onboardingId) {

    return json(
      {
        error:
          'Google onboarding session is required'
      },
      400
    );

  }


  if (!selectedBusiness) {

    return json(
      {
        error:
          'Please select a Google Business first'
      },
      400
    );

  }


  const ownerUserId =
    currentUser.id;


  const ownerEmail =
    String(
      currentUser.email || ''
    )
      .trim()
      .toLowerCase();


  if (!ownerEmail) {

    return json(
      {
        error:
          'Logged-in account does not have an email address'
      },
      400
    );

  }


  /* ---------------------------------
     VERIFY ONBOARDING STATE
  --------------------------------- */

  const stateResponse =
    await supabaseFetch(

      `/rest/v1/google_oauth_states` +
      `?onboarding_id=eq.${encodeURIComponent(
        onboardingId
      )}` +
      `&select=*` +
      `&limit=1`

    );


  if (
    !stateResponse.ok
  ) {

    console.error(
      'Customer onboarding state lookup failed:',
      await stateResponse.text()
    );

    return json(
      {
        error:
          'Unable to verify Google onboarding session'
      },
      500
    );

  }


  const states =
    await stateResponse
      .json()
      .catch(
        () => []
      );


  if (
    !states.length
  ) {

    return json(
      {
        error:
          'Google onboarding session was not found or has expired'
      },
      400
    );

  }


  const state =
    states[0];


  /* ---------------------------------
     CHECK EXPIRATION
  --------------------------------- */

  if (
    state.expires_at
  ) {

    const expiresAt =
      new Date(
        state.expires_at
      ).getTime();


    if (
      Number.isFinite(
        expiresAt
      ) &&
      expiresAt < Date.now()
    ) {

      return json(
        {
          error:
            'Google onboarding session has expired. Please connect Google again.'
        },
        400
      );

    }

  }


  /* ---------------------------------
     VERIFY EMAIL OWNERSHIP
  --------------------------------- */

  const onboardingEmail =
    String(
      state.customer_email || ''
    )
      .trim()
      .toLowerCase();


  if (
    onboardingEmail &&
    ownerEmail &&
    onboardingEmail !== ownerEmail
  ) {

    console.error(
      'Customer onboarding email mismatch',
      {
        onboardingEmail,
        ownerEmail
      }
    );

    return json(
      {
        error:
          'Google onboarding session does not belong to this account'
      },
      403
    );

  }


  /* ---------------------------------
     EXTRACT SELECTED GOOGLE LOCATION
  --------------------------------- */

  const location =
    selectedBusiness.location ||
    selectedBusiness;


  const businessName =
    firstString(
      [

        location.title,

        selectedBusiness.title,

        location.name,

        selectedBusiness.name,

        state.customer_name,

        currentUser
          .user_metadata
          ?.business_name,

        currentUser
          .user_metadata
          ?.full_name,

        ownerEmail

      ]
    ) ||
    'Store';


  const googleLocationName =
    firstString(
      [

        location.name,

        selectedBusiness.name

      ]
    );


  const phone =
    firstString(
      [

        location
          .phone_numbers
          ?.primaryPhone,

        location
          .phone_numbers
          ?.primary_phone,

        location.phone,

        selectedBusiness.phone

      ]
    );


  const website =
    firstString(
      [

        location.website_uri,

        selectedBusiness.website_uri,

        location.website,

        selectedBusiness.website

      ]
    );


  const address =
    formatAddress(
      location.storefront_address ||
      location.address ||
      selectedBusiness.address ||
      ''
    );


  /*
   * Google location metadata.
   */

  const googleMapsUri =
    firstString(
      [

        location.metadata?.mapsUri,

        location.maps_uri,

        selectedBusiness.maps_uri

      ]
    );


  /* ---------------------------------
     CHECK DUPLICATE FOR THIS USER
  --------------------------------- */

  const membershipResponse =
    await supabaseFetch(

      `/rest/v1/salon_members` +
      `?user_id=eq.${encodeURIComponent(
        ownerUserId
      )}` +
      `&select=salon_id,role` +
      `&limit=100`

    );


  if (
    !membershipResponse.ok
  ) {

    console.error(
      'Customer membership lookup failed:',
      await membershipResponse.text()
    );

    return json(
      {
        error:
          'Unable to check existing stores'
      },
      500
    );

  }


  const memberships =
    await membershipResponse
      .json()
      .catch(
        () => []
      );


  /*
   * If the user already owns stores,
   * check whether the selected Google
   * location is already linked.
   */

  if (
    memberships.length &&
    googleLocationName
  ) {

    const salonIds =
      memberships
        .map(
          item =>
            item.salon_id
        )
        .filter(Boolean);


    if (
      salonIds.length
    ) {

      const salonIdList =
        salonIds
          .map(
            id =>
              encodeURIComponent(
                id
              )
          )
          .join(',');


      const existingResponse =
        await supabaseFetch(

          `/rest/v1/salons` +
          `?id=in.(${salonIdList})` +
          `&select=id,salon_code,name,business_id,google_business_url,owner_email` +
          `&limit=100`

        );


      if (
        existingResponse.ok
      ) {

        const existingSalons =
          await existingResponse
            .json()
            .catch(
              () => []
            );


        const matchingSalon =
          existingSalons.find(
            salon =>
              salon.google_business_url ===
                googleLocationName
          );


        if (
          matchingSalon
        ) {

          return json(
            {
              success:
                true,

              already_exists:
                true,

              salon_id:
                matchingSalon.id,

              business_id:
                matchingSalon.business_id,

              salon_code:
                matchingSalon.salon_code,

              salon_name:
                matchingSalon.name,

              owner_user_id:
                ownerUserId,

              owner_email:
                ownerEmail,

              invitation_status:
                'existing_user'
            }
          );

        }

      }

    }

  }


  /* ---------------------------------
     CREATE BUSINESS
  --------------------------------- */

  const businessResponse =
    await supabaseFetch(

      `/rest/v1/businesses`,

      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/json',

          Prefer:
            'return=representation'

        },

        body:
          JSON.stringify(
            {

              business_name:
                businessName,

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

            }
          )

      }

    );


  if (
    !businessResponse.ok
  ) {

    console.error(
      'Customer business creation failed:',
      await businessResponse.text()
    );

    return json(
      {
        error:
          'Unable to create business'
      },
      500
    );

  }


  const createdBusinesses =
    await businessResponse
      .json()
      .catch(
        () => []
      );


  const business =
    Array.isArray(
      createdBusinesses
    )
      ? createdBusinesses[0]
      : createdBusinesses;


  if (
    !business?.id
  ) {

    return json(
      {
        error:
          'Business was created but no business ID was returned'
      },
      500
    );

  }


  /*
   * Save the Google location identifier
   * on the business if the column exists.
   *
   * We intentionally don't send google_place_id
   * here because the selected Google Business
   * location resource is not necessarily a
   * Google Place ID.
   */


  /* ---------------------------------
     CREATE STORE
  --------------------------------- */

  const salonCode =
    await generateSalonCode();


  const salonName =
    businessName;


  const ownerName =
    firstString(
      [

        state.customer_name,

        currentUser
          .user_metadata
          ?.full_name,

        businessName

      ]
    ) ||
    businessName;


  const newSalon = {

    salon_code:
      salonCode,

    business_id:
      business.id,

    name:
      salonName,

    owner_name:
      ownerName,

    owner_email:
      ownerEmail,

    phone:
      phone || null,

    whatsapp:
      phone || null,

    address:
      address || null,

    website:
      website || null,

    google_business_url:
      googleLocationName ||
      googleMapsUri ||
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


  const salonResponse =
    await supabaseFetch(

      `/rest/v1/salons`,

      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/json',

          Prefer:
            'return=representation'

        },

        body:
          JSON.stringify(
            newSalon
          )

      }

    );


  const createdSalons =
    await salonResponse
      .json()
      .catch(
        () => []
      );


  if (
    !salonResponse.ok ||
    !createdSalons.length
  ) {

    console.error(
      'Customer salon creation failed:',
      createdSalons
    );


    /*
     * Roll back business.
     */

    await deleteBusiness(
      business.id
    );


    return json(
      {
        error:
          'Unable to create store'
      },
      500
    );

  }


  const salon =
    createdSalons[0];


  /* ---------------------------------
     PROFILE
  --------------------------------- */

  const profileResponse =
    await supabaseFetch(

      `/rest/v1/profiles`,

      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=minimal'

        },

        body:
          JSON.stringify(
            {

              id:
                ownerUserId,

              full_name:
                ownerName,

              role:
                'salon_owner',

              phone:
                phone || null,

              updated_at:
                new Date().toISOString()

            }
          )

      }

    );


  if (
    !profileResponse.ok
  ) {

    console.error(
      'Customer profile creation failed:',
      await profileResponse.text()
    );

    return json(
      {
        error:
          'Store created, but owner profile could not be created'
      },
      500
    );

  }


  /* ---------------------------------
     BUSINESS OWNERSHIP
  --------------------------------- */

  const businessUserResponse =
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
          JSON.stringify(
            {

              business_id:
                business.id,

              user_id:
                ownerUserId,

              role:
                'owner'

            }
          )

      }

    );


  if (
    !businessUserResponse.ok
  ) {

    console.error(
      'Customer business ownership failed:',
      await businessUserResponse.text()
    );

    return json(
      {
        error:
          'Store created, but business ownership could not be established'
      },
      500
    );

  }


  /* ---------------------------------
     SALON MEMBERSHIP
  --------------------------------- */

  const salonMemberResponse =
    await supabaseFetch(

      `/rest/v1/salon_members`,

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
          JSON.stringify(
            {

              salon_id:
                salon.id,

              user_id:
                ownerUserId,

              role:
                'owner'

            }
          )

      }

    );


  if (
    !salonMemberResponse.ok
  ) {

    console.error(
      'Customer salon membership failed:',
      await salonMemberResponse.text()
    );

    return json(
      {
        error:
          'Store created, but owner membership could not be established'
      },
      500
    );

  }


  /* ---------------------------------
     SUCCESS
  --------------------------------- */

  console.log(
    'CUSTOMER STORE CREATED',
    {

      user_id:
        ownerUserId,

      email:
        ownerEmail,

      onboarding_id:
        onboardingId,

      business_id:
        business.id,

      salon_id:
        salon.id,

      salon_code:
        salon.salon_code

    }
  );


  return json(
    {

      success:
        true,

      already_exists:
        false,

      salon_id:
        salon.id,

      business_id:
        business.id,

      salon_code:
        salon.salon_code,

      salon_name:
        salon.name,

      business_name:
        business.business_name,

      owner_user_id:
        ownerUserId,

      owner_name:
        ownerName,

      owner_email:
        ownerEmail,

      google_location_name:
        googleLocationName || null,

      invitation_status:
        'existing_user'

    }
  );

}


/* =====================================================
   SHARED ADMIN STORE CREATION
===================================================== */

async function finishStoreCreation({
  business,
  ownerUserId,
  ownerName,
  ownerEmail,
  ownerPhone,
  adminMode
}) {

  /* ---------------------------------
     GENERATE SALON CODE
  --------------------------------- */

  const salonCode =
    await generateSalonCode();


  /* ---------------------------------
     DUPLICATE BUSINESS CHECK
  --------------------------------- */

  const existingResponse =
    await supabaseFetch(

      `/rest/v1/salons` +
      `?business_id=eq.${encodeURIComponent(
        business.id
      )}` +
      `&select=id,salon_code,name,owner_name,owner_email,business_id` +
      `&limit=1`

    );


  if (
    !existingResponse.ok
  ) {

    console.error(
      'Existing business salon lookup failed:',
      await existingResponse.text()
    );

    return json(
      {
        error:
          'Unable to verify whether this store already exists'
      },
      500
    );

  }


  const existingSalons =
    await existingResponse
      .json();


  if (
    existingSalons.length
  ) {

    const existing =
      existingSalons[0];


    return json(
      {

        success:
          true,

        already_exists:
          true,

        salon_id:
          existing.id,

        salon_code:
          existing.salon_code,

        salon_name:
          existing.name,

        business_id:
          business.id,

        business_name:
          business.business_name,

        owner_name:
          existing.owner_name,

        owner_email:
          existing.owner_email,

        invitation_status:
          'not_sent'

      }
    );

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
      business.business_name,

    owner_name:
      ownerName,

    owner_email:
      ownerEmail,

    phone:
      business.phone ||
      ownerPhone ||
      null,

    address:
      business.address ||
      null,

    website:
      business.website ||
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

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/json',

          Prefer:
            'return=representation'

        },

        body:
          JSON.stringify(
            newSalon
          )

      }

    );


  const createdSalons =
    await createSalonResponse
      .json()
      .catch(
        () => []
      );


  if (
    !createSalonResponse.ok ||
    !createdSalons.length
  ) {

    console.error(
      'Salon creation failed:',
      createdSalons
    );

    return json(
      {
        error:
          'Unable to create store'
      },
      500
    );

  }


  const salon =
    createdSalons[0];


  /* ---------------------------------
     FIND / CREATE OWNER
  --------------------------------- */

  let finalOwnerUserId =
    ownerUserId;

  let invitationStatus =
    'existing_user';


  if (
    !finalOwnerUserId
  ) {

    const usersResponse =
      await fetch(

        `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,

        {

          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`

          }

        }

      );


    const usersData =
      await usersResponse
        .json()
        .catch(
          () => null
        );


    if (
      !usersResponse.ok
    ) {

      await deleteSalon(
        salon.id
      );


      return json(
        {
          error:
            'Unable to check whether the store owner already has an account'
        },
        500
      );

    }


    const existingUser =
      (
        usersData?.users ||
        []
      )
        .find(
          user =>
            user.email
              ?.toLowerCase() ===
            ownerEmail
        );


    if (
      existingUser
    ) {

      finalOwnerUserId =
        existingUser.id;

    } else {

      /* -----------------------------
         INVITE OWNER
      ----------------------------- */

      const inviteResponse =
        await fetch(

          `${SUPABASE_URL}/auth/v1/invite`,

          {

            method:
              'POST',

            headers: {

              apikey:
                SUPABASE_SERVICE_ROLE_KEY,

              Authorization:
                `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

              'Content-Type':
                'application/json'

            },

            body:
              JSON.stringify(
                {

                  email:
                    ownerEmail,

                  data:
                    {

                      full_name:
                        ownerName,

                      role:
                        'salon_owner',

                      salon_id:
                        salon.id,

                      salon_code:
                        salon.salon_code,

                      business_id:
                        business.id

                    },

                  redirect_to:
                    'https://store-automation.vercel.app'

                }
              )

          }

        );


      const inviteData =
        await inviteResponse
          .json()
          .catch(
            () => null
          );


      if (
        !inviteResponse.ok ||
        !inviteData?.id
      ) {

        await deleteSalon(
          salon.id
        );


        return json(
          {
            error:
              inviteData?.msg ||
              inviteData?.message ||
              inviteData?.error_description ||
              inviteData?.error ||
              'Unable to invite store owner',

            auth_status:
              inviteResponse.status

          },
          502
        );

      }


      finalOwnerUserId =
        inviteData.id;


      invitationStatus =
        'invitation_sent';

    }

  }


  /* ---------------------------------
     PROFILE
  --------------------------------- */

  const profileResponse =
    await supabaseFetch(

      `/rest/v1/profiles`,

      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/json',

          Prefer:
            'resolution=merge-duplicates,return=minimal'

        },

        body:
          JSON.stringify(
            {

              id:
                finalOwnerUserId,

              full_name:
                ownerName,

              role:
                'salon_owner',

              phone:
                business.phone ||
                ownerPhone ||
                null,

              updated_at:
                new Date().toISOString()

            }
          )

      }

    );


  if (
    !profileResponse.ok
  ) {

    console.error(
      'Owner profile creation failed:',
      await profileResponse.text()
    );

    return json(
      {
        error:
          'Store created, but owner profile could not be created'
      },
      500
    );

  }


  /* ---------------------------------
     BUSINESS OWNERSHIP
  --------------------------------- */

  const businessMembershipResponse =
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
          JSON.stringify(
            {

              business_id:
                business.id,

              user_id:
                finalOwnerUserId,

              role:
                'owner'

            }
          )

      }

    );


  if (
    !businessMembershipResponse.ok
  ) {

    console.error(
      'Business ownership creation failed:',
      await businessMembershipResponse.text()
    );

    return json(
      {
        error:
          'Store was created, but business ownership could not be established'
      },
      500
    );

  }


  /* ---------------------------------
     SALON MEMBERSHIP
  --------------------------------- */

  const membershipResponse =
    await supabaseFetch(

      `/rest/v1/salon_members`,

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
          JSON.stringify(
            {

              salon_id:
                salon.id,

              user_id:
                finalOwnerUserId,

              role:
                'owner'

            }
          )

      }

    );


  if (
    !membershipResponse.ok
  ) {

    console.error(
      'Salon membership creation failed:',
      await membershipResponse.text()
    );

    return json(
      {
        error:
          'Store was created, but the owner could not be linked to the store'
      },
      500
    );

  }


  /* ---------------------------------
     SUCCESS
  --------------------------------- */

  return json(
    {

      success:
        true,

      already_exists:
        false,

      salon_id:
        salon.id,

      business_id:
        business.id,

      salon_code:
        salon.salon_code,

      salon_name:
        salon.name,

      business_name:
        business.business_name,

      google_place_id:
        business.google_place_id ||
        null,

      owner_name:
        ownerName,

      owner_email:
        ownerEmail,

      owner_user_id:
        finalOwnerUserId,

      invitation_status:
        invitationStatus

    }
  );

}


/* =====================================================
   GENERATE SALON CODE
===================================================== */

async function generateSalonCode() {

  const salonResponse =
    await supabaseFetch(
      `/rest/v1/salons?select=salon_code`
    );


  if (
    !salonResponse.ok
  ) {

    throw new Error(
      'Unable to read existing salons'
    );

  }


  const existingSalons =
    await salonResponse
      .json()
      .catch(
        () => []
      );


  let highestNumber =
    0;


  for (
    const salon of existingSalons
  ) {

    const match =
      /^SALON-(\d+)$/i.exec(
        salon.salon_code || ''
      );


    if (
      match
    ) {

      highestNumber =
        Math.max(
          highestNumber,
          Number(
            match[1]
          )
        );

    }

  }


  return (
    `SALON-${String(
      highestNumber + 1
    ).padStart(3, '0')}`
  );

}


/* =====================================================
   DELETE SALON
===================================================== */

async function deleteSalon(
  salonId
) {

  try {

    await supabaseFetch(

      `/rest/v1/salons` +
      `?id=eq.${encodeURIComponent(
        salonId
      )}`,

      {
        method:
          'DELETE'
      }

    );

  } catch (
    error
  ) {

    console.error(
      'Salon cleanup failed:',
      error
    );

  }

}


/* =====================================================
   DELETE BUSINESS
===================================================== */

async function deleteBusiness(
  businessId
) {

  try {

    await supabaseFetch(

      `/rest/v1/businesses` +
      `?id=eq.${encodeURIComponent(
        businessId
      )}`,

      {
        method:
          'DELETE'
      }

    );

  } catch (
    error
  ) {

    console.error(
      'Business cleanup failed:',
      error
    );

  }

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
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        ...(options.headers || {})

      }

    }

  );

}


/* =====================================================
   ADDRESS FORMATTER
===================================================== */

function formatAddress(
  address
) {

  if (!address) {
    return '';
  }


  if (
    typeof address ===
    'string'
  ) {

    return address.trim();

  }


  return [

    Array.isArray(
      address.addressLines
    )
      ? address.addressLines.join(
          ', '
        )
      : address.addressLines,

    address.locality,

    address.administrativeArea,

    address.postalCode,

    address.regionCode

  ]

    .filter(Boolean)

    .join(', ');

}


/* =====================================================
   STRING HELPER
===================================================== */

function firstString(
  values
) {

  for (
    const value of
      values || []
  ) {

    if (
      typeof value ===
        'string' &&
      value.trim()
    ) {

      return value.trim();

    }

  }


  return '';

}


/* =====================================================
   JSON RESPONSE
===================================================== */

function json(
  body,
  status = 200
) {

  return new Response(

    JSON.stringify(
      body
    ),

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
