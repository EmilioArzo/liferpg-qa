// authHelper.js — Inicio de sesión para pruebas automáticas contra la API de Life-RPG.
//
// Dos modos (variable de entorno TEST_MODE):
//   - "render" (por defecto): backend en la nube. Inicia sesión con Firebase y manda
//     "Authorization: Bearer <idToken>". El token dura 1 hora; este archivo lo renueva solo.
//   - "local": backend en tu compu (modo desarrollo). Manda "x-user-id: u-1", como antes.
//
// Variables de entorno:
//   TEST_MODE        render | local                       (por defecto: render)
//   API_URL          URL base de la API                   (por defecto según el modo)
//   TEST_EMAIL       correo de la cuenta de prueba        (solo modo render)
//   TEST_PASSWORD    contraseña de la cuenta de prueba    (solo modo render)
//   FIREBASE_API_KEY Web API key de Firebase              (ya viene la del proyecto)
//
// El correo y la contraseña NUNCA van en el código ni en el repo: ponlos en variables de
// entorno o en un .env que esté en .gitignore.
//
// Requiere Node 18 o más nuevo (usa fetch). Uso con node:test, Jest o Vitest:
//
//   const { api, warmUp } = require("./authHelper");
//
//   before(async () => { await warmUp(); });           // en Jest/Vitest: beforeAll
//
//   test("la tienda responde", async () => {
//     const res = await api("/tienda/articulos");
//     assert.equal(res.status, 200);
//     const items = await res.json();
//   });
//
//   await api("/tienda/compras", { method: "POST", body: { itemId: "..." } });
//
// Si tus pruebas usan "import" (ESM): import auth from "./authHelper.js"; const { api } = auth;

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyBP1u_iEh92ylsM86dosNIUltDHpVivC7Y";
const MODE = (process.env.TEST_MODE || "render").toLowerCase();
const API_URL = (
  process.env.API_URL ||
  (MODE === "local" ? "http://localhost:3000/api/v1" : "https://liferpg-backend-56d5.onrender.com/api/v1")
).replace(/\/+$/, "");

// Margen para renovar el token antes de que venza
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let session = null; // { idToken, refreshToken, expiresAt }

async function postJson(url, body, { form = false } = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error?.message || res.status;
    throw new Error(`Firebase respondió ${code}. Revisa TEST_EMAIL, TEST_PASSWORD y FIREBASE_API_KEY.`);
  }
  return data;
}

// Inicia sesión con correo y contraseña
async function login() {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("Faltan TEST_EMAIL y TEST_PASSWORD (la cuenta de prueba de Firebase).");
  }
  const data = await postJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    { email, password, returnSecureToken: true },
  );
  session = {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
  };
  return session.idToken;
}

// Renueva el token con el refreshToken (sin volver a mandar la contraseña)
async function refresh() {
  const data = await postJson(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    { grant_type: "refresh_token", refresh_token: session.refreshToken },
    { form: true },
  );
  session = {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
  };
  return session.idToken;
}

// Token vigente: inicia sesión la primera vez y lo renueva cuando está por vencer
async function getToken() {
  if (!session) return login();
  if (Date.now() < session.expiresAt - REFRESH_MARGIN_MS) return session.idToken;
  try {
    return await refresh();
  } catch {
    return login();
  }
}

// Encabezados de identidad según el modo
async function authHeaders() {
  if (MODE === "local") return { "x-user-id": "u-1" };
  return { Authorization: `Bearer ${await getToken()}` };
}

// fetch a la API con la sesión ya puesta. `body` puede ser un objeto (se manda como JSON).
async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${API_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(await authHeaders()),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}

// Despierta el backend (Render lo apaga si nadie lo usa; la primera vez tarda ~40 s)
// y, en modo render, inicia sesión de una vez para que la primera prueba no se alargue.
async function warmUp({ timeoutMs = 90_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/estado`, { signal: controller.signal });
    if (!res.ok) throw new Error(`El backend respondió ${res.status} en /estado.`);
  } finally {
    clearTimeout(timer);
  }
  if (MODE !== "local") await getToken();
}

module.exports = { api, authHeaders, getToken, warmUp, API_URL, MODE };