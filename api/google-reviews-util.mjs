export function normaliseGooglePlaceReviews(placeData = {}, fallback = {}) {
  const place = placeData || {};
  const reviews = Array.isArray(place.reviews)
    ? place.reviews
    : [];

  const summary = {
    rating: place.rating ?? fallback.google_rating ?? null,
    review_count: place.userRatingCount ?? fallback.google_review_count ?? null
  };

  return {
    summary,
    reviews: reviews.map((review, index) => {
      const author = review.authorAttribution || {};
      const reviewText = review.originalText?.text || review.text || 'Customer review';

      return {
        id: review.name || `${index + 1}`,
        author_name: author.displayName || `Customer ${index + 1}`,
        author_photo: author.photoUri || null,
        rating: review.rating ?? null,
        text: reviewText,
        relative_time: review.relativePublishTimeDescription || null,
        source: 'google'
      };
    })
  };
}
