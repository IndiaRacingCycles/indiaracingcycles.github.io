const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.SITE_URL || "https://indiaracingcycles.github.io";
  const allowOrigin = origin === allowed ? origin : allowed;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
const nowIso = () => new Date().toISOString();
const hex = (bytes) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomToken = () => {
  const data = new Uint8Array(32);
  crypto.getRandomValues(data);
  return hex(data);
};
async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
function validEmail(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function htmlPage(title, message) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px/1.6 Roboto,Arial,sans-serif;background:#f5f4fa;color:#1b1b24;padding:40px 18px"><main style="max-width:560px;margin:8vh auto;background:white;border-radius:24px;padding:32px;box-shadow:0 10px 35px #0001"><h1>${title}</h1><p>${message}</p><a href="${"https://indiaracingcycles.github.io/IndiaRacingCycles/"}">Return to India Racing Cycles</a></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
async function sendEmail(env, to, subject, html, textBody) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) throw new Error("Email service is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html, text: textBody })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("Resend API error:", response.status, details.slice(0, 1000));
    throw new Error(`Email provider returned ${response.status}.`);
  }
  return response.json();
}
async function limitSignup(request, env, purpose = "signup", maxAttempts = 50) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await sha256(purpose + ":" + ip);
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = await env.DB.prepare("SELECT attempts, window_started_at FROM signup_attempts WHERE key_hash = ?").bind(key).first();
  if (!row || row.window_started_at < cutoff) {
    await env.DB.prepare("INSERT INTO signup_attempts (key_hash, attempts, window_started_at) VALUES (?, 1, ?) ON CONFLICT(key_hash) DO UPDATE SET attempts=1, window_started_at=excluded.window_started_at").bind(key, nowIso()).run();
    return true;
  }
  if (row.attempts >= maxAttempts) return false;
  await env.DB.prepare("UPDATE signup_attempts SET attempts = attempts + 1 WHERE key_hash = ?").bind(key).run();
  return true;
}
async function handleSubscribe(request, env) {
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ ok: true });
  const email = String(body.email || "").trim().toLowerCase();
  if (!validEmail(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (body.consent !== true) return json({ error: "Please agree to receive India Racing Cycles updates." }, 400);

  const existing = await env.DB.prepare("SELECT status FROM subscribers WHERE email = ?").bind(email).first();
  if (existing?.status === "active") {
    return json({ ok: true, status: "active", message: "This email address is already on the updates list." });
  }
  if (existing?.status === "pending") {
    return json({ ok: true, status: "pending", message: "Your email address is already saved on the updates list. Email delivery is not available yet." });
  }

  // Collection-only mode: save the address as pending. No confirmation email is sent.
  // A versioned rate-limit key gives this mode a fresh signup counter.
  if (!await limitSignup(request, env, "newsletter-signup-v3", 50)) {
    return json({ error: "Too many attempts. Please try again later." }, 429);
  }

  const created = nowIso();
  await env.DB.prepare(`INSERT INTO subscribers (email,status,confirm_token_hash,unsubscribe_token_hash,created_at)
    VALUES (?, 'pending', NULL, NULL, ?)
    ON CONFLICT(email) DO UPDATE SET
      status='pending',
      confirm_token_hash=NULL,
      unsubscribe_token_hash=NULL,
      created_at=excluded.created_at,
      confirmed_at=NULL,
      unsubscribed_at=NULL`).bind(email, created).run();

  return json({
    ok: true,
    status: "pending",
    message: "Thanks! Your email address has been saved to the India Racing Cycles updates list. Email delivery is not available yet, so you will not receive confirmation emails or newsletters for now."
  }, 202);
}async function handleConfirm(url, env) {
  const token = url.searchParams.get("token") || "";
  if (!token || token.length > 128) return htmlPage("Invalid link", "This confirmation link is not valid. Please sign up again.");
  const hash = await sha256(token);
  const row = await env.DB.prepare("SELECT email FROM subscribers WHERE confirm_token_hash = ? AND status = 'pending'").bind(hash).first();
  if (!row) return htmlPage("Link expired", "This confirmation link was already used or has expired. Please sign up again.");
  await env.DB.prepare("UPDATE subscribers SET status='active', confirmed_at=?, confirm_token_hash=NULL WHERE email=?").bind(nowIso(), row.email).run();
  return htmlPage("You're subscribed", "Your email address is confirmed. You will receive India Racing Cycles updates. You can unsubscribe from any newsletter email.");
}
async function handleUnsubscribe(url, env) {
  const token = url.searchParams.get("token") || "";
  if (!token || token.length > 128) return htmlPage("Invalid link", "This unsubscribe link is not valid.");
  const hash = await sha256(token);
  const row = await env.DB.prepare("SELECT email FROM subscribers WHERE unsubscribe_token_hash = ?").bind(hash).first();
  if (!row) return htmlPage("Link not found", "This unsubscribe link is invalid or has already been used.");
  await env.DB.prepare("UPDATE subscribers SET status='unsubscribed', unsubscribed_at=?, confirm_token_hash=NULL WHERE email=?").bind(nowIso(), row.email).run();
  return htmlPage("Unsubscribed", "You have been removed from India Racing Cycles email updates.");
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}
function publicUrl(value) {
  const raw = cleanText(value, 1000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}
async function handleEventSuggestion(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Please send the event information again." }, 400);
  if (body.website) return json({ ok: true }, 202);
  if (!await limitSignup(request, env, "event-suggestion-v2", 5)) {
    return json({ error: "Too many submissions from this connection. Please try again later." }, 429);
  }

  const sourceUrl = publicUrl(body.source_url);
  const posterUrl = publicUrl(body.poster_url);
  if (sourceUrl === null || posterUrl === null) {
    return json({ error: "Please use a valid public web link beginning with http:// or https://." }, 400);
  }
  const email = cleanText(body.contributor_email, 254).toLowerCase();
  const contributorPhone = cleanText(body.contributor_phone, 25);
  const contributorContact = cleanText(body.contributor_contact, 500);
  const organiserEmail = cleanText(body.organiser_email, 254).toLowerCase();
  if (email && !validEmail(email)) return json({ error: "Please check your email address." }, 400);
  const phoneDigits = Array.from(contributorPhone).filter(ch => ch >= "0" && ch <= "9").length;
  if (contributorPhone && (phoneDigits < 7 || phoneDigits > 15 || !/^[+0-9 ()-]+$/.test(contributorPhone))) {
    return json({ error: "Please enter a valid contact number, or leave it blank." }, 400);
  }
  if (organiserEmail && !validEmail(organiserEmail)) return json({ error: "Please check the organiser email address." }, 400);

  const imageDataUrl = typeof body.image_data_url === "string" ? body.image_data_url.trim() : "";
  const imageFilename = cleanText(body.image_filename, 160);
  if (imageDataUrl) {
    const validImage = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl);
    if (!validImage || imageDataUrl.length > 820000) {
      return json({ error: "The image could not be accepted. Please choose a smaller JPG, PNG or WebP image and try again." }, 400);
    }
  }

  const payload = {
    event_name: cleanText(body.event_name, 180),
    source_url: sourceUrl,
    source_platform: cleanText(body.source_platform, 60),
    event_date: cleanText(body.event_date, 10),
    event_date_end: cleanText(body.event_date_end, 10),
    location: cleanText(body.location, 180),
    category: cleanText(body.category, 80),
    organiser: cleanText(body.organiser, 180),
    organiser_phone: cleanText(body.organiser_phone, 40),
    organiser_email: organiserEmail,
    poster_url: posterUrl,
    details: cleanText(body.details, 5000),
    image_filename: imageFilename,
    image_data_url: imageDataUrl,
    contributor_contact: contributorContact,
    contributor_name: cleanText(body.contributor_name, 100),
    contributor_phone: contributorPhone,
    contributor_email: email
  };
  for (const key of ["event_date", "event_date_end"]) {
    if (payload[key] && !/^\d{4}-\d{2}-\d{2}$/.test(payload[key])) {
      return json({ error: "Please enter valid event dates, or leave the date fields blank." }, 400);
    }
  }
  if (payload.event_date && payload.event_date_end && payload.event_date_end < payload.event_date) {
    return json({ error: "The event end date cannot be before its start date." }, 400);
  }
  const useful = ["event_name","source_url","event_date","event_date_end","location","category","organiser","poster_url","details","image_data_url"];
  if (!useful.some(key => payload[key])) {
    return json({ error: "Please write a note, share an event link or attach an image." }, 400);
  }

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO event_suggestions (id,status,payload_json,created_at,updated_at) VALUES (?,'pending',?,?,?)"
  ).bind(id, JSON.stringify(payload), timestamp, timestamp).run();

  let notificationSent = false;
  if (env.ADMIN_EMAIL && env.RESEND_API_KEY && env.FROM_EMAIL) {
    const safePayload = Object.entries(payload).filter(([key,value]) => key !== "image_data_url" && value);
    const lines = safePayload.map(([key,value]) =>
      "<p><strong>" + escapeHtml(key.replaceAll("_"," ")) + ":</strong> " + escapeHtml(value) + "</p>"
    ).join("");
    const imageNote = imageDataUrl ? "<p><strong>Image:</strong> An image attachment is included in the private admin review queue.</p>" : "";
    const html = "<div style=\"font:15px/1.6 Arial,sans-serif\"><h2>New India Racing Cycles event tip</h2><p>Suggestion ID: " + escapeHtml(id) + "</p><p>Status: Pending manual review</p>" + lines + imageNote + "</div>";
    const textBody = "New suggestion " + id + "\n\n" + safePayload.map(([key,value])=>key + ": " + value).join("\n") + (imageDataUrl ? "\nImage attachment: available in admin dashboard." : "");
    try {
      await sendEmail(env, env.ADMIN_EMAIL, "New cycling event tip — manual review needed", html, textBody);
      notificationSent = true;
    } catch (error) {
      console.error("Suggestion stored, but admin notification failed:", error);
    }
  }
  return json({ ok: true, id, status: "pending", notificationSent }, 202);
}

function isAdmin(request, env) {
  return Boolean(env.ADMIN_API_TOKEN) &&
    request.headers.get("Authorization") === "Bearer " + env.ADMIN_API_TOKEN;
}

function makeEvent(body, forcedId) {
  const title = cleanText(body.title || body.event_name, 180);
  const startDate = cleanText(body.start_date || body.event_date, 10);
  const endDate = cleanText(body.end_date || body.event_date_end || startDate, 10);
  if (!title) return { error: "Event name is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { error: "A valid event start date is required before publishing." };
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return { error: "Please enter a valid event end date." };
  if (endDate && endDate < startDate) return { error: "The event end date cannot be before its start date." };

  const sourceUrl = publicUrl(body.source_url);
  const registrationUrl = publicUrl(body.registration_url);
  const posterUrl = publicUrl(body.poster_url);
  if (sourceUrl === null || registrationUrl === null || posterUrl === null) {
    return { error: "Event, registration and poster links must be public http:// or https:// URLs." };
  }
  const slug = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "cycling-event";
  const id = cleanText(forcedId || body.id, 100) || (slug + "-" + crypto.randomUUID().slice(0, 8));
  const discipline = cleanText(body.discipline || body.category, 80);
  const rawCategories = Array.isArray(body.categories) ? body.categories : cleanText(body.categories, 500).split(",");
  const categories = [...new Set(rawCategories.map(value => cleanText(value, 80)).filter(Boolean))];
  if (discipline && !categories.includes(discipline)) categories.unshift(discipline);
  const status = ["confirmed", "postponed", "cancelled", "completed"].includes(body.status) ? body.status : "confirmed";
  const event = {
    id,
    title,
    start_date: startDate,
    end_date: endDate,
    location: cleanText(body.location, 220),
    state: cleanText(body.state, 100),
    discipline,
    categories,
    organiser: cleanText(body.organiser, 180),
    description: cleanText(body.description || body.details, 5000),
    registration_url: registrationUrl,
    contact_email: cleanText(body.contact_email || body.organiser_email, 254).toLowerCase(),
    contact_phone: cleanText(body.contact_phone || body.organiser_phone, 50),
    poster_url: posterUrl,
    source_url: sourceUrl,
    source_links: Array.isArray(body.source_links) ? body.source_links.slice(0, 10) : [],
    status,
    verified_at: cleanText(body.verified_at, 10) || nowIso().slice(0, 10),
    confidence: cleanText(body.confidence, 60) || "admin-reviewed",
    hidden: Boolean(body.hidden)
  };
  return { event };
}
async function handleAdminSuggestions(request, url, env) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (request.method === "GET" && url.pathname === "/api/admin/event-suggestions") {
    const status = cleanText(url.searchParams.get("status") || "pending", 20);
    if (!["pending", "reviewed", "added", "rejected", "all"].includes(status)) {
      return json({ error: "Unknown status filter." }, 400);
    }
    const result = status === "all"
      ? await env.DB.prepare("SELECT * FROM event_suggestions ORDER BY created_at DESC LIMIT 200").all()
      : await env.DB.prepare("SELECT * FROM event_suggestions WHERE status=? ORDER BY created_at DESC LIMIT 200").bind(status).all();
    return json({
      suggestions: (result.results || []).map(row => ({
        id: row.id, status: row.status, created_at: row.created_at,
        updated_at: row.updated_at, review_note: row.review_note,
        ...JSON.parse(row.payload_json)
      }))
    });
  }

  const suggestionPrefix = "/api/admin/event-suggestions/";
  const suggestionTail = url.pathname.startsWith(suggestionPrefix) ? url.pathname.slice(suggestionPrefix.length) : "";
  const approveId = suggestionTail.endsWith("/approve") ? suggestionTail.slice(0, -8) : "";
  const approveMatch = /^[a-f0-9-]{36}$/i.test(approveId);
  if (request.method === "POST" && approveMatch) {
    const suggestionId = approveId;
    const row = await env.DB.prepare("SELECT * FROM event_suggestions WHERE id=?").bind(suggestionId).first();
    if (!row) return json({ error: "Suggestion not found." }, 404);
    if (row.status === "added") return json({ error: "This suggestion has already been added to the calendar." }, 409);
    const suggestion = JSON.parse(row.payload_json);
    const body = await request.json().catch(() => ({}));
    const parsed = makeEvent({ ...suggestion, ...body, confidence: "community-submitted" });
    if (parsed.error) return json({ error: parsed.error }, 400);
    const event = parsed.event;
    const stamp = nowIso();
    const saveEvent = env.DB.prepare(
      "INSERT INTO events (id,title,start_date,end_date,status,payload_json,updated_at) VALUES (?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,payload_json=excluded.payload_json,updated_at=excluded.updated_at"
    ).bind(event.id, event.title, event.start_date, event.end_date, event.status, JSON.stringify(event), stamp);
    const markSuggestion = env.DB.prepare(
      "UPDATE event_suggestions SET status='added',updated_at=?,review_note=? WHERE id=?"
    ).bind(stamp, "Approved and published as event " + event.id, suggestionId);
    await env.DB.batch([saveEvent, markSuggestion]);
    return json({ ok: true, status: "added", event }, 201);
  }

  if (request.method === "PATCH") {
    const patchId = suggestionTail;
    if (!/^[a-f0-9-]{36}$/i.test(patchId)) return json({ error: "Invalid suggestion ID." }, 400);
    const body = await request.json().catch(() => ({}));
    const status = cleanText(body.status, 20);
    if (!["reviewed", "added", "rejected"].includes(status)) {
      return json({ error: "Status must be reviewed, added or rejected." }, 400);
    }
    const note = cleanText(body.review_note, 1000);
    const result = await env.DB.prepare(
      "UPDATE event_suggestions SET status=?, updated_at=?, review_note=? WHERE id=?"
    ).bind(status, nowIso(), note, patchId).run();
    if (!result.meta?.changes) return json({ error: "Suggestion not found." }, 404);
    return json({ ok: true, id: patchId, status });
  }
  return json({ error: "Method not allowed." }, 405);
}
async function handleAdminEvents(request, url, env) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (request.method === "GET" && url.pathname === "/api/admin/events") {
    const rows = await env.DB.prepare("SELECT * FROM events ORDER BY start_date,id").all();
    return json({ events: (rows.results || []).map(row => JSON.parse(row.payload_json)) });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/events") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Please send the event details again." }, 400);
    const parsed = makeEvent(body);
    if (parsed.error) return json({ error: parsed.error }, 400);
    const event = parsed.event;
    const stamp = nowIso();
    await env.DB.prepare(
      "INSERT INTO events (id,title,start_date,end_date,status,payload_json,updated_at) VALUES (?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,payload_json=excluded.payload_json,updated_at=excluded.updated_at"
    ).bind(event.id, event.title, event.start_date, event.end_date, event.status, JSON.stringify(event), stamp).run();
    return json({ ok: true, event }, 201);
  }
  return json({ error: "Method not allowed." }, 405);
}

async function handleAdminSubscribers(request, url, env) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (request.method !== "GET" || url.pathname !== "/api/admin/subscribers") {
    return json({ error: "Method not allowed." }, 405);
  }
  const status = cleanText(url.searchParams.get("status") || "all", 20);
  if (!["all", "pending", "active", "unsubscribed"].includes(status)) {
    return json({ error: "Unknown subscriber status filter." }, 400);
  }
  const result = status === "all"
    ? await env.DB.prepare("SELECT email,status,created_at,confirmed_at,unsubscribed_at FROM subscribers ORDER BY created_at DESC LIMIT 1000").all()
    : await env.DB.prepare("SELECT email,status,created_at,confirmed_at,unsubscribed_at FROM subscribers WHERE status=? ORDER BY created_at DESC LIMIT 1000").bind(status).all();
  return json({ subscribers: result.results || [] });
}

async function handleNewsletter(request, env) {
  if (!env.ADMIN_API_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.ADMIN_API_TOKEN}`) return json({ error: "Unauthorized." }, 401);
  const body = await request.json().catch(() => ({}));
  const subject = String(body.subject || "").trim().slice(0, 180);
  const html = String(body.html || "");
  const textBody = String(body.text || "");
  if (!subject || (!html && !textBody) || html.length > 50000 || textBody.length > 20000) return json({ error: "Provide a subject and email content within the size limits." }, 400);
  const subscribers = await env.DB.prepare("SELECT email, unsubscribe_token_hash FROM subscribers WHERE status='active' ORDER BY created_at").all();
  let sent = 0, failed = 0;
  for (const subscriber of subscribers.results || []) {
    try {
      const token = randomToken();
      const tokenHash = await sha256(token);
      await env.DB.prepare("UPDATE subscribers SET unsubscribe_token_hash=? WHERE email=?").bind(tokenHash, subscriber.email).run();
      const unsubscribeUrl = `${env.WORKER_URL || new URL(request.url).origin}/api/unsubscribe?token=${token}`;
      const finalHtml = `${html}<hr><p style="font:12px Arial;color:#666">You received this because you confirmed your subscription to India Racing Cycles. <a href="${unsubscribeUrl}">Unsubscribe</a>.</p>`;
      const finalText = `${textBody}\n\nUnsubscribe: ${unsubscribeUrl}`;
      await sendEmail(env, subscriber.email, subject, finalHtml, finalText);
      sent++;
    } catch (e) { failed++; }
  }
  await env.DB.prepare("INSERT INTO newsletter_log (subject,sent_count,failed_count,sent_at) VALUES (?,?,?,?)").bind(subject,sent,failed,nowIso()).run();
  return json({ ok: true, sent, failed, recipients: (subscribers.results || []).length });
}
async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });
  if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "india-racing-cycles-api", time: nowIso() }, 200, cors(request, env));
  if (url.pathname === "/api/events" && request.method === "GET") {
    const status = url.searchParams.get("status");
    const rows = status ? await env.DB.prepare("SELECT payload_json FROM events WHERE status=? ORDER BY start_date").bind(status).all() : await env.DB.prepare("SELECT payload_json FROM events ORDER BY start_date").all();
    return json({ events: (rows.results || []).map(r => JSON.parse(r.payload_json)) }, 200, cors(request, env));
  }
  if (url.pathname === "/api/news" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT payload_json FROM news ORDER BY published_at DESC LIMIT 100").all();
    return json({ news: (rows.results || []).map(r => JSON.parse(r.payload_json)) }, 200, cors(request, env));
  }
  if (url.pathname === "/api/event-suggestions" && request.method === "POST") {
    try { return await handleEventSuggestion(request, env); }
    catch (e) { console.error("Event suggestion failed:", e); return json({ error: "The suggestion could not be stored. Please try again later." }, 502); }
  }
  if (url.pathname === "/api/admin/event-suggestions" || url.pathname.startsWith("/api/admin/event-suggestions/")) {
    try { return await handleAdminSuggestions(request, url, env); }
    catch (e) { console.error("Admin suggestion operation failed:", e); return json({ error: "Could not process the review request." }, 502); }
  }
  if (url.pathname === "/api/admin/events") {
    try { return await handleAdminEvents(request, url, env); }
    catch (e) { console.error("Admin event operation failed:", e); return json({ error: "Could not process the event request." }, 502); }
  }
  if (url.pathname === "/api/subscribe" && request.method === "POST") {
    try { return await handleSubscribe(request, env); }
    catch (e) {
      console.error("Newsletter subscription failed:", e);
      return json({ error: "Subscription could not be processed. Please try again later." }, 502);
    }
  }
  if (url.pathname === "/api/confirm" && request.method === "GET") {
    try { return await handleConfirm(url, env); }
    catch (e) { return htmlPage("Confirmation unavailable", "Please contact the site administrator or try again later."); }
  }
  if (url.pathname === "/api/unsubscribe" && request.method === "GET") {
    try { return await handleUnsubscribe(url, env); }
    catch (e) { return htmlPage("Unsubscribe unavailable", "Please try again later."); }
  }
  if (url.pathname === "/api/admin/subscribers" && request.method === "GET") {
    try { return await handleAdminSubscribers(request, url, env); }
    catch (e) {
      console.error("Admin subscriber list failed:", e);
      return json({ error: "Could not load subscribers." }, 502);
    }
  }
  if (url.pathname === "/api/admin/newsletter" && request.method === "POST") {
    try { return await handleNewsletter(request, env); }
    catch (e) { return json({ error: "Newsletter could not be sent." }, 502); }
  }
  return json({ error: "Not found." }, 404, cors(request, env));
}
export default {
  fetch(request, env) {
    return handle(request, env).then(response => {
      const headers = new Headers(response.headers);
      const cross = cors(request, env);
      Object.entries(cross).forEach(([k,v]) => headers.set(k,v));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
  }
};