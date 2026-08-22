const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const AMOUNT = 29900;
const CURRENCY = "INR";
const PRODUCT = "₹1 Crore / 365 — The Revenue Operating System™ — Part 1";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function auth() {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) throw new Error("Razorpay configuration is missing.");
  return Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
}
async function razorpay(path, options = {}) {
  return fetch(`https://api.razorpay.com/v1${path}`, { ...options, headers: { Authorization: `Basic ${auth()}`, "Content-Type": "application/json", ...(options.headers || {}) } });
}
async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
async function createOrder(body) {
  const name = String(body?.name || "").trim().slice(0, 100);
  const email = String(body?.email || "").trim().slice(0, 160);
  const phone = String(body?.phone || "").trim().replace(/[^0-9+]/g, "").slice(0, 20);
  if (!name || !email || !phone) return json({ success: false, error: "Name, email and phone are required." }, 400);
  const response = await razorpay("/orders", { method: "POST", body: JSON.stringify({ amount: AMOUNT, currency: CURRENCY, receipt: `ebook_${Date.now()}`, notes: { product: PRODUCT, customer_name: name, customer_email: email, customer_phone: phone } }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json({ success: false, error: result?.error?.description || "Unable to create payment order." }, 500);
  return json({ success: true, key_id: RAZORPAY_KEY_ID, order_id: result.id, amount: result.amount, currency: result.currency, product: PRODUCT, customer: { name, email, phone } });
}
async function verifyPayment(body) {
  const orderId = String(body?.razorpay_order_id || "");
  const paymentId = String(body?.razorpay_payment_id || "");
  const signature = String(body?.razorpay_signature || "");
  if (!orderId || !paymentId || !signature) return json({ success: false, verified: false, error: "Payment verification details are required." }, 400);
  const expected = await hmacSha256Hex(RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  if (!safeEqual(expected, signature)) return json({ success: false, verified: false, error: "Payment signature could not be verified." }, 400);
  const paymentResponse = await razorpay(`/payments/${encodeURIComponent(paymentId)}`);
  const payment = await paymentResponse.json().catch(() => ({}));
  if (!paymentResponse.ok) return json({ success: false, verified: false, error: "Unable to confirm payment with Razorpay." }, 502);
  if (payment.order_id !== orderId || payment.amount !== AMOUNT || payment.currency !== CURRENCY || payment.status !== "captured") return json({ success: false, verified: false, error: "Payment details did not match the ebook order." }, 400);
  return json({ success: true, verified: true, paid: true, product: PRODUCT, payment_id: paymentId, redirect: "/ebook/?paid=1" });
}
export default async function handler(request) {
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action === "create_order") return await createOrder(body);
    if (body?.action === "verify_payment") return await verifyPayment(body);
    return json({ success: false, error: "Invalid action" }, 400);
  } catch (error) {
    console.error("EBOOK PAYMENT ERROR", error);
    return json({ success: false, error: "Payment service is temporarily unavailable." }, 500);
  }
}
