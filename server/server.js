const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

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

// --- Nodemailer ---
const nodemailer = require("nodemailer");

// Transporter con Gmail + contraseña de aplicación
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // smtp.gmail.com
  port: Number(process.env.SMTP_PORT), // 465
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verificación opcional
transporter.verify((err) => {
  if (err) {
    console.error("❌ Error al conectar con SMTP:", err);
  } else {
    console.log("✅ SMTP LISTO para enviar correos");
  }
});

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
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.9,
    max_tokens: 2000,
    messages: [
      {
        role: "system",
        content: `
Eres una sacerdotisa Akáshica ancestral. Hablas suave, poético, profundo y amoroso.
Nunca usas fatalismo ni predicciones absolutas.
Guías al alma con claridad y contención.

Enfoque especial: ${cfg.enfoque}

Estructura:
1) Apertura suave
2) Cuerpo profundo (momento actual, patrones, guía)
3) Cierre con esperanza + 2/3 recomendaciones prácticas.
        `,
      },
      {
        role: "user",
        content: `
Genera la lectura completa para ${name}:

${contexto}

Extensión: 700–1000 palabras.
Escribe en segunda persona ("tú").
        `.trim(),
      },
    ],
  });

  const lectura = (completion.choices[0]?.message?.content || "").trim();

  // ===== ENVIAR EMAIL =====
  const lecturaHTML = lectura
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: email,
    subject: cfg.subject,
    html: `
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
    `,
  };

  let emailEnviado = false;
  try {
    await transporter.sendMail(mailOptions);
    emailEnviado = true;
    console.log(`📨 Lectura enviada a ${email}`);
  } catch (err) {
    console.error("❌ Error al enviar correo:", err);
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
