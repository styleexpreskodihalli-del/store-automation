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

  function generateReviewResponseVariants(businessContext = {}, reviewText = '', rating = 0) {
    const businessName = String(businessContext.businessName || businessContext.name || 'Your business').trim();
    const businessType = String(businessContext.businessType || 'salon').trim();
    const city = String(businessContext.city || 'Bengaluru').trim();
    const phone = String(businessContext.phone || '').trim();
    const website = String(businessContext.website || '').trim();
    const specialties = Array.isArray(businessContext.specialties) && businessContext.specialties.length
      ? businessContext.specialties
      : ['haircut', 'styling', 'beauty services'];
    const reviewSummary = String(reviewText || '').trim();
    const contactLine = [phone || website ? `${phone ? `Call us at ${phone}` : ''}${phone && website ? ' • ' : ''}${website ? `Visit ${website}` : ''}` : 'We’d love to hear from you'].join('').trim();

    const starStrategy = Number(rating) <= 2
      ? [
          `We’re truly sorry to hear that your experience with ${businessName} did not meet expectations. Thank you for being honest, and we would like the chance to make it right. Our team specialises in ${specialties.slice(0, 2).join(' and ')} and we’d welcome the opportunity to serve you again. ${contactLine}.`,
          `Thank you for sharing your feedback. We take every review seriously and are sorry for the experience you had at ${businessName}. Our focus is on ${specialties.join(', ')} and we are committed to improving every visit. Please reach out to us at ${phone || website || 'our front desk'} so we can assist you directly.`,
          `We appreciate you letting us know. At ${businessName}, we specialise in ${specialties.join(', ')} and we want every customer to leave feeling valued. We are sorry this visit fell short, and we would be glad to speak with you directly at ${phone || website || 'our desk'} to fix it.`
        ]
      : Number(rating) >= 4
        ? [
            `Thank you for choosing ${businessName}. We’re thrilled to hear your feedback and delighted to know our ${businessType} services stood out for you. We specialise in ${specialties.join(', ')} and we look forward to welcoming you back in ${city}.`,
            `We appreciate your kind words about ${businessName}. Thank you for highlighting the care and quality of our ${businessType} work. Our team is proud to specialise in ${specialties.join(', ')} and we’re grateful for your support in ${city}.`,
            `Thank you for taking the time to review ${businessName}. We’re so happy to hear your experience was positive, and we look forward to continuing to offer ${specialties.join(', ')} for customers in ${city}. ${contactLine}.`
          ]
        : [
            `Thank you for choosing ${businessName}. We value your feedback and are grateful for the chance to keep improving. Our team specialises in ${specialties.join(', ')} and we are committed to giving every customer a better experience in ${city}. ${contactLine}.`,
            `We appreciate you sharing your thoughts about ${businessName}. We specialise in ${specialties.join(', ')} and we take every comment seriously as we work to improve every visit in ${city}.`,
            `Thank you for your honest feedback. At ${businessName}, we focus on ${specialties.join(', ')} and we’re always working to deliver a better experience. Please reach out to us at ${phone || website || 'our team'} so we can continue improving.`
          ];

    const typedReview = reviewSummary ? reviewSummary : 'your experience';
    return [
      `Thank you for sharing your feedback about ${typedReview}. We appreciate it and we’re proud to serve guests at ${businessName}. Our specialities include ${specialties.join(', ')} and we’d love to welcome you back. ${contactLine}.`,
      ...starStrategy,
      `We’re grateful for your feedback about ${businessName}. We specialise in ${specialties.join(', ')} and we’re committed to delivering quality service in ${city}. For any follow-up, please contact ${phone || businessName}.`
    ].slice(0, 4);
  }

  function getNextReviewVariant(currentIndex, variants) {
    if (!Array.isArray(variants) || !variants.length) {
      return { index: 0, text: '' };
    }

    const safeIndex = Number(currentIndex) || 0;
    const nextIndex = (safeIndex + 1) % variants.length;
    return { index: nextIndex, text: variants[nextIndex] || '' };
  }

  global.pickLatestMembership = pickLatestMembership;
  global.pickPreferredStoreMembership = pickPreferredStoreMembership;
  global.normalizeStoreMemberships = normalizeStoreMemberships;
  global.normalizeBusinessMemberships = normalizeBusinessMemberships;
  global.mergeStoreCollections = mergeStoreCollections;
  global.filterStoresForEmail = filterStoresForEmail;
  global.getSafeStoreDisplayName = getSafeStoreDisplayName;
  global.buildReviewResponseText = buildReviewResponseText;
  global.getNextReviewVariant = getNextReviewVariant;

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
      REVIEW_KEYWORDS_BY_CATEGORY,
      generateReviewResponseVariants,
      getNextReviewVariant
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
