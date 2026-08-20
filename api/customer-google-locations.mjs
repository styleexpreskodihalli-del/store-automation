<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Your Business | STore Automation</title>
<meta name="description" content="Connect your Google Business Profile and list your business on STore Automation.">

<style>
:root{
  --green:#123b2a;
  --green2:#0b5a3a;
  --light:#f4f8f5;
  --border:#dce7e0;
  --text:#172033;
  --muted:#68756f;
  --white:#fff;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  font-family:Arial,Helvetica,sans-serif;
  color:var(--text);
  background:
    radial-gradient(circle at top right,#dcefe5 0,transparent 34%),
    linear-gradient(180deg,#f8fbf9 0,#eef5f1 100%);
  min-height:100vh;
}

.container{
  width:min(1080px,92%);
  margin:0 auto;
}

header{
  padding:28px 0;
}

.logo{
  display:flex;
  align-items:center;
  gap:12px;
  text-decoration:none;
  color:var(--green);
  font-weight:800;
  font-size:20px;
}

.logo img{
  width:58px;
  height:auto;
}

.hero{
  text-align:center;
  padding:38px 0 28px;
}

.badge{
  display:inline-block;
  background:#e2f2e9;
  color:var(--green);
  padding:7px 14px;
  border-radius:30px;
  font-size:13px;
  font-weight:700;
  margin-bottom:16px;
}

h1{
  margin:0;
  font-size:clamp(32px,5vw,52px);
  line-height:1.1;
  color:var(--green);
}

.hero p{
  max-width:650px;
  margin:18px auto 0;
  color:var(--muted);
  font-size:17px;
}

.card{
  max-width:760px;
  margin:25px auto 60px;
  background:rgba(255,255,255,.96);
  border:1px solid var(--border);
  border-radius:24px;
  padding:34px;
  box-shadow:0 18px 55px rgba(18,59,42,.10);
}

.step{
  display:none;
}

.step.active{
  display:block;
}

.step-title{
  font-size:24px;
  font-weight:800;
  color:var(--green);
  margin-bottom:8px;
}

.step-text{
  color:var(--muted);
  margin-bottom:25px;
}

.google-btn{
  width:100%;
  border:1px solid #d7dce0;
  background:#fff;
  color:#202124;
  border-radius:12px;
  padding:15px 18px;
  font-size:16px;
  font-weight:700;
  cursor:pointer;
  display:flex;
  justify-content:center;
  align-items:center;
  gap:12px;
  transition:.2s;
}

.google-btn:hover{
  box-shadow:0 4px 14px rgba(0,0,0,.10);
  transform:translateY(-1px);
}

.google-btn:disabled{
  opacity:.6;
  cursor:not-allowed;
}

.google-icon{
  width:20px;
  height:20px;
  display:grid;
  place-items:center;
  font-weight:900;
  color:#4285f4;
}

.loading{
  text-align:center;
  padding:25px;
  color:var(--muted);
}

.error{
  display:none;
  background:#fff1f1;
  color:#a52d2d;
  border:1px solid #f0caca;
  border-radius:12px;
  padding:14px;
  margin-top:18px;
}

.success{
  display:none;
  background:#eef8f2;
  color:#17633f;
  border:1px solid #b9ddc8;
  border-radius:12px;
  padding:14px;
  margin-top:18px;
}

.business-list{
  display:grid;
  gap:14px;
}

.business{
  border:2px solid var(--border);
  border-radius:16px;
  padding:20px;
  cursor:pointer;
  transition:.2s;
  background:#fff;
}

.business:hover{
  border-color:#86ae99;
  transform:translateY(-1px);
}

.business.selected{
  border-color:var(--green);
  background:#f1f8f4;
}

.business-name{
  font-size:19px;
  font-weight:800;
  color:var(--green);
  padding-right:30px;
}

.business-meta{
  margin-top:6px;
  color:var(--muted);
  font-size:14px;
}

.radio{
  float:right;
  width:20px;
  height:20px;
  border:2px solid #b7c7bf;
  border-radius:50%;
}

.business.selected .radio{
  border:6px solid var(--green);
}

.primary{
  width:100%;
  margin-top:22px;
  border:0;
  border-radius:12px;
  padding:15px 20px;
  background:var(--green);
  color:#fff;
  font-size:16px;
  font-weight:800;
  cursor:pointer;
}

.primary:hover{
  background:var(--green2);
}

.primary:disabled{
  opacity:.5;
  cursor:not-allowed;
}

.summary{
  background:var(--light);
  border:1px solid var(--border);
  border-radius:16px;
  padding:22px;
  margin-top:20px;
}

.summary strong{
  color:var(--green);
}

.price{
  margin-top:20px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  border-top:1px solid var(--border);
  padding-top:20px;
}

.price strong{
  font-size:28px;
  color:var(--green);
}

.back{
  display:block;
  text-align:center;
  margin-top:18px;
  color:var(--green);
  text-decoration:none;
  font-size:14px;
  font-weight:700;
}

footer{
  text-align:center;
  color:#7a8580;
  font-size:13px;
  padding:0 0 35px;
}

@media(max-width:600px){

  .card{
    padding:22px;
    border-radius:18px;
  }

  .hero{
    padding-top:20px;
  }

  .business{
    padding:17px;
  }
}
</style>
</head>

<body>

<header>
  <div class="container">

    <a class="logo" href="/">
      <img
        src="/assets/stall-logo.png"
        alt="STore Automation"
      >
      <span>STore Automation</span>
    </a>

  </div>
</header>


<main class="container">

<section class="hero">

  <div class="badge">
    STore Listing · ₹99 One-Time
  </div>

  <h1>
    Connect your business
  </h1>

  <p>
    Connect your Google Business Profile and choose the salon
    or store you want to list on STore Automation.
  </p>

</section>


<div class="card">


  <!-- =========================================
       STEP 1 — GOOGLE CONNECTION
  ========================================== -->

  <section
    id="step-google"
    class="step active"
  >

    <div class="step-title">
      Connect your Google Business Profile
    </div>

    <div class="step-text">
      Sign in with the Google account that manages your business.
      We'll show you the businesses and stores available to that account.
    </div>

    <button
      id="google-button"
      class="google-btn"
      type="button"
      onclick="connectGoogle()"
    >

      <span class="google-icon">
        G
      </span>

      Continue with Google

    </button>

    <div
      id="google-error"
      class="error"
    ></div>

  </section>


  <!-- =========================================
       STEP 2 — BUSINESS SELECTION
  ========================================== -->

  <section
    id="step-businesses"
    class="step"
  >

    <div class="step-title">
      Select your business
    </div>

    <div class="step-text">
      We found the following businesses associated with
      your Google Business Profile. Select the business
      you want to list.
    </div>

    <div
      id="business-loading"
      class="loading"
    >
      Loading your businesses...
    </div>

    <div
      id="business-list"
      class="business-list"
    ></div>

    <button
      id="continue-business"
      class="primary"
      type="button"
      disabled
      onclick="confirmBusiness()"
    >
      Continue
    </button>

    <div
      id="business-error"
      class="error"
    ></div>

  </section>


  <!-- =========================================
       STEP 3 — CONFIRM BUSINESS
  ========================================== -->

  <section
    id="step-confirm"
    class="step"
  >

    <div class="step-title">
      Confirm your business
    </div>

    <div class="step-text">
      Please confirm the business you want to list
      on STore Automation.
    </div>

    <div
      id="business-summary"
      class="summary"
    ></div>

    <div class="price">

      <span>
        STore Listing
      </span>

      <strong>
        ₹99
      </strong>

    </div>

    <button
      id="payment-button"
      class="primary"
      type="button"
      onclick="startPayment()"
    >
      Continue to Payment — ₹99
    </button>

    <div
      id="payment-message"
      class="error"
    ></div>

    <div
      id="payment-success"
      class="success"
    ></div>

    <a
      class="back"
      href="/pricing.html"
    >
      ← Back to Pricing
    </a>

  </section>

</div>

</main>


<footer>
  © STore Automation · Powered by ST Shield
</footer>


<script src="https://checkout.razorpay.com/v1/checkout.js"></script>

<script>

/* =========================================
   GLOBAL STATE
========================================= */

let selectedBusiness = null;
let onboardingId = null;


/* =========================================
   GOOGLE LOGIN
========================================= */

async function connectGoogle(){

  const button =
    document.getElementById(
      'google-button'
    );

  const error =
    document.getElementById(
      'google-error'
    );

  error.style.display = 'none';

  button.disabled = true;

  button.innerHTML =
    '<span class="google-icon">G</span> Connecting to Google...';

  try {

    const response =
      await fetch(
        '/api/customer-google-start',
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },

          body:JSON.stringify({})
        }
      );

    const result =
      await response.json();

    if(
      !response.ok ||
      !result.success
    ){

      throw new Error(
        result.error ||
        'Unable to start Google connection'
      );
    }

    onboardingId =
      result.onboarding_id ||
      null;

    if(
      !result.authorizationUrl
    ){

      throw new Error(
        'Google authorization URL was not returned.'
      );
    }

    window.location.href =
      result.authorizationUrl;

  } catch(error) {

    console.error(
      'Google connection error:',
      error
    );

    showError(
      error,
      error.message ||
      'Unable to connect to Google.'
    );

    button.disabled = false;

    button.innerHTML =
      '<span class="google-icon">G</span> Continue with Google';
  }
}


/* =========================================
   LOAD GOOGLE BUSINESSES
========================================= */

async function loadBusinesses(){

  const params =
    new URLSearchParams(
      window.location.search
    );

  const googleConnected =
    params.get(
      'google_connected'
    );

  const returnedOnboardingId =
    params.get(
      'onboarding_id'
    );


  /*
   * The callback gives us the onboarding ID.
   */
  if(returnedOnboardingId){

    onboardingId =
      returnedOnboardingId;
  }


  /*
   * We only load businesses after
   * successful Google authorization.
   */
  if(
    googleConnected !== '1'
  ){

    return;
  }


  if(!onboardingId){

    showError(
      document.getElementById(
        'business-error'
      ),
      'Onboarding session could not be identified. Please start again.'
    );

    showStep(
      'step-businesses'
    );

    return;
  }


  showStep(
    'step-businesses'
  );


  try {

    /*
     * IMPORTANT:
     *
     * customer-google-locations.mjs
     * requires onboarding_id.
     */
    const response =
      await fetch(
        `/api/customer-google-locations?onboarding_id=${encodeURIComponent(
          onboardingId
        )}`
      );


    const result =
      await response.json();


    if(
      !response.ok
    ){

      throw new Error(
        result.error ||
        'Unable to load businesses'
      );
    }


    if(
      !result.success
    ){

      throw new Error(
        result.error ||
        'Unable to load businesses'
      );
    }


    renderBusinesses(
      result.locations ||
      []
    );


  } catch(error) {

    console.error(
      'Business loading error:',
      error
    );

    document.getElementById(
      'business-loading'
    ).style.display =
      'none';

    showError(
      document.getElementById(
        'business-error'
      ),
      error.message ||
      'Unable to load your businesses.'
    );
  }
}


/* =========================================
   RENDER BUSINESSES
========================================= */

function renderBusinesses(
  locations
){

  const loading =
    document.getElementById(
      'business-loading'
    );

  const list =
    document.getElementById(
      'business-list'
    );

  const error =
    document.getElementById(
      'business-error'
    );


  loading.style.display =
    'none';

  list.innerHTML =
    '';

  error.style.display =
    'none';


  if(
    !Array.isArray(locations) ||
    !locations.length
  ){

    showError(
      error,
      'No businesses were found for this Google account. Make sure the Google account you selected manages at least one Business Profile.'
    );

    return;
  }


  locations.forEach(
    (item) => {

      const business =
        item.location ||
        item;

      const account =
        item.account ||
        {};


      const element =
        document.createElement(
          'div'
        );


      element.className =
        'business';


      element.onclick =
        () => selectBusiness(
          item,
          element
        );


      const name =
        business.title ||
        business.name ||
        'Business';


      const address =
        formatAddress(
          business.storefront_address ||
          business.storefrontAddress ||
          ''
        );


      const phone =
        business.phone_numbers?.primaryPhone ||
        business.phone_numbers?.primaryPhoneNumber ||
        '';


      const website =
        business.website_uri ||
        '';


      element.innerHTML = `

        <span class="radio"></span>

        <div class="business-name">
          ${escapeHtml(name)}
        </div>

        ${
          address
          ? `
            <div class="business-meta">
              ${escapeHtml(address)}
            </div>
          `
          : ''
        }

        ${
          phone
          ? `
            <div class="business-meta">
              ${escapeHtml(phone)}
            </div>
          `
          : ''
        }

        ${
          website
          ? `
            <div class="business-meta">
              ${escapeHtml(website)}
            </div>
          `
          : ''
        }

        ${
          account.account_name
          ? `
            <div
              class="business-meta"
              style="margin-top:10px;font-size:12px;"
            >
              Google Business Account:
              ${escapeHtml(account.account_name)}
            </div>
          `
          : ''
        }

      `;


      list.appendChild(
        element
      );

    }
  );
}


/* =========================================
   SELECT BUSINESS
========================================= */

function selectBusiness(
  business,
  element
){

  document
    .querySelectorAll(
      '.business'
    )
    .forEach(
      item =>
        item.classList.remove(
          'selected'
        )
    );


  element.classList.add(
    'selected'
  );


  selectedBusiness =
    business;


  document.getElementById(
    'continue-business'
  ).disabled =
    false;
}


/* =========================================
   CONFIRM BUSINESS
========================================= */

function confirmBusiness(){

  if(
    !selectedBusiness
  ){

    return;
  }


  const business =
    selectedBusiness.location ||
    selectedBusiness;


  const name =
    business.title ||
    business.name ||
    'Selected Business';


  const address =
    formatAddress(
      business.storefront_address ||
      business.storefrontAddress ||
      ''
    );


  const phone =
    business.phone_numbers?.primaryPhone ||
    business.phone_numbers?.primaryPhoneNumber ||
    '';


  document.getElementById(
    'business-summary'
  ).innerHTML = `

    <strong>
      ${escapeHtml(name)}
    </strong>

    ${
      address
      ? `
        <div
          style="margin-top:7px;color:#68756f;"
        >
          ${escapeHtml(address)}
        </div>
      `
      : ''
    }

    ${
      phone
      ? `
        <div
          style="margin-top:5px;color:#68756f;"
        >
          ${escapeHtml(phone)}
        </div>
      `
      : ''
    }

  `;


  showStep(
    'step-confirm'
  );
}


/* =========================================
   RAZORPAY PAYMENT
========================================= */

async function startPayment(){

  if(
    !selectedBusiness
  ){

    return;
  }


  const button =
    document.getElementById(
      'payment-button'
    );

  const message =
    document.getElementById(
      'payment-message'
    );


  message.style.display =
    'none';


  button.disabled =
    true;

  button.textContent =
    'Preparing Payment...';


  try {

    const business =
      selectedBusiness.location ||
      selectedBusiness;


    const businessName =
      business.title ||
      business.name ||
      '';


    /*
     * We pass the selected Google
     * Business information to the
     * Razorpay order endpoint.
     */
    const response =
      await fetch(
        '/api/razorpay-create-order.mjs',
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },

          body:JSON.stringify({

            customer_name:
              businessName,

            customer_email:
              '',

            customer_phone:
              '',

            business:
              business,

            onboarding_id:
              onboardingId

          })
        }
      );


    const result =
      await response.json();


    if(
      !response.ok ||
      !result.success
    ){

      throw new Error(
        result.error ||
        'Unable to initialise payment'
      );
    }


    const options = {

      key:
        result.key_id,

      amount:
        result.amount,

      currency:
        result.currency,

      name:
        'STore Automation',

      description:
        'STore Listing — One-time ₹99',

      order_id:
        result.order_id,


      prefill:{
        name:
          businessName
      },


      notes:{

        product:
          'STore Automation',

        plan:
          'listing_99',

        business_name:
          businessName,

        onboarding_id:
          onboardingId || ''

      },


      theme:{
        color:
          '#123b2a'
      },


      handler:
        async function(
          paymentResponse
        ){

          message.style.display =
            'block';

          message.className =
            'success';

          message.textContent =
            'Verifying payment...';


          try {

            const verifyResponse =
              await fetch(
                '/api/razorpay-verify-payment.mjs',
                {
                  method:'POST',

                  headers:{
                    'Content-Type':
                      'application/json'
                  },

                  body:JSON.stringify({

                    razorpay_order_id:
                      paymentResponse
                        .razorpay_order_id,

                    razorpay_payment_id:
                      paymentResponse
                        .razorpay_payment_id,

                    razorpay_signature:
                      paymentResponse
                        .razorpay_signature

                  })
                }
              );


            const verifyResult =
              await verifyResponse.json();


            if(
              !verifyResponse.ok ||
              !verifyResult.success
            ){

              throw new Error(
                verifyResult.error ||
                'Payment verification failed'
              );
            }


            message.textContent =
              '✓ Payment successful. Your STore listing payment has been recorded.';


            button.textContent =
              'Listing Payment Successful';


          } catch(error) {

            console.error(
              'Payment verification error:',
              error
            );


            message.className =
              'error';

            message.style.display =
              'block';

            message.textContent =
              'Payment received, but verification is still being completed. Please contact support if needed.';


            button.disabled =
              false;

            button.textContent =
              'Try Again — ₹99';
          }

        },


      modal:{
        ondismiss:
          function(){

            button.disabled =
              false;

            button.textContent =
              'Continue to Payment — ₹99';

          }
      }

    };


    const razorpay =
      new Razorpay(
        options
      );


    razorpay.on(
      'payment.failed',
      function(){

        showError(
          message,
          'Payment was not completed. Please try again.'
        );


        button.disabled =
          false;

        button.textContent =
          'Try Again — ₹99';

      }
    );


    razorpay.open();


  } catch(error) {

    console.error(
      'Payment error:',
      error
    );


    showError(
      message,
      error.message ||
      'Unable to start payment.'
    );


    button.disabled =
      false;

    button.textContent =
      'Continue to Payment — ₹99';
  }
}


/* =========================================
   STEP NAVIGATION
========================================= */

function showStep(
  id
){

  document
    .querySelectorAll(
      '.step'
    )
    .forEach(
      step =>
        step.classList.remove(
          'active'
        )
    );


  const target =
    document.getElementById(
      id
    );


  if(target){

    target.classList.add(
      'active'
    );
  }


  window.scrollTo({
    top:0,
    behavior:'smooth'
  });
}


/* =========================================
   ERROR DISPLAY
========================================= */

function showError(
  element,
  message
){

  if(
    element instanceof Error
  ){

    return;
  }


  if(!element){

    return;
  }


  element.className =
    'error';

  element.style.display =
    'block';

  element.textContent =
    message ||
    'Something went wrong.';
}


/* =========================================
   ADDRESS FORMATTER
========================================= */

function formatAddress(
  address
){

  if(!address){

    return '';
  }


  if(
    typeof address === 'string'
  ){

    return address;
  }


  if(
    Array.isArray(
      address.addressLines
    )
  ){

    return address.addressLines.join(
      ', '
    );
  }


  return [

    ...(Array.isArray(
      address.addressLines
    )
      ? address.addressLines
      : []),

    address.locality,

    address.administrativeArea,

    address.postalCode,

    address.regionCode

  ]
    .filter(Boolean)
    .join(', ');
}


/* =========================================
   HTML ESCAPING
========================================= */

function escapeHtml(
  value
){

  return String(
    value || ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}


/* =========================================
   STARTUP
========================================= */

loadBusinesses();

</script>

</body>
</html>
