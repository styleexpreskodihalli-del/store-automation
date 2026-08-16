const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405);
      }

      const authHeader = request.headers.get('authorization');

      if (!authHeader?.startsWith('Bearer ')) {
        return json(
          { error: 'Missing Supabase authorization' },
          401
        );
      }

      if (!GOOGLE_MAPS_API_KEY) {
        console.error('GOOGLE_MAPS_API_KEY is not configured');

        return json(
          { error: 'Google Places discovery is not configured' },
          500
        );
      }

      const supabaseAccessToken = authHeader.slice(7);

      /*
       * Validate the logged-in STore user.
       */
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
        return json(
          { error: 'Invalid Supabase session' },
          401
        );
      }

      const user = await userResponse.json();

      /*
       * Geographic search inputs.
       *
       * For new users without a business yet, only geographic
       * restrictions are used. No business profile comparison.
       *
       * The caller may optionally supply:
       *
       *   ?city=Bengaluru
       *   ?country=India
       *   ?area=Whitefield
       *   ?query=Cut N Cute Studio Salon
       *
       * These values are used for discovery only.
       */

      /*
       * Geographic search inputs.
       */
      const url = new URL(request.url);

      const country =
        clean(url.searchParams.get('country'));

      const city =
        clean(url.searchParams.get('city'));

      const area =
        clean(url.searchParams.get('area'));

      const requestedQuery =
        clean(url.searchParams.get('query'));

      /*
       * Require at least a city or an explicit search query.
       *
       * We intentionally do NOT allow a blank global search.
       */
      if (!city && !requestedQuery) {
        return json(
          {
            error:
              'Please select a city or enter a business search.'
          },
          400
        );
      }

      /*
       * Build a geographic search phrase.
       *
       * Examples:
       *
       * "Cut N Cute Studio Salon, Whitefield, Bengaluru, India"
       * or
       * "salon, Whitefield, Bengaluru, India" (if no query provided)
       */
      const searchParts = [];

      if (requestedQuery) {
        searchParts.push(requestedQuery);
      } else {
        /*
         * No specific business name provided.
         * Use a generic business type as fallback.
         */
        searchParts.push('business');
      }

      if (area) {
        searchParts.push(area);
      }

      if (city) {
        searchParts.push(city);
      }

      if (country) {
        searchParts.push(country);
      }

      const textQuery = searchParts.join(', ');

      /*
       * Optional rectangular restriction.
       *
       * The UI can supply:
       *
       * minLat
       * minLng
       * maxLat
       * maxLng
       *
       * When supplied, Google will NOT return results
       * outside this rectangle.
       *
       * This is stronger than locationBias.
       */
      const minLat =
        numberParam(url.searchParams.get('minLat'));

      const minLng =
        numberParam(url.searchParams.get('minLng'));

      const maxLat =
        numberParam(url.searchParams.get('maxLat'));

      const maxLng =
        numberParam(url.searchParams.get('maxLng'));

      const hasRestriction =
        [minLat, minLng, maxLat, maxLng]
          .every(value => value !== null);

      /*
       * Build Google Places Text Search request.
       */
      const placesBody = {
        textQuery,
        pageSize: 20,
        languageCode: 'en',
        includePureServiceAreaBusinesses: false
      };

      if (hasRestriction) {
        placesBody.locationRestriction = {
          rectangle: {
            low: {
              latitude: minLat,
              longitude: minLng
            },
            high: {
              latitude: maxLat,
              longitude: maxLng
            }
          }
        };
      }

      console.log(
        'Google Places discovery:',
        {
          user_id: user.id,
          textQuery,
          country,
          city,
          area,
          restricted: hasRestriction
        }
      );

      /*
       * Call Places API (New).
       */
      const placesResponse = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': [
              'places.id',
              'places.name',
              'places.displayName',
              'places.formattedAddress',
              'places.shortFormattedAddress',
              'places.googleMapsUri',
              'places.websiteUri',
              'places.nationalPhoneNumber',
              'places.internationalPhoneNumber',
              'places.location',
              'places.types',
              'places.primaryType',
              'places.primaryTypeDisplayName',
              'places.rating',
              'places.userRatingCount',
              'places.addressComponents'
            ].join(',')
          },
          body: JSON.stringify(placesBody)
        }
      );

      const placesData =
        await placesResponse
          .json()
          .catch(() => null);

      if (!placesResponse.ok) {
        console.error(
          'Google Places search failed:',
          {
            status: placesResponse.status,
            data: placesData
          }
        );

        return json(
          {
            error:
              placesData?.error?.message ||
              'Unable to search Google Places',
            google_status:
              placesResponse.status
          },
          502
        );
      }

      /*
       * Convert Google Places results into our
       * STore discovery format.
       */
      const places =
        Array.isArray(placesData?.places)
          ? placesData.places
          : [];

      const locations = places.map(place => {
        /*
         * Extract structured address components for city, state, country, postal_code.
         */
        const addressComponents =
          place.addressComponents || [];

        let city = null;
        let state = null;
        let country = null;
        let postalCode = null;

        for (const component of addressComponents) {
          const types = component.types || [];

          if (types.includes('locality') && !city) {
            city = component.longText;
          } else if (
            (types.includes('administrative_area_level_1') ||
              types.includes('administrative_area_level_2')) &&
            !state
          ) {
            state = component.longText;
          } else if (types.includes('country') && !country) {
            country = component.longText;
          } else if (types.includes('postal_code') && !postalCode) {
            postalCode = component.longText;
          }
        }

        return {
          place_id:
            place.id || null,

          location_id:
            place.id || null,

          location_name:
            place.displayName?.text || null,

          address:
            place.formattedAddress ||
            place.shortFormattedAddress ||
            null,

          city: city,
          state: state,
          country: country,
          postal_code: postalCode,

          phone:
            place.nationalPhoneNumber ||
            place.internationalPhoneNumber ||
            null,

          website:
            place.websiteUri || null,

          google_maps_url:
            place.googleMapsUri || null,

          latitude:
            place.location?.latitude ?? null,

          longitude:
            place.location?.longitude ?? null,

          primary_type:
            place.primaryType || null,

          primary_type_display_name:
            place.primaryTypeDisplayName?.text || null,

          rating:
            place.rating ?? null,

          user_rating_count:
            place.userRatingCount ?? null,

          source:
            'google_places'
        };
      });

      /*
       * Return all discovered locations without ranking.
       * For new users, there is no profile to compare against.
       * Results are presented in the order returned by Google Places.
       */
      return json({
        success: true,

        search: {
          country: country || null,
          city: city || null,
          area: area || null,
          query: requestedQuery || null,
          text_query: textQuery,
          restricted: hasRestriction
        },

        locations_found:
          locations.length,

        locations:
          locations.slice(0, 10)
      });

    } catch (error) {
      console.error(
        'Google Places discovery error:',
        error
      );

      return json(
        {
          error:
            'Unable to discover Google Business listings'
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

async function matchPlace(
  salon,
  place
) {
  const values = [
    salon.name,
    salon.address,
    salon.phone,
    salon.website
  ]
    .filter(Boolean)
    .map(normalize);

  let score = 0;

  const placeName =
    normalize(place.location_name);

  const placeAddress =
    normalize(place.address);

  const salonName =
    normalize(salon.name);

  if (
    salonName &&
    placeName
  ) {
    if (
      placeName === salonName
    ) {
      score += 60;
    } else if (
      placeName.includes(salonName) ||
      salonName.includes(placeName)
    ) {
      score += 40;
    } else {
      const salonWords =
        salonName
          .split(/\s+/)
          .filter(word => word.length > 2);

      const matches =
        salonWords.filter(
          word =>
            placeName.includes(word)
        );

      if (salonWords.length) {
        score += Math.round(
          40 *
          (matches.length /
            salonWords.length)
        );
      }
    }
  }

  if (
    salon.address &&
    place.address
  ) {
    const salonAddress =
      normalize(salon.address);

    if (
      placeAddress.includes(salonAddress) ||
      salonAddress.includes(placeAddress)
    ) {
      score += 25;
    } else {
      const addressWords =
        salonAddress
          .split(/\s+/)
          .filter(word => word.length > 3);

      const matches =
        addressWords.filter(
          word =>
            placeAddress.includes(word)
        );

      if (addressWords.length) {
        score += Math.round(
          25 *
          (matches.length /
            addressWords.length)
        );
      }
    }
  }

  if (
    salon.phone &&
    place.phone
  ) {
    const salonPhone =
      digitsOnly(salon.phone);

    const placePhone =
      digitsOnly(place.phone);

    if (
      salonPhone &&
      placePhone &&
      (
        salonPhone === placePhone ||
        salonPhone.endsWith(placePhone) ||
        placePhone.endsWith(salonPhone)
      )
    ) {
      score += 20;
    }
  }

  if (
    salon.website &&
    place.website
  ) {
    const salonHost =
      extractHost(salon.website);

    const placeHost =
      extractHost(place.website);

    if (
      salonHost &&
      placeHost &&
      salonHost === placeHost
    ) {
      score += 20;
    }
  }

  /*
   * Cap the score at 100.
   */
  return Math.min(
    100,
    score
  );
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function digitsOnly(value) {
  return String(value || '')
    .replace(/\D/g, '');
}

function extractHost(value) {
  try {
    return new URL(
      String(value)
    )
      .hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}

function clean(value) {
  const text =
    String(value || '')
      .trim();

  return text
    ? text.slice(0, 120)
    : '';
}

function numberParam(value) {
  if (
    value === null ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
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
          'application/json; charset=utf-8',
        'cache-control':
          'no-store'
      }
    }
  );
}
