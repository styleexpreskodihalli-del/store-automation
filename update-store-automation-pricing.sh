#!/usr/bin/env bash
set -euo pipefail

FILE="pricing.html"

if [ ! -f "$FILE" ]; then
  echo "ERROR: pricing.html not found. Run this from the Store Automation project root."
  exit 1
fi

cp "$FILE" "${FILE}.before-pricing-refresh"

python3 - <<'PY'
from pathlib import Path
import re

path = Path("pricing.html")
old = path.read_text(encoding="utf-8")

m = re.search(r'(<script>\s*async function startSTallListingPayment\(\).*?</script>)', old, re.S)
if not m:
    raise SystemExit("ERROR: Could not find the existing Razorpay payment script. No changes made.")

payment_script = m.group(1)

new = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pricing | STore Automation</title>
<meta name="description" content="Simple, powerful automation plans for local businesses. Basic ₹499, Growth ₹999 and Full Automate ₹2,499 per month.">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>
:root{--green:#123b2a;--green2:#1c6044;--mint:#e9f6ef;--ink:#15231e;--muted:#68766f;--line:#dfe8e3;--bg:#f5f8f6;--white:#fff}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
a{color:inherit}.container{width:min(1120px,calc(100% - 32px));margin:auto}
.brand{text-align:center;padding:30px 0 2px}.brand img{width:78px;height:auto;display:block;margin:0 auto 9px}.brand-title{font-size:14px;font-weight:900}.brand-sub{font-size:11px;color:var(--muted);margin-top:2px}
.back{display:inline-block;margin-top:18px;text-decoration:none;color:var(--green2);font-size:13px;font-weight:800}
.hero{text-align:center;padding:55px 0 30px}.eyebrow{display:inline-block;background:var(--mint);color:var(--green2);font-size:11px;font-weight:900;padding:7px 12px;border-radius:999px;letter-spacing:.3px}
.hero h1{font-size:clamp(38px,6vw,62px);line-height:1.04;letter-spacing:-2.3px;margin:17px auto 13px;max-width:820px}.hero h1 span{color:var(--green2)}.hero p{max-width:680px;margin:auto;color:var(--muted);font-size:16px}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:18px auto 58px}
.plan{position:relative;background:var(--white);border:1px solid var(--line);border-radius:22px;padding:28px;box-shadow:0 8px 30px rgba(18,59,42,.06);display:flex;flex-direction:column}
.plan.featured{border:2px solid var(--green2);box-shadow:0 20px 55px rgba(18,59,42,.14);transform:translateY(-7px)}
.popular{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--green);color:#fff;font-size:10px;font-weight:950;padding:6px 14px;border-radius:999px;letter-spacing:.5px;white-space:nowrap}
.kicker{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:900}.plan h2{font-size:24px;letter-spacing:-.7px;margin:6px 0 4px}.desc{font-size:13px;color:var(--muted);min-height:61px}
.amount{font-size:39px;line-height:1.1;font-weight:950;letter-spacing:-1.6px;color:var(--green);margin:14px 0 2px}.amount small{font-size:13px;letter-spacing:0;font-weight:650;color:var(--muted)}
.plan ul{list-style:none;padding:0;margin:17px 0 24px;display:grid;gap:9px}.plan li{font-size:13px;color:#425049}.plan li:before{content:"✓";color:var(--green2);font-weight:950;margin-right:8px}
.button{display:block;margin-top:auto;text-align:center;text-decoration:none;background:var(--green);color:#fff;border:1px solid var(--green);padding:12px;border-radius:10px;font-size:13px;font-weight:900}.button.alt{background:#fff;color:var(--green)}
.listing{background:var(--green);color:#fff;border-radius:22px;padding:28px;display:grid;grid-template-columns:1fr auto;gap:25px;align-items:center;margin:0 auto 58px}.listing h2{color:#fff;font-size:23px;margin:0 0 5px}.listing p{color:#c9dad2;font-size:13px;margin:0;max-width:700px}.listing .amount{color:#fff;margin:0}.listing .amount small{color:#c9dad2}.listing button{background:#fff;color:var(--green);border:0;border-radius:10px;padding:12px 18px;font-size:13px;font-weight:950;cursor:pointer;white-space:nowrap}
#stall-payment-message{font-size:12px;margin-top:8px}.section{text-align:center;margin-bottom:58px}.section h2{font-size:29px;letter-spacing:-.8px;margin:0 0 7px}.section>p{font-size:14px;color:var(--muted);max-width:650px;margin:0 auto 25px}
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;text-align:left}.feature{background:#fff;border:1px solid var(--line);border-radius:16px;padding:19px}.feature-icon{font-size:20px}.feature h3{font-size:15px;margin:7px 0 3px}.feature p{font-size:12px;color:var(--muted);margin:0}
.annual{background:#fff;border:1px solid var(--line);border-radius:18px;padding:21px;text-align:center;color:var(--muted);font-size:13px;margin-bottom:48px}.annual strong{color:var(--green)}
.footer{border-top:1px solid var(--line);padding:25px 0 40px;text-align:center;color:var(--muted);font-size:11px}.footer-links{display:flex;justify-content:center;gap:13px;flex-wrap:wrap;margin-bottom:8px}.footer-links a{text-decoration:none;color:#405048;font-weight:750}
@media(max-width:820px){.plans{grid-template-columns:1fr}.plan.featured{transform:none}.features{grid-template-columns:1fr 1fr}.listing{grid-template-columns:1fr}}
@media(max-width:520px){.container{width:min(100% - 24px,1120px)}.hero{padding-top:42px}.hero h1{letter-spacing:-1.4px}.features{grid-template-columns:1fr}.plan{padding:23px}.listing{padding:23px}}
</style>
</head>
<body>
<div class="container">
  <div class="brand">
    <a href="/" style="display:inline-block;text-decoration:none"><img src="/assets/stall-logo.png" alt="STore Automation"></a>
    <div class="brand-title">STore Automation</div>
    <div class="brand-sub">Powered by ST Shield</div>
  </div>

  <a class="back" href="/">← Back to STore</a>

  <section class="hero">
    <div class="eyebrow">● Simple pricing · Powerful automation</div>
    <h1>Choose how much of your business you want to <span>automate.</span></h1>
    <p>Start with the essentials, grow when you're ready, and automate more as your business scales.</p>
  </section>

  <section id="plans" class="plans">
    <article class="plan">
      <div class="kicker">Get Started</div><h2>Basic</h2>
      <p class="desc">For businesses getting started with digital automation.</p>
      <div class="amount">₹499 <small>/ month</small></div>
      <ul><li>Business Profile</li><li>Social Media Content Creation</li><li>Promotional Offers</li><li>Customer Lead Capture</li><li>Basic Campaign Management</li><li>Business Dashboard</li><li>Essential Automation</li></ul>
      <a class="button alt" href="/contact.html">Start with Basic</a>
    </article>

    <article class="plan featured">
      <div class="popular">MOST POPULAR</div><div class="kicker">Grow Faster</div><h2>Growth</h2>
      <p class="desc">For businesses ready to grow consistently and engage customers better.</p>
      <div class="amount">₹999 <small>/ month</small></div>
      <ul><li>Everything in Basic</li><li>Social Media Scheduling</li><li>Advanced Campaigns</li><li>Google Review Management</li><li>Customer Engagement Tools</li><li>Automated Promotions</li><li>Enhanced Lead Management</li><li>Growth Analytics</li></ul>
      <a class="button" href="/contact.html">Start Growing</a>
    </article>

    <article class="plan">
      <div class="kicker">Automate More</div><h2>Full Automate</h2>
      <p class="desc">For businesses that want their marketing and customer operations working smarter.</p>
      <div class="amount">₹2,499 <small>/ month</small></div>
      <ul><li>Everything in Growth</li><li>Advanced Business Automation</li><li>Automated Customer Follow-ups</li><li>Advanced Lead Management</li><li>Multi-location Support</li><li>Team Access</li><li>Advanced Analytics</li><li>Automated Campaign Workflows</li><li>Priority Support</li></ul>
      <a class="button alt" href="/contact.html">Automate More</a>
    </article>
  </section>

  <section class="listing">
    <div>
      <h2>Want to get your business listed first?</h2>
      <p>A simple one-time onboarding option for businesses that want to establish their STore presence before moving into automation.</p>
      <div id="stall-payment-message"></div>
    </div>
    <div><div class="amount">₹99 <small>one-time</small></div><button id="stall-listing-button" type="button" onclick="startSTallListingPayment()">Get Listed — ₹99</button></div>
  </section>

  <section class="section">
    <h2>Built around your business</h2>
    <p>STore Automation brings repetitive digital work into one simple platform so you can spend more time serving customers.</p>
    <div class="features">
      <div class="feature"><div class="feature-icon">📱</div><h3>Social Media</h3><p>Create, manage and schedule content for your business.</p></div>
      <div class="feature"><div class="feature-icon">🎯</div><h3>Offers & Promotions</h3><p>Keep offers visible and campaigns organised.</p></div>
      <div class="feature"><div class="feature-icon">⭐</div><h3>Reviews</h3><p>Stay on top of customer feedback and online reputation.</p></div>
      <div class="feature"><div class="feature-icon">👥</div><h3>Customer Engagement</h3><p>Turn genuine enquiries into meaningful conversations.</p></div>
      <div class="feature"><div class="feature-icon">📊</div><h3>Business Insights</h3><p>Understand what is working and where to improve.</p></div>
      <div class="feature"><div class="feature-icon">⚙️</div><h3>Automation</h3><p>Reduce repetitive digital tasks and stay consistent.</p></div>
    </div>
  </section>

  <div class="annual"><strong>Annual plans:</strong> Eligible annual subscriptions receive a 10% discount. Features may evolve as STore Automation expands.</div>

  <footer class="footer">
    <div class="footer-links"><a href="/about.html">About Us</a><a href="/pricing.html">Pricing</a><a href="/contact.html">Contact</a><a href="/privacy.html">Privacy Policy</a><a href="/terms.html">Terms</a><a href="/refund-policy.html">Refund Policy</a></div>
    Your business. Your customers. Your automation.
  </footer>
</div>

''' + payment_script + r'''
</body>
</html>
'''

path.write_text(new, encoding="utf-8")
print("pricing.html updated successfully.")
print("Existing Razorpay payment function preserved.")
print("Backup:", "pricing.html.before-pricing-refresh")
PY

echo ""
echo "DONE — pricing.html has been refreshed."
echo "Review it with:"
echo "  git diff -- pricing.html"
echo ""
echo "If it looks good:"
echo "  git add pricing.html"
echo '  git commit -m "Refresh Store Automation pricing page"'
echo "  git push origin main"
