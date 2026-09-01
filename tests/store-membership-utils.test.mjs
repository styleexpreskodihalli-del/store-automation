import test from 'node:test';
import assert from 'node:assert/strict';

import storeMembershipUtils from '../assets/store-membership-utils.js';

const {
  pickLatestMembership,
  pickPreferredStoreMembership,
  normalizeStoreMemberships,
  normalizeBusinessMemberships,
  filterStoresForEmail,
  mergeStoreCollections,
  getSafeStoreDisplayName,
  buildReviewResponseText
} = storeMembershipUtils;

test('pickLatestMembership prefers the newest membership row', () => {
  const rows = [
    { salon_id: 'salon-1', created_at: '2024-01-01T00:00:00Z' },
    { salon_id: 'salon-2', created_at: '2024-01-02T00:00:00Z' },
    { salon_id: 'salon-3', created_at: '2024-01-03T00:00:00Z' }
  ];

  const latest = pickLatestMembership(rows);

  assert.equal(latest.salon_id, 'salon-3');
});

test('pickPreferredStoreMembership prefers the current user\'s real store over placeholder demo data', () => {
  const rows = [
    {
      role: 'owner',
      created_at: '2024-01-01T00:00:00Z',
      salons: {
        id: 'SALON-PLACEHOLDER',
        salon_code: 'FLOW-001',
        name: 'Flow Salon',
        owner_name: 'Flow Salon Owner',
        owner_email: 'owner@flowsalon.com'
      }
    },
    {
      role: 'owner',
      created_at: '2024-01-03T00:00:00Z',
      salons: {
        id: 'SALON-LAKME',
        salon_code: 'LAKME-001',
        name: 'Lakme Salon',
        owner_name: 'Asha',
        owner_email: 'styleexpreskodihalli@gmail.com'
      }
    }
  ];

  const preferred = pickPreferredStoreMembership(rows, 'styleexpreskodihalli@gmail.com');

  assert.equal(preferred.salons.name, 'Lakme Salon');
  assert.equal(preferred.salons.owner_email, 'styleexpreskodihalli@gmail.com');
});

test('normalizeStoreMemberships preserves all stores for the current user', () => {
  const rows = [
    {
      role: 'owner',
      salons: {
        id: 'salon-1',
        salon_code: 'SALON-001',
        name: 'Cut N Cute Studio',
        owner_name: 'Asha',
        owner_email: 'asha@example.com'
      }
    },
    {
      role: 'manager',
      salons: {
        id: 'salon-2',
        salon_code: 'SALON-002',
        name: 'Glow Studio',
        owner_name: 'Meera',
        owner_email: 'meera@example.com'
      }
    }
  ];

  const normalized = normalizeStoreMemberships(rows);

  assert.deepEqual(normalized.map(item => item.id), ['salon-1', 'salon-2']);
  assert.equal(normalized[1].name, 'Glow Studio');
  assert.equal(normalized[1].role, 'manager');
});

test('filterStoresForEmail only keeps stores owned by the matching Gmail account', () => {
  const rows = [
    {
      role: 'owner',
      salons: {
        id: 'salon-1',
        salon_code: 'SALON-001',
        name: 'Cut N Cute Studio',
        owner_name: 'Asha',
        owner_email: 'asha@example.com'
      }
    },
    {
      role: 'manager',
      salons: {
        id: 'salon-2',
        salon_code: 'SALON-002',
        name: 'Glow Studio',
        owner_name: 'Meera',
        owner_email: 'meera@example.com'
      }
    },
    {
      role: 'owner',
      salons: {
        id: 'salon-3',
        salon_code: 'SALON-003',
        name: 'Luxe Studio',
        owner_name: 'Asha',
        owner_email: 'asha@example.com'
      }
    }
  ];

  const filtered = filterStoresForEmail(rows, 'asha@example.com');

  assert.deepEqual(filtered.map(item => item.salons.id), ['salon-1', 'salon-3']);
  assert.equal(filtered.every(item => (item.salons.owner_email || '').toLowerCase() === 'asha@example.com'), true);
});

test('normalizeBusinessMemberships prioritizes business records for current user', () => {
  const rows = [
    {
      role: 'owner',
      business_id: 'business-1',
      created_at: '2024-01-01T00:00:00Z',
      businesses: {
        id: 'business-1',
        business_name: 'Aroma Spa',
        google_place_id: 'place-1',
        status: 'active',
        automation_enabled: true,
        approval_required: true,
        address: 'MG Road',
        phone: '9988776655',
        website: 'https://example.com'
      }
    },
    {
      role: 'manager',
      business_id: 'business-2',
      created_at: '2024-01-02T00:00:00Z',
      businesses: {
        id: 'business-2',
        business_name: 'Glow Studio',
        google_place_id: 'place-2',
        status: 'active',
        automation_enabled: false,
        approval_required: true,
        address: 'Connaught Place',
        phone: '9988776644',
        website: 'https://alt.example.com'
      }
    }
  ];

  const normalized = normalizeBusinessMemberships(rows);

  assert.deepEqual(normalized.map(item => item.id), ['business-1', 'business-2']);
  assert.equal(normalized[0].name, 'Aroma Spa');
  assert.equal(normalized[0].role, 'owner');
  assert.equal(normalized[1].automation, 'Off');
});

test('mergeStoreCollections combines salon and business listings for the home dashboard', () => {
  const salons = [
    { id: 'salon-1', name: 'Cut N Cute Studio', status: 'Active' }
  ];
  const businesses = [
    { id: 'business-1', name: 'Aroma Spa', status: 'active' },
    { id: 'business-2', name: 'Glow Studio', status: 'active' }
  ];

  const merged = mergeStoreCollections(salons, businesses);

  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map(store => store.name), ['Cut N Cute Studio', 'Aroma Spa', 'Glow Studio']);
});

test('getSafeStoreDisplayName strips stale Flow Salon placeholder values and falls back to a neutral label', () => {
  assert.equal(getSafeStoreDisplayName('Flow Salon'), 'Your Store');
  assert.equal(getSafeStoreDisplayName('Lakme Salon'), 'Lakme Salon');
  assert.equal(getSafeStoreDisplayName('', 'My Studio'), 'My Studio');
});

test('buildReviewResponseText includes category-specific SEO keywords for salon business reviews', () => {
  const response = buildReviewResponseText({
    businessName: 'Style Expres Unisex Salon',
    businessType: 'unisex salon',
    city: 'Bengaluru',
    keywords: ['unisex salon in Whitefield', 'hair salon in Bengaluru', 'best salon in Whitefield']
  }, 'Loved the haircut and friendly team.');

  assert.match(response, /Style Expres Unisex Salon/i);
  assert.match(response, /unisex salon in Whitefield/i);
  assert.match(response, /hair salon in Bengaluru/i);
  assert.match(response, /best salon in Whitefield/i);
  assert.match(response, /Thank you for choosing/i);
});
