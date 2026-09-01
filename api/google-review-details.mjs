import { normaliseGooglePlaceReviews } from './google-reviews-util.mjs';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405);
      }

      const authHeader = request.headers.get('authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return json({ error: 'Missing Supabase authorization' }, 401);
      }

      const url = new URL(request.url);
      const placeId = url.searchParams.get('place_id');
      const businessId = url.searchParams.get('business_id');

      if (!placeId && !businessId) {
        return json({ error: 'place_id or business_id is required' }, 400);
      }

      const supabaseAccessToken = authHeader.slice(7);
      const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${supabaseAccessToken}`
        }
      });

      if (!userResponse.ok) {
        return json({ error: 'Invalid Supabase session' }, 401);
      }

      let lookupPlaceId = placeId;
      if (!lookupPlaceId && businessId) {
        const businessResponse = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/businesses?id=eq.${encodeURIComponent(businessId)}&select=google_place_id&limit=1`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          }
        );

        if (!businessResponse.ok) {
          return json({ error: 'Unable to load business details' }, 500);
        }

        const businesses = await businessResponse.json();
        lookupPlaceId = businesses?.[0]?.google_place_id || null;
      }

      if (!lookupPlaceId) {
        return json({ error: 'No Google Place ID found for this business' }, 404);
      }

      if (!GOOGLE_MAPS_API_KEY) {
        return json({ error: 'Google Maps API key missing' }, 500);
      }

      const fieldMask = [
        'id',
        'rating',
        'userRatingCount',
        'reviews'
      ].join(',');

      const response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(lookupPlaceId)}?fields=${encodeURIComponent(fieldMask)}`,
        {
          headers: {
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY
          }
        }
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        return json({
          error: payload?.error?.message || 'Unable to load Google reviews',
          google_status: response.status
        }, 502);
      }

      const normalized = normaliseGooglePlaceReviews(payload);

      return json({
        success: true,
        place_id: lookupPlaceId,
        ...normalized
      });
    } catch (error) {
      console.error('Google review details error:', error);
      return json({ error: 'Unable to load store reviews' }, 500);
    }
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
