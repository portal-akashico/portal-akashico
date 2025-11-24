const express = require("express");
const cors = require("cors");
const path = require("path");

// Cargar .env desde la raíz del proyecto (../.env)
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});

console.log("OPENAI_API_KEY:", !!process.env.OPENAI_API_KEY);
console.log("STRIPE_SECRET_KEY:", process.env.STRIPE_SECRET_KEY);
console.log("STRIPE_PRICE_ID:", process.env.STRIPE_PRICE_ID);

// --- Stripe ---
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// --- OpenAI ---
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Resend ---
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Guardamos en memoria los datos del formulario ligados a la sesión de Stripe
// (esto es suficiente para tu proyecto actual; si reinicias el server se pierden, lo cual está ok en dev)
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
    enfoque: "lectura general desde los Registros Akáshicos.",
  },
  vidas: {
    titulo: "Lectura de Vidas Pasadas — Memorias del Alma",
    subject: "Tu Lectura de Vidas Pasadas ✨",
    enfoque: "memorias antiguas y patrones que siguen activos.",
  },
  futuro: {
    titulo: "Lectura de Camino Futuro — Potenciales y Caminos",
    subject: "Tu Lectura de Camino Futuro ✨",
    enfoque: "potenciales futuros según la energía actual.",
  },
  alma: {
    titulo: "Lectura de Alma Gemela & Vínculos del Alma",
    subject: "Tu Lectura de Alma Gemela ✨",
    enfoque: "vínculos profundos, patrones afectivos y conexiones.",
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

// 1) Prompts distintos según el tipo de lectura
const systemPrompts = {
  aakashica: `
Eres una sacerdotisa akáshica.

Tu prioridad es hablar DIRECTO al momento actual de la persona:
- Empieza siempre haciendo referencia a lo que contó (trabajo, emociones, dudas).
- No empieces con frases genéricas sobre "el alma" o "el Akasha" sin mencionarla a ella.

Estilo:
- Cálido, profundo y honesto.
- Poético, pero sin exceso. Prefiere frases claras antes que puro adorno.

Reglas:
- Evita repetir siempre las mismas metáforas como "umbral", "semilla", "terreno fértil", "viajero eterno".
- No uses plantillas fijas ni la misma estructura en todas las lecturas.
- Las recomendaciones pueden ir en lista o en párrafos, pero no siempre como 1, 2, 3, 4.

Objetivo:
- Ayudarle a entender su momento presente y el patrón principal que se está moviendo en su vida,
  usando lo que ella escribió como base de TODO.
`,
 vidas: `
Eres una lectora de vidas pasadas.

Tu enfoque:
- Explicar cómo la sensación de "no pertenezco a este tiempo" o "siento que ya viví esto" puede
  relacionarse con patrones de otras encarnaciones.
- Usar símbolos e imágenes (culturas antiguas, roles, arquetipos), pero sin inventar datos concretos
  como fechas, nombres, países específicos.

Estilo:
- Evocador y sensible.
- Más centrado en describir PATRONES que en contar una historia de novela.

Reglas:
- No repitas siempre palabras como "viajero eterno", "umbral", "semilla", "terreno fértil".
- No copies estructuras de otras lecturas.
- Las recomendaciones pueden ser 2–3 sugerencias prácticas, escritas como parte del texto
  o en una lista breve, pero sin que siempre sean 4 puntos numerados.

Objetivo:
- Que la persona entienda qué patrón de esta vida podría tener raíz en otras,
  y cómo integrarlo o sanarlo hoy.
`,
  futuro: `
Eres una guía intuitiva de caminos futuros.

Tu misión:
- Ayudar a la persona a ver opciones, decisiones y posibles direcciones según lo que vive ahora.
- Ser más claro y práctico que una lectura akáshica general.

Estilo:
- Directo, concreto, sin tanto adorno.
- Menos místico, más enfocado en decisiones, pasos y escenarios posibles.

Reglas:
- No uses metáforas repetidas como "umbral", "semillas", "terreno fértil" en todas las lecturas.
- No des predicciones exactas ni cosas tipo "esto seguro pasará".
- Propón entre 2 y 4 sugerencias prácticas sobre cómo avanzar, pero puedes integrarlas en
  párrafos, no siempre como lista numerada.

Objetivo:
- Que la persona salga con más claridad sobre qué puede hacer, qué caminos tiene
  y qué actitudes internas le ayudan a tomar mejores decisiones.
`,
  alma: `
Eres una guía de vínculos del alma y relaciones profundas.

Tu misión:
- Ayudar a la persona a comprender la dinámica emocional, energética y espiritual del vínculo
  que está viviendo o que le intriga.
- Explicar patrones afectivos (apego, miedo, entrega, huida, intensidad, espejos del alma, etc.)
  usando lo que la persona escribió como base central.

Estilo:
- Íntimo, cálido, emocional y claro.
- Más humano que místico: enfocado en emociones reales, heridas, necesidades, deseos.
- Poético, pero sin exageración. Habla con cercanía.

Reglas:
- NO uses las metáforas repetidas de otras lecturas: nada de "umbral", "semillas",
  "terreno fértil", "viajero eterno".
- No copies estructura de otros motores.
- No des predicciones absolutas ni cosas como “esta persona es tu alma gemela garantizada”.
- Empieza SIEMPRE mencionando lo que la persona contó sobre su relación o patrón.
- Las recomendaciones deben sentirse íntimas y emocionales, no genéricas.
- Puedes darlas en párrafos o en lista, pero no siempre con números.

Objetivo:
- Mostrar con claridad cuál es el patrón afectivo que la persona está viviendo.
- Explicar qué le está intentando enseñar ese vínculo o dinámica.
- Sugerir caminos de sanación emocional, autocuidado y claridad afectiva.
`,
};

// 2) Elegir el prompt correcto según cfg.enfoque
const enfoque = cfg?.enfoque || "akashica";
// si el enfoque no existe en systemPrompts, usa akashica por defecto
const systemContent = systemPrompts[enfoque] || systemPrompts["akashica"];

// 3) Llamada a OpenAI
const completion = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  temperature: 0.9,
  max_tokens: 2000,
  messages: [
    {
      role: "system",
      content: systemContent,
    },
    {
      role: "user",
      content: `
Genera una lectura para ${name}.

Contexto que la persona escribió en el formulario (úsalo como base de TODO):
${contexto}

Instrucciones:
- Extensión aproximada: 700–1000 palabras.
- Habla en segunda persona ("tú").
- No sigas una estructura rígida.
- Da entre 2 y 4 recomendaciones prácticas al final, integradas de forma natural en el texto.
      `.trim(),
    },
  ],
});

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
      from: process.env.EMAIL_FROM, // "Portal Akáshico ✨ <portal@resend.dev>"
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
//   RUTA ORIGINAL /api/lectura (sigue
//   funcionando por si la usas directo)
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
//   1) CREAR SESIÓN DE CHECKOUT STRIPE
//      (la llama tu index.html)
// =========================================
app.post("/api/create-checkout-session", async (req, res) => {
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
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      customer_email: email,
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/`,
      metadata: {
        tipoLectura,
        name,
        email,
        birthdate,
      },
    });

    // Guardamos TODOS los datos del formulario ligados a la sesión
    sessionStore[session.id] = {
      tipoLectura,
      name,
      email,
      birthdate,
      estadoActual,
      personalidad,
      objetivo,
      pregunta,
    };

    console.log("✅ Sesión de Stripe creada:", session.id);

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Error al crear sesión de Stripe:", err);
    res.status(500).json({
      error: "No se pudo crear la sesión de pago.",
    });
  }
});

// =========================================
//   2) FINALIZAR LECTURA TRAS PAGO
//      (la llama success.html con session_id)
// =========================================
app.post("/api/finalizar-lectura", async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return res
      .status(400)
      .json({ error: "Falta el session_id de Stripe." });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res
        .status(400)
        .json({ error: "El pago aún no está completado." });
    }

    const datos = sessionStore[session_id];
    if (!datos) {
      return res.status(400).json({
        error:
          "No se encontraron los datos de la lectura para esta sesión. Si ya pagaste, contáctame por correo.",
      });
    }

    const resultado = await generarYEnviarLectura(datos);

    // ya no necesitamos conservar los datos en memoria
    delete sessionStore[session_id];

    res.json(resultado);
  } catch (err) {
    console.error("❌ Error en /api/finalizar-lectura:", err);
    res.status(500).json({
      error: "No se pudo finalizar la lectura tras el pago.",
    });
  }
});

// =========================================
//             INICIAR SERVIDOR
// =========================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en ${BASE_URL}`);
});
