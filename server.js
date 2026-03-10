import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import { connectMongo } from "./db/mongo.js";
import {
  clients,
  getOrCreateClient,
  getClient,
  logoutClient,
  MessageMedia, // 👈 IMPORTANTE
} from "./sessions/sessionManager.js";
import {
  registerAccount,
  getAccount,
  sendTemplateWithButtons,
} from "./services/whatsappApi.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// Mongo
connectMongo()
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(console.error);

// API: Crear sesión (o reutilizar si existe)
app.post("/api/session", (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "Falta clientId" });
  getOrCreateClient({ clientId, io }).catch(err => console.error("Error background creation:", err));
  res.json({ status: "pending", clientId });
});

// API: Enviar mensaje (texto y/o imagen)
app.post("/api/send", async (req, res) => {
  const { clientId, phone, message, image } = req.body;
  // phone y clientId deben existir, y debe haber mensaje o imagen
  if (!clientId || !phone || (!message && !image)) {
    return res
      .status(400)
      .json({ error: "Faltan datos: mínimo mensaje o imagen" });
  }
  const client = getClient(clientId);
  if (!client) return res.status(404).json({ error: "Sesión no encontrada" });

  try {
    // Siempre convierte phone a string y quita espacios
    const phoneStr = String(phone).replace(/\s/g, "");
    const chatId = phoneStr.endsWith("@c.us") ? phoneStr : `${phoneStr}@c.us`;

    if (image) {
      let media;
      if (image.startsWith("http")) {
        // URL de imagen
        media = await MessageMedia.fromUrl(image);
      } else if (image.startsWith("data:")) {
        // DataURL base64 (data:image/png;base64,....)
        const matches = image.match(/^data:(.+);base64,(.+)$/);
        if (!matches) throw new Error("Imagen base64 inválida");
        media = new MessageMedia(matches[1], matches[2]);
      } else {
        // Base64 simple, asume PNG
        media = new MessageMedia("image/png", image);
      }
      const sendResult = await client.sendMessage(chatId, media, {
        caption: message || undefined,
      });
      res.json({ status: "sent", id: sendResult.id._serialized });
    } else {
      // Solo texto
      const sendResult = await client.sendMessage(chatId, message);
      res.json({ status: "sent", id: sendResult.id._serialized });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/send-meeting-request", async (req, res) => {
  const { 
    accountId, 
    to, 
    eventName = "",
    requesterName = "",
    requesterCompany = "",
    requesterPosition = "",
    requesterEmail = "",
    requesterPhone = "",
    message = "",
    acceptUrl,          // ← URL completa o solo el sufijo dinámico?
    cancelUrl           // ← URL completa o solo el sufijo dinámico?
  } = req.body;

  // Validación básica mejorada
  const required = [accountId, to, eventName, requesterName, requesterCompany, 
                    requesterPosition, requesterEmail, requesterPhone, message, 
                    acceptUrl, cancelUrl];

  if (required.some(val => !val)) {
    return res.status(400).json({ 
      error: "Faltan datos requeridos",
      example: "Todos los campos son obligatorios"
    });
  }

  const account = getAccount(accountId);
  if (!account) {
    return res.status(404).json({ error: `Cuenta ${accountId} no encontrada` });
  }

  try {
    const cleanPhone = String(to)
      .replace(/[^0-9]/g, '')     // solo dígitos
      .replace(/^0+/, '');        // quita ceros iniciales si existen

    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    // 1. Parámetros del BODY (en orden exacto del template)
    const bodyParams = [
      { type: "text", text: String(eventName).trim() },           // {{1}}
      { type: "text", text: String(requesterName).trim() },       // {{2}}
      { type: "text", text: String(requesterCompany).trim() },    // {{3}}
      { type: "text", text: String(requesterPosition).trim() },   // {{4}}
      { type: "text", text: String(requesterEmail).trim() },      // {{5}}
      { type: "text", text: String(requesterPhone).trim() },      // {{6}}
      { type: "text", text: String(message).trim() }              // {{7}}
    ];

    console.log("Body parameters:", bodyParams.map(p => p.text));

    // 2. Parámetros para BOTONES URL DINÁMICOS
    // IMPORTANTE: Aquí envías SOLO EL SUFIJO dinámico, NO la URL completa
    // Ejemplo: si el botón aprobado es https://ej.com/accept/{{1}} → envía "xyz123"
    // Decide cómo extraer el sufijo (puedes cambiar esta lógica)
 
    const buttonParams = [
      // Botón 0 - Aceptar
      {
        type: "button",
        sub_type: "URL",           // o "URL" según la versión de API (prueba ambas)
        index: "0",
        parameters: [
          { type: "text", text: acceptUrl.trim() }
        ]
      },
      // Botón 1 - Cancelar
      {
        type: "button",
        sub_type: "URL",
        index: "1",
        parameters: [
          { type: "text", text: cancelUrl.trim() }
        ]
      }
    ];

    console.log("Button components:", buttonParams);

    // 3. Construye el payload completo (ejemplo para Cloud API)
    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "template",
      template: {
        name: "solicitud_reunion",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: bodyParams
          },
         ...buttonParams
        ]
      }
    };

 

    // Aquí llamas a tu función que hace el POST real a https://graph.facebook.com/v19.0/.../messages
    // (ajusta según tu librería o implementación)
    const result = await sendTemplateWithButtons(
      accountId,
      payload   // ← ahora pasamos el payload completo en lugar de argumentos separados
    );

    res.json({
      status: "sent",
      phone: cleanPhone,
      messageId: result?.messages?.[0]?.id,
      result
    });

  } catch (error) {
    console.error("Error enviando template:", error?.response?.data || error);

    const errData = error?.response?.data || {};
    res.status(500).json({ 
      error: "Error al enviar el mensaje",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData
    });
  }
});

app.post("/api/account/register", (req, res) => {
  const { accountId, phoneNumberId, accessToken } = req.body;
  
  if (!accountId || !phoneNumberId || !accessToken) {
    return res.status(400).json({ 
      error: "Faltan datos: accountId, phoneNumberId, accessToken" 
    });
  }

  try {
    registerAccount(accountId, phoneNumberId, accessToken);
    res.json({ 
      status: "registered", 
      accountId,
      message: "Cuenta registrada exitosamente"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Cerrar sesión y borrar auth
app.post("/api/logout", (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "Falta clientId" });
  logoutClient(clientId, io);
  res.json({ status: "logout", clientId });
});

// API: Listar sesiones activas
app.get("/api/sessions", (req, res) => {
  const list = Object.keys(clients).map((clientId) => {
    const client = clients[clientId];
    let status = "pending";
    if (client.info && client.info.me) status = "ready";
    else if (client.info && client.info.pushname) status = "authenticated";
    return { clientId, status };
  });
  res.json(list);
});

// Websockets
io.on("connection", (socket) => {
  socket.on("join", ({ clientId }) => {
    if (!clientId) return;
    socket.join(clientId);
    const client = getClient(clientId);
    if (client && client.info && client.info.me) {
      socket.emit("status", { status: "ready" });
    }
  });

  socket.on("disconnect", () => {
    // Opcional: cleanup
  });
});

const PORT = process.env.PORT || 3000;
// Global Error Handlers for debugging
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err);
  // Keep process alive if possible or let it crash logging
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Backend multi-sesión listo en http://localhost:${PORT}`);
});


