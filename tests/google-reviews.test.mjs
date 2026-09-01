import test from 'node:test';
import assert from 'node:assert/strict';

import { normaliseGooglePlaceReviews } from '../api/google-reviews-util.mjs';

test('normalises live Google review payloads for the UI', () => {
  const result = normaliseGooglePlaceReviews({
    rating: 4.8,
    userRatingCount: 152,
    reviews: [
      {
        rating: 5,
        relativePublishTimeDescription: '2 weeks ago',
        authorAttribution: {
          displayName: 'Priya S.',
          photoUri: 'https://example.com/a.jpg'
        },
        originalText: {
          text: 'Loved the service and staff were very friendly.'
        }
      },
      {
        rating: 2,
        relativePublishTimeDescription: '5 days ago',
        authorAttribution: {
          displayName: 'Anita M.'
        },
        text: 'The wait was too long.'
      }
    ]
  }, {
    google_rating: 4.6,
    google_review_count: 120
  });

  assert.equal(result.summary.rating, 4.8);
  assert.equal(result.summary.review_count, 152);
  assert.equal(result.reviews.length, 2);
  assert.equal(result.reviews[0].author_name, 'Priya S.');
  assert.equal(result.reviews[0].rating, 5);
  assert.equal(result.reviews[1].text, 'The wait was too long.');
});
