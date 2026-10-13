import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;
let pool = null;
let schemaPromise = null;
let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;

function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
    });
    pool.on("error", err => console.error("Notification PostgreSQL pool error:", err.message));
  }
  return pool;
}

export function firebaseNotificationsConfigured() {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
        ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
        : "");
    const info = JSON.parse(raw);
    return Boolean(info.project_id && info.client_email && info.private_key);
  } catch {
    return false;
  }
}

async function ensureSchema() {
  const p = db();
  if (!p) return false;
  if (!schemaPromise) {
    schemaPromise = p.query(`
      CREATE TABLE IF NOT EXISTS public.push_devices (
        token text PRIMARY KEY,
        user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
        platform text NOT NULL DEFAULT 'android',
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS push_devices_user_active_idx
        ON public.push_devices(user_id, active);
      CREATE TABLE IF NOT EXISTS public.notification_events (
        event_key text PRIMARY KEY,
        notification_type text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `).catch(err => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
  return true;
}

export async function initNotificationDb() {
  try { return await ensureSchema(); }
  catch (err) {
    console.error("Notification database initialization failed:", err.message);
    return false;
  }
}

export async function registerPushDevice(userId, token, platform = "android") {
  if (!userId) throw new Error("Login required to register notifications.");
  const cleanToken = String(token || "").trim();
  if (cleanToken.length < 40 || cleanToken.length > 4096) throw new Error("Invalid Firebase device token.");
  if (!(await ensureSchema())) throw new Error("Notification database is not configured.");
  await db().query(`
    INSERT INTO public.push_devices(token,user_id,platform,active,last_seen_at,updated_at)
    VALUES($1,$2,$3,true,now(),now())
    ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id,
      platform=EXCLUDED.platform,active=true,last_seen_at=now(),updated_at=now()
  `, [cleanToken, userId, String(platform || "android").slice(0, 30)]);
  return true;
}

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
      ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
      : "");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  const info = JSON.parse(raw);
  if (!info.project_id || !info.client_email || !info.private_key) {
    throw new Error("Firebase service-account configuration is incomplete.");
  }
  return info;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function accessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60000) return cachedAccessToken;
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: account.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = unsigned + "." + signer.sign(String(account.private_key).replace(/\\n/g, "\n")).toString("base64url");
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error("Firebase OAuth token request failed (HTTP " + response.status + ").");
  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

async function sendOne(token, notification) {
  const account = serviceAccount();
  const bearer = await accessToken();
  const payload = {
    message: {
      token,
      notification: { title: notification.title, body: notification.body },
      data: {
        type: String(notification.type || "update"),
        route: String(notification.route || "home"),
        eventKey: String(notification.eventKey || "").slice(0, 200)
      },
      android: {
        priority: "HIGH",
        notification: { channel_id: "omegaplus_updates", sound: "default" }
      }
    }
  };
  const response = await fetch("https://fcm.googleapis.com/v1/projects/" +
    encodeURIComponent(account.project_id) + "/messages:send", {
    method: "POST",
    headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorText = JSON.stringify(body);
    if (response.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(errorText)) {
      await db().query("UPDATE public.push_devices SET active=false,updated_at=now() WHERE token=$1", [token]).catch(() => {});
    }
    throw new Error("Firebase message failed (HTTP " + response.status + ").");
  }
  return body.name || "accepted";
}

async function dispatch({ userId = null, eventKey, type, title, body, route = "home" }) {
  if (!firebaseNotificationsConfigured()) {
    return { sent: 0, configured: false, reason: "Firebase service-account secret is not configured." };
  }
  if (!(await ensureSchema())) return { sent: 0, configured: false, reason: "Notification database is not configured." };
  const result = await db().query(
    userId
      ? "SELECT token FROM public.push_devices WHERE active=true AND user_id=$1"
      : "SELECT token FROM public.push_devices WHERE active=true",
    userId ? [userId] : []
  );
  if (!result.rows.length) return { sent: 0, configured: true, reason: "No registered devices." };

  if (eventKey) {
    const claimed = await db().query(
      "INSERT INTO public.notification_events(event_key,notification_type) VALUES($1,$2) ON CONFLICT(event_key) DO NOTHING RETURNING event_key",
      [String(eventKey).slice(0, 250), String(type || "update").slice(0, 80)]
    );
    if (!claimed.rowCount) return { sent: 0, configured: true, duplicate: true };
  }

  let sent = 0;
  const errors = [];
  for (const row of result.rows) {
    try {
      await sendOne(row.token, { type, title, body, route, eventKey });
      sent++;
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (eventKey && sent === 0 && errors.length) {
    await db().query("DELETE FROM public.notification_events WHERE event_key=$1", [String(eventKey).slice(0, 250)]).catch(() => {});
  }
  return { sent, configured: true, failed: errors.length, error: errors[0] || null };
}

export async function notifyAllOnce(options) {
  try { return await dispatch(options); }
  catch (err) {
    console.error("Broadcast notification failed:", err.message);
    return { sent: 0, configured: firebaseNotificationsConfigured(), error: err.message };
  }
}

export async function notifyUserOnce(userId, options) {
  try { return await dispatch({ ...options, userId }); }
  catch (err) {
    console.error("User notification failed:", err.message);
    return { sent: 0, configured: firebaseNotificationsConfigured(), error: err.message };
  }
}

export async function sendSubscriptionExpiryReminders() {
  if (!(await ensureSchema())) throw new Error("Notification database is not configured.");
  if (!firebaseNotificationsConfigured()) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  const p = db();
  const expiring = await p.query(`
    SELECT s.id, s.user_id, s.expires_at,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (s.expires_at-now()))/86400))::int AS days_left
    FROM public.subscriptions s
    WHERE s.status='active' AND s.expires_at>now() AND s.expires_at<=now()+interval '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.subscriptions newer
        WHERE newer.user_id=s.user_id AND newer.status='active'
          AND (newer.expires_at IS NULL OR newer.expires_at>now())
          AND newer.created_at>s.created_at
      )
  `);
  const expired = await p.query(`
    SELECT s.id, s.user_id, s.expires_at
    FROM public.subscriptions s
    WHERE s.status='active' AND s.expires_at<=now() AND s.expires_at>now()-interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.subscriptions newer
        WHERE newer.user_id=s.user_id AND newer.status='active'
          AND (newer.expires_at IS NULL OR newer.expires_at>now())
          AND newer.created_at>s.created_at
      )
  `);
  let sent = 0;
  for (const row of expiring.rows) {
    const days = Number(row.days_left) || 1;
    const out = await notifyUserOnce(row.user_id, {
      eventKey: "subscription-expiring:" + row.id + ":" + days,
      type: "subscription",
      title: "Your Omegaplus subscription is expiring",
      body: days === 1 ? "Your subscription expires within 24 hours. Renew to keep your paid access." :
        "Your subscription expires in about " + days + " days. Renew to keep your paid access.",
      route: "account"
    });
    sent += out.sent || 0;
  }
  for (const row of expired.rows) {
    const out = await notifyUserOnce(row.user_id, {
      eventKey: "subscription-expired:" + row.id,
      type: "subscription",
      title: "Your Omegaplus subscription has expired",
      body: "Your paid access period has ended. Renew your subscription to restore paid features.",
      route: "account"
    });
    sent += out.sent || 0;
  }
  return { expiringChecked: expiring.rowCount, expiredChecked: expired.rowCount, sent };
}
