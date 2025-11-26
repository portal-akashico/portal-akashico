const express = require("express");
const cors = require("cors");
const path = require("path");
const fetch = require("node-fetch"); // npm i node-fetch@2

// Cargar .env desde la raíz del proyecto (../.env)
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});

console.log("OPENAI_API_KEY:", !!process.env.OPENAI_API_KEY);
console.log("PAYPAL_CLIENT_ID:", !!process.env.PAYPAL_CLIENT_ID);
console.log("PAYPAL_MODE:", process.env.PAYPAL_MODE);

// --- OpenAI ---
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Resend ---
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// --- PayPal config ---
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE || "sandbox";

const PAYPAL_BASE_URL =
  PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    console.error("❌ Error obteniendo token de PayPal:", await res.text());
    throw new Error("No se pudo obtener token de PayPal");
  }

  const data = await res.json();
  return data.access_token;
}

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Guardamos en memoria los datos del formulario ligados a la ORDEN de PayPal
const sessionStore = {};

// Middlewares
app.use(cors());
app.use(express.json());

// STATIC
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/ping", (req, res) => {
  res.json({ message: "Portal Akáshico online 🌌" });
});

// Config por tipo
const TIPOS_LECTURA = {
  akashica: {
    titulo: "Lectura Akáshica — Canalizada",
    subject: "Tu Lectura Akáshica ✨",
    enfoque: "akashica",
  },
  vidas: {
    titulo: "Lectura de Vidas Pasadas — Memorias del Alma",
    subject: "Tu Lectura de Vidas Pasadas ✨",
    enfoque: "vidas",
  },
  futuro: {
    titulo: "Lectura de Camino Futuro — Potenciales y Caminos",
    subject: "Tu Lectura de Camino Futuro ✨",
    enfoque: "futuro",
  },
  alma: {
    titulo: "Lectura de Alma Gemela & Vínculos del Alma",
    subject: "Tu Lectura de Alma Gemela ✨",
    enfoque: "alma",
  },
};

// =========================================
//   FUNCIÓN REUTILIZABLE PARA GENERAR
//   LA LECTURA + ENVIARLA POR CORREO
// =========================================
async function generarYEnviarLectura(payload) {
  const {
    tipoLectura = "akashica",
    name,
    email,
    birthdate,
    estadoActual,
    personalidad,
    objetivo,
    pregunta,
  } = payload;

  if (!name || !birthdate || !email) {
    throw new Error("Faltan datos básicos (nombre, fecha, correo).");
  }

  const cfg = TIPOS_LECTURA[tipoLectura] || TIPOS_LECTURA.akashica;

  const contexto = `
Datos del consultante:
- Nombre: ${name}
- Fecha de nacimiento: ${birthdate}
- Correo: ${email}
- Tipo de lectura: ${cfg.titulo}
- Momento actual: ${estadoActual || "no especificado"}
- Personalidad: ${personalidad || "no especificada"}
- Objetivo: ${objetivo || "no especificado"}
- Pregunta central: ${pregunta || "no especificada"}
`;

  // ===== OPENAI =====

  // 1) Prompts para cada tipo de lectura
  const systemPrompts = {
    akashica: `
Eres una sacerdotisa akáshica.

Tu prioridad es hablar DIRECTO al momento actual de la persona:
- Empieza mencionando lo que contó (trabajo, emociones, cansancio, dudas).
- No comiences con frases genéricas sobre "el alma" o "el Akasha" sin nombrar su situación.

Estilo:
- Cálido, profundo y claro.
- Poético, pero sin exceso. Prefiere claridad antes que adornos.
- Sonido íntimo, como una guía cercana, no distante.

Reglas:
- Evita repetir siempre las mismas metáforas: no uses "umbral", "semilla", "terreno fértil",
  "viajero eterno", "pausa sagrada" ni "vacío sagrado".
- No uses la misma estructura de introducción y cierre en todas las lecturas.
- Las recomendaciones pueden ir en párrafos o en lista, pero no siempre con 1, 2, 3, 4.
- No inventes hechos concretos (fechas, lugares, nombres); interpreta emociones y patrones.

Objetivo:
- Ayudarle a comprender qué está viviendo AHORA, qué patrón se está moviendo
  y qué está intentando mostrarle su alma a través de esta etapa.
`,

    vidas: `
Eres una lectora de vidas pasadas.

Enfoque:
- Explicar cómo sensaciones como "no pertenezco a este tiempo", "esto ya lo viví",
  o miedos/afinidades extrañas pueden estar conectadas con otras encarnaciones.
- Trabajar con símbolos y arquetipos (roles, dinámicas, tipos de lugares),
  sin inventar datos históricos exactos (no des nombres de países, fechas ni personas específicas).

Estilo:
- Evocador y sensible.
- Más centrado en PATRONES que en contar una novela detallada.
- Usa imágenes simples y comprensibles, no discursos demasiado recargados.

Reglas:
- No repitas frases o metáforas que puedan sonar a plantilla: evita "umbral", "semilla",
  "terreno fértil", "viajero eterno", "pausa sagrada", "void", "portal".
- No copies la forma de inicio o cierre de las otras lecturas.
- No afirmes cosas absolutas del tipo "en tal año fuiste X"; mantén el lenguaje como
  posibilidad intuitiva y simbólica.
- Ofrece 2–3 sugerencias prácticas para integrar esas memorias (meditación, escritura,
  rituales sencillos, etc.), en forma de texto fluido o pequeña lista.

Objetivo:
- Que la persona entienda qué patrón de esta vida podría tener raíz en otras,
  y cómo puede integrarlo o sanarlo HOY, sin quedarse atrapada solo en la curiosidad.
`,

    futuro: `
Eres una guía intuitiva de caminos futuros y toma de decisiones.

Enfoque:
- Ayudar a la persona a ver opciones, direcciones y escenarios posibles
  según lo que vive ahora (no a adivinar el futuro).
- Responder de forma clara a la duda central sobre el futuro (trabajo, dinero,
  relaciones, mudanza, etc.).

Estilo:
- Directo, práctico y honesto.
- Menos místico que una lectura akáshica general.
- Usa ejemplos concretos, posibles caminos y sugerencias claras.

Reglas:
- No des predicciones absolutas ("esto pasará sí o sí en tal fecha").
- Evita metáforas recicladas como "umbral", "semilla", "terreno fértil",
  "viajero eterno", "pausa sagrada", "vacío sagrado".
- No copies la misma estructura de las otras lecturas.
- Da entre 2 y 4 recomendaciones prácticas sobre cómo avanzar
  (decisiones, actitudes internas, pasos concretos), integradas en el texto o en
  una lista breve.

Objetivo:
- Que la persona salga con más CLARIDAD sobre:
  - qué opciones tiene,
  - qué necesita ajustar en su actitud o energía,
  - y qué movimientos pueden ayudarle a crear un futuro más alineado.
`,

    alma: `
Eres una guía de vínculos del alma y relaciones profundas.

Enfoque:
- Ayudar a la persona a comprender la dinámica emocional, energética y espiritual
  de un vínculo importante (pareja, relación intensa, persona que no puede soltar,
  patrones que se repiten en el amor, etc.).
- Leer patrones afectivos: apego, evitación, idealización, miedo a la intimidad,
  dependencia, almas espejo, etc.

Estilo:
- Íntimo, cálido, empático.
- Más humano que místico: habla de emociones reales, heridas, necesidades y límites.
- Poético con moderación; que se entienda fácil.

Reglas:
- No prometas destinos: no digas que "esta persona es tu alma gemela garantizada"
  ni que "están destinados para siempre".
- Evita metáforas y frases típicas de otros textos: no uses "umbral", "semilla",
  "terreno fértil", "viajero eterno", "pausa sagrada", "vacío sagrado".
- Empieza SIEMPRE mencionando algo de lo que la persona contó sobre su relación o patrón.
- Las recomendaciones deben sentirse personales y emocionales (autocuidado,
  límites, comunicación, sanación), no genéricas.
- Puedes darlas en párrafos o en lista corta, pero sin depender siempre de
  la misma estructura numerada.

Objetivo:
- Mostrar con claridad qué está pasando a nivel del alma en ese vínculo o patrón,
  qué está intentando enseñarle y cómo puede cuidarse mejor a sí misma en el amor.
`,
  };

  // 2) Determinar el enfoque de forma segura
  const enfoqueBruto = cfg && cfg.enfoque;
  let enfoque = "akashica";

  if (
    typeof enfoqueBruto === "string" &&
    ["akashica", "vidas", "futuro", "alma"].includes(enfoqueBruto)
  ) {
    enfoque = enfoqueBruto;
  }

  const systemContent = systemPrompts[enfoque];

  console.log("Enfoque recibido:", enfoqueBruto, "→ Enfoque usado:", enfoque);

  // 3) Llamada a OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.9,
    max_tokens: 2000,
    messages: [
      {
        role: "system",
        content:
          systemContent ||
          "Eres una sacerdotisa akáshica. Da una lectura amorosa, clara y personalizada basada en el contexto del usuario.",
      },
      {
        role: "user",
        content: `
Genera una lectura para ${name}.

Contexto que la persona escribió en el formulario (úsalo como base de TODO):
${contexto}

Instrucciones generales:
- Extensión aproximada: 700–1000 palabras.
- Habla en segunda persona ("tú").
- No sigas una estructura rígida ni repitas siempre el mismo tipo de inicio o cierre.
- Da entre 2 y 4 recomendaciones prácticas al final, integradas de manera natural en el texto
  (pueden ir en lista o en párrafos).
      `.trim(),
      },
    ],
  });

  // 4) Texto final de la lectura
  const lectura = (completion.choices[0]?.message?.content || "").trim();

  // ===== HTML PARA EL CORREO =====
  const lecturaHTML = lectura
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  const html = `
<div style="background:#050512;padding:24px;color:#f4ecff;font-family:Arial,sans-serif;">
  <div style="max-width:720px;margin:0 auto;background:#11111f;padding:24px;border-radius:16px;border:1px solid #6d34ff;">
    <h2 style="text-align:center;color:#e9d6ff;margin-top:0;">${cfg.titulo}</h2>
    <p style="text-align:center;color:#c9b8ff;">Tu lectura ha sido canalizada con amor.</p>
    <div style="line-height:1.7;font-size:14px;">${lecturaHTML}</div>
  </div>
  <p style="margin-top:20px;text-align:center;font-size:12px;color:#aaa;">
    Portal Akáshico ✨
  </p>
</div>
`;

  // ===== ENVIAR EMAIL CON RESEND =====
  let emailEnviado = false;
  try {
    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: cfg.subject,
      html,
    });

    console.log("📨 Lectura enviada a", email, "Respuesta Resend:", data);
    emailEnviado = true;
  } catch (err) {
    console.error("❌ Error al enviar correo con Resend:", err);
  }

  return {
    tipoLectura,
    titulo: cfg.titulo,
    lectura,
    emailEnviado,
  };
}

// =========================================
//   RUTA ORIGINAL /api/lectura
//   (sigue disponible si la quieres usar)
// =========================================
app.post("/api/lectura", async (req, res) => {
  try {
    const resultado = await generarYEnviarLectura(req.body);
    res.json(resultado);
  } catch (err) {
    console.error("❌ Error en /api/lectura:", err);
    res.status(400).json({
      error: err.message || "Error al generar la lectura.",
    });
  }
});

// =========================================
//   1) CREAR ORDEN DE PAYPAL
//      (la llama tu formulario inicial)
// =========================================
app.post("/api/paypal/create-order", async (req, res) => {
  const {
    tipoLectura = "akashica",
    name,
    email,
    birthdate,
    estadoActual,
    personalidad,
    objetivo,
    pregunta,
  } = req.body;

  if (!name || !birthdate || !email) {
    return res.status(400).json({
      error: "Faltan datos básicos (nombre, fecha, correo).",
    });
  }

  try {
    const accessToken = await getPayPalAccessToken();

    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "MXN",
            value: "149.00", // 💸 tu precio aquí
          },
        },
      ],
      application_context: {
        brand_name: "Portal Akáshico",
        landing_page: "LOGIN",
        user_action: "PAY_NOW",
       return_url: `${BASE_URL}/success.html`,
        cancel_url: `${BASE_URL}/`,
      },
    };

    const orderRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!orderRes.ok) {
      console.error("❌ Error creando orden PayPal:", await orderRes.text());
      return res.status(500).json({ error: "No se pudo crear la orden" });
    }

    const orderData = await orderRes.json();

    const approveLink = orderData.links.find((l) => l.rel === "approve");

    if (!approveLink) {
      return res
        .status(500)
        .json({ error: "No se encontró link de aprobación" });
    }

    // Guardamos TODOS los datos del formulario ligados a la orden de PayPal
    sessionStore[orderData.id] = {
      tipoLectura,
      name,
      email,
      birthdate,
      estadoActual,
      personalidad,
      objetivo,
      pregunta,
    };

    console.log("✅ Orden de PayPal creada:", orderData.id);

    // Regresamos la URL para redirigir al usuario a PayPal
    res.json({
      orderId: orderData.id,
      approveUrl: approveLink.href,
    });
  } catch (err) {
    console.error("❌ Error en /api/paypal/create-order:", err);
    res.status(500).json({ error: "Error interno al crear orden" });
  }
});

// =========================================
//   2) CAPTURAR ORDEN + GENERAR LECTURA
//      (la llama pago-completado.html)
// =========================================
app.post("/api/paypal/capture-order", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Falta orderId" });
    }

    const accessToken = await getPayPalAccessToken();

    const captureRes = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!captureRes.ok) {
      console.error("❌ Error capturando orden PayPal:", await captureRes.text());
      return res
        .status(500)
        .json({ error: "No se pudo capturar la orden en PayPal" });
    }

    const captureData = await captureRes.json();

    const status = captureData.status;
    console.log("Orden capturada:", orderId, "status:", status);

    if (status !== "COMPLETED") {
      return res.json({ status });
    }

    const datos = sessionStore[orderId];
    if (!datos) {
      return res.status(400).json({
        status: "COMPLETED",
        error:
          "El pago se completó, pero no se encontraron los datos de la lectura. Escríbeme por correo con tu comprobante.",
      });
    }

    const resultado = await generarYEnviarLectura(datos);

    // ya no necesitamos conservar los datos en memoria
    delete sessionStore[orderId];

    return res.json({
      status: "COMPLETED",
      resultado,
    });
  } catch (err) {
    console.error("❌ Error en /api/paypal/capture-order:", err);
    res.status(500).json({ error: "Error interno al capturar orden" });
  }
});

// =========================================
//             INICIAR SERVIDOR
// =========================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en ${BASE_URL}`);
});
