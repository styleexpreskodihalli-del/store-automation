(function (global) {
  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function pickLatestMembership(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;

    return rows.reduce((latest, current) => {
      const latestTime = latest && latest.created_at ? new Date(latest.created_at).getTime() : 0;
      const currentTime = current && current.created_at ? new Date(current.created_at).getTime() : 0;
      return currentTime > latestTime ? current : latest;
    }, rows[0]);
  }

  function pickPreferredStoreMembership(rows, gmailEmail) {
    if (!Array.isArray(rows) || !rows.length) return null;

    const email = normalizeEmail(gmailEmail);
    const matching = email
      ? rows.filter((row) => {
          if (!row || !row.salons || !row.salons.id) return false;

          const ownerEmail = normalizeEmail(row.salons.owner_email || row.owner_email || row.email);
          const role = String(row.role || '').trim().toLowerCase();
          return ownerEmail === email && (role === 'owner' || role === 'salon_owner');
        })
      : [];

    const candidateRows = matching.length ? matching : rows;
    return pickLatestMembership(candidateRows);
  }

  function filterStoresForEmail(rows, gmailEmail) {
    const email = normalizeEmail(gmailEmail);

    if (!email || !Array.isArray(rows)) return [];

    return rows.filter((row) => {
      if (!row || !row.salons || !row.salons.id) return false;

      const ownerEmail = normalizeEmail(row.salons.owner_email || row.owner_email || row.email);
      const role = String(row.role || '').trim().toLowerCase();

      return ownerEmail === email && (role === 'owner' || role === 'salon_owner');
    });
  }

  function normalizeStoreMemberships(rows) {
    if (!Array.isArray(rows)) return [];

    return rows
      .filter((row) => row && row.salons && row.salons.id)
      .map((row) => ({
        id: row.salons.id,
        salon_code: row.salons.salon_code || '',
        name: row.salons.name || 'Untitled store',
        owner_name: row.salons.owner_name || '',
        owner_email: row.salons.owner_email || '',
        role: row.role || 'member',
        created_at: row.created_at || null,
        status: row.salons.status || 'Active',
        automation: row.salons.automation_enabled ? 'On' : 'Off',
        location: row.salons.address || row.salons.location || 'Location not set',
        kind: 'salon'
      }));
  }

  function normalizeBusinessMemberships(rows) {
    if (!Array.isArray(rows)) return [];

    return rows
      .filter((row) => row && row.businesses && row.businesses.id)
      .map((row) => ({
        id: row.businesses.id,
        name: row.businesses.business_name || 'Untitled business',
        owner_name: row.businesses.business_name || '',
        owner_email: row.businesses.owner_email || '',
        role: row.role || 'member',
        created_at: row.created_at || null,
        status: row.businesses.status || 'active',
        automation: row.businesses.automation_enabled ? 'On' : 'Off',
        location: row.businesses.address || 'Location not set',
        google_place_id: row.businesses.google_place_id || null,
        phone: row.businesses.phone || null,
        website: row.businesses.website || null,
        business_id: row.business_id || row.businesses.id || null,
        kind: 'business'
      }));
  }

  function mergeStoreCollections(salons, businesses) {
    const salonList = Array.isArray(salons) ? salons : [];
    const businessList = Array.isArray(businesses) ? businesses : [];

    return [...salonList, ...businessList].filter((store) => store && (store.id || store.business_id));
  }

  function getSafeStoreDisplayName(value, fallback = 'Your Store') {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;

    const normalized = raw.toLowerCase();
    const placeholderPatterns = [
      'flow salon',
      'demo salon',
      'your store',
      'my salon',
      'stall partners',
      'store automation'
    ];

    if (placeholderPatterns.includes(normalized)) {
      return fallback;
    }

    return raw;
  }

  const REVIEW_KEYWORDS_BY_CATEGORY = {
    'unisex salon': [
      'unisex salon in {city}',
      'hair salon in {city}',
      'best salon in {city}'
    ],
    'hair salon': [
      'hair salon in {city}',
      'best hair salon in {city}',
      'haircut and styling in {city}'
    ],
    'beauty salon': [
      'beauty salon in {city}',
      'best beauty salon in {city}',
      'salon and spa in {city}'
    ],
    spa: [
      'spa in {city}',
      'best spa in {city}',
      'massage and spa in {city}'
    ],
    salon: [
      'salon in {city}',
      'best salon in {city}',
      'hair and beauty salon in {city}'
    ],
    default: [
      'salon in {city}',
      'best salon in {city}',
      'beauty services in {city}'
    ]
  };

  function getReviewKeywordSet(businessType = '', city = '') {
    const normalized = String(businessType || '').trim().toLowerCase();
    const lookup = REVIEW_KEYWORDS_BY_CATEGORY[normalized] || REVIEW_KEYWORDS_BY_CATEGORY.default;
    const targetCity = String(city || 'Bengaluru').trim() || 'Bengaluru';

    return lookup.map((keyword) => keyword.replace('{city}', targetCity));
  }

  function buildReviewResponseText(businessContext = {}, reviewText = '') {
    const businessName = String(businessContext.businessName || businessContext.name || 'Your business').trim();
    const businessType = String(businessContext.businessType || '').trim();
    const city = String(businessContext.city || '').trim();
    const keywordSet = Array.isArray(businessContext.keywords) && businessContext.keywords.length
      ? businessContext.keywords
      : getReviewKeywordSet(businessType, city);
    const reviewSummary = String(reviewText || '').trim();

    const category = businessType || 'salon';
    const normalizedCategory = category.toLowerCase();
    const categoryText = normalizedCategory.includes('spa')
      ? `We’re glad to help you enjoy your spa experience with us.`
      : normalizedCategory.includes('beauty')
        ? `We’re glad to help you enjoy your beauty salon experience with us.`
        : `We’re glad to help you enjoy your ${category} experience with us.`;

    const cityText = city ? ` Thank you for choosing ${businessName} in ${city}.` : ` Thank you for choosing ${businessName}.`;
    const reviewFlavor = reviewSummary
      ? `We’re so happy to hear your feedback about ${reviewSummary.toLowerCase().includes('hair') ? 'our hair services' : reviewSummary.toLowerCase().includes('spa') ? 'our spa services' : 'our salon services'} and we appreciate the time you took to share it.`
      : 'We appreciate the time you took to share your feedback with us.';
    const keywordText = keywordSet.slice(0, 3).join(' • ');

    return `Thank you for choosing ${businessName}${cityText} ${categoryText} ${reviewFlavor} ${keywordText}`;
  }

  global.pickLatestMembership = pickLatestMembership;
  global.pickPreferredStoreMembership = pickPreferredStoreMembership;
  global.normalizeStoreMemberships = normalizeStoreMemberships;
  global.normalizeBusinessMemberships = normalizeBusinessMemberships;
  global.mergeStoreCollections = mergeStoreCollections;
  global.filterStoresForEmail = filterStoresForEmail;
  global.getSafeStoreDisplayName = getSafeStoreDisplayName;
  global.buildReviewResponseText = buildReviewResponseText;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pickLatestMembership,
      pickPreferredStoreMembership,
      normalizeStoreMemberships,
      normalizeBusinessMemberships,
      mergeStoreCollections,
      filterStoresForEmail,
      getSafeStoreDisplayName,
      buildReviewResponseText,
      getReviewKeywordSet,
      REVIEW_KEYWORDS_BY_CATEGORY
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
