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
  sendTextMessage,
  sendTemplateWithParams,
  sendTemplateWithButtons,
  uploadMedia
} from "./services/whatsappApi.js";
import {
  tryEmailFallback,
  registerFallbackForMessage,
  triggerFallbackFromWebhook
} from "./services/emailFallback.js";
import { processIncomingMessage } from "./services/webhookHandler.js";
import { belongsToSecondaryNumber, forwardToSecondaryWebhook } from "./services/webhookRouter.js";
import { processSurveyButtonReply, buildSurveyPayload } from "./services/surveyHandler.js";

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

app.get("/webhook", (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'mi_token_secreto';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.field !== 'messages') continue;

          // Ambos números comparten la misma cuenta de WhatsApp Business, por lo que
          // Meta llama a esta misma URL para los dos. Si el evento pertenece al número
          // secundario, se reenvía a su propio backend en vez de procesarlo aquí.
          const phoneNumberId = change.value?.metadata?.phone_number_id;
          if (belongsToSecondaryNumber(phoneNumberId)) {
            await forwardToSecondaryWebhook(entry, change);
            continue;
          }

          const messages = change.value.messages;
          const statuses = change.value.statuses;

          if (messages) {
            for (const message of messages) {
              if (message.type === 'text') {
                await processIncomingMessage({
                  from: message.from,
                  text: message.text,
                  timestamp: message.timestamp
                });
              } else if (message.type === 'button') {
                // Respuesta a un botón quick reply de plantilla (ej. encuesta de valor de negocio)
                await processSurveyButtonReply({
                  from: message.from,
                  payload: message.button?.payload,
                  buttonText: message.button?.text,
                  wamid: message.id,
                  timestamp: message.timestamp
                });
              }
            }
          }

          if (statuses) {
            for (const status of statuses) {
              if (status.status === 'failed') {
                console.log(`⚠️ Webhook reporta fallo de entrega en Meta. ID: ${status.id}`);
                await triggerFallbackFromWebhook(status.id);
              }
            }
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error procesando webhook:', error);
    res.sendStatus(500);
  }
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
    const fallbackSent = await tryEmailFallback(req.body);
    res.status(500).json({ error: err.message, fallbackEmailSent: fallbackSent });
  }
});

app.post("/api/send-meeting-request", async (req, res) => {
  const {
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
  const required = [to, eventName, requesterName, requesterCompany,
                    requesterPosition, requesterEmail, requesterPhone, message,
                    acceptUrl, cancelUrl];

  if (required.some(val => !val)) {
    return res.status(400).json({
      error: "Faltan datos requeridos",
      example: "Todos los campos son obligatorios"
    });
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
    const result = await sendTemplateWithButtons(payload);

    const msgId = result?.messages?.[0]?.id;
    if (msgId) registerFallbackForMessage(msgId, req.body);

    res.json({
      status: "sent",
      phone: cleanPhone,
      messageId: msgId,
      result
    });

  } catch (error) {
    console.error("Error enviando template:", error?.response?.data || error);

    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({ 
      error: "Error al enviar el mensaje",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
  }
});

app.post("/api/send-meeting-confirmation", async (req, res) => {
  const {
    to,
    eventName,
    acceptedBy,
    meetingWith,
    company,
    schedule,
    table
  } = req.body;

  if (!to || !eventName || !acceptedBy || !meetingWith ||
      !company || !schedule || !table) {
    return res.status(400).json({
      error: "Faltan datos requeridos",
      required: [
        "to", "eventName", "acceptedBy", "meetingWith",
        "company", "schedule", "table"
      ]
    });
  }

  try {
    // Limpiar número de teléfono
    const cleanPhone = String(to).replace(/[^0-9]/g, '').replace(/^0+/, '');
    
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    // Parámetros del template en orden
    const bodyParameters = [
      eventName,    // {{1}}
      acceptedBy,   // {{2}}
      meetingWith,  // {{3}}
      company,      // {{4}}
      schedule,     // {{5}}
      table         // {{6}}
    ];

    // Enviar template sin botones
    const result = await sendTemplateWithParams(
      cleanPhone,
      'confirmacion_reunion',  // Nombre del template
      bodyParameters,
      'es'
    );

    const msgId = result?.messages?.[0]?.id;
    if (msgId) registerFallbackForMessage(msgId, req.body);

    res.json({
      status: 'sent',
      phone: cleanPhone,
      messageId: msgId,
      result
    });
  } catch (error) {
    console.error("Error enviando confirmación:", error?.response?.data || error);
    
    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({ 
      error: "Error al enviar la confirmación",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
  }
});

app.post("/api/send-meeting-cancelled", async (req, res) => {
  const {
    to,
    eventName,
    meetingWith,
    company,
    day,
    schedule,
    table
  } = req.body;

  if (!to || !eventName || !meetingWith ||
      !company || !day || !schedule || !table) {
    return res.status(400).json({
      error: "Faltan datos requeridos",
      required: [
        "to", "eventName", "meetingWith",
        "company", "day", "schedule", "table"
      ]
    });
  }

  try {
    // Limpiar número de teléfono
    const cleanPhone = String(to).replace(/[^0-9]/g, '').replace(/^0+/, '');
    
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    // Parámetros del template en orden
    const bodyParameters = [
      eventName,    // {{1}}
      meetingWith,  // {{2}}
      company,      // {{3}}
      day,          // {{4}}
      schedule,     // {{5}}
      table         // {{6}}
    ];

    // Enviar template sin botones
    const result = await sendTemplateWithParams(
      cleanPhone,
      'reunion_cancelada',  // Nombre del template
      bodyParameters,
      'es'
    );

    const msgId = result?.messages?.[0]?.id;
    if (msgId) registerFallbackForMessage(msgId, req.body);

    res.json({
      status: 'sent',
      phone: cleanPhone,
      messageId: msgId,
      result
    });
  } catch (error) {
    console.error("Error enviando cancelación:", error?.response?.data || error);
    
    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({ 
      error: "Error al enviar la cancelación",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
  }
});

app.post("/api/send-meeting-rejection", async (req, res) => {
  const {
    to,
    eventName,
    rejectedByName,
    rejectedByCompany
  } = req.body;

  if (!to || !eventName || !rejectedByName || !rejectedByCompany) {
    return res.status(400).json({
      error: "Faltan datos requeridos",
      required: [
        "to", "eventName", "rejectedByName", "rejectedByCompany"
      ]
    });
  }

  try {
    // Limpiar número de teléfono
    const cleanPhone = String(to).replace(/[^0-9]/g, '').replace(/^0+/, '');
    
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    // Parámetros del template en orden
    const bodyParameters = [
      eventName,          // {{1}}
      rejectedByName,     // {{2}}
      rejectedByCompany   // {{3}}
    ];

    // Enviar template sin botones
    const result = await sendTemplateWithParams(
      cleanPhone,
      'rechazo_solicitud',  // Nombre del template
      bodyParameters,
      'es'
    );

    const msgId = result?.messages?.[0]?.id;
    if (msgId) registerFallbackForMessage(msgId, req.body);

    res.json({
      status: 'sent',
      phone: cleanPhone,
      messageId: msgId,
      result
    });
  } catch (error) {
    console.error("Error enviando rechazo:", error?.response?.data || error);
    
    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({ 
      error: "Error al enviar el rechazo",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
  }
});

app.post("/api/send-welcome", async (req, res) => {
  const { to, userName, eventName, badgeUrl, headerImageUrl, date = "Por definir", time = "Por definir", sendEmail } = req.body;

  if (!to || !userName || !eventName || !badgeUrl || !headerImageUrl) {
    return res.status(400).json({
      error: "Faltan datos requeridos",
      required: ["to", "userName", "eventName", "badgeUrl", "headerImageUrl"]
    });
  }

  try {
    const cleanPhone = String(to).replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    const mediaId = await uploadMedia(headerImageUrl);

    const headerParams = {
      type: "header",
      parameters: [
        {
          type: "image",
          image: {
            id: mediaId
          }
        }
      ]
    };

    const bodyParams = [
      { type: "text", text: String(userName).trim() },
      { type: "text", text: String(eventName).trim() },
      { type: "text", text: String(date).trim() },
      { type: "text", text: String(time).trim() }
    ];

    const buttonParams = [
      {
        type: "button",
        sub_type: "URL",
        index: "0",
        parameters: [
          { type: "text", text: String(badgeUrl).trim() }
        ]
      }
    ];

    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "template",
      template: {
        name: "bienvenida_magnetic",
        language: { code: "es" },
        components: [
          headerParams,
          {
            type: "body",
            parameters: bodyParams
          },
          ...buttonParams
        ]
      }
    };

    const result = await sendTemplateWithButtons(payload);

    const msgId = result?.messages?.[0]?.id;
    let emailSent = false;
    
    if (sendEmail) {
      emailSent = await tryEmailFallback(req.body);
    } else if (msgId) {
      registerFallbackForMessage(msgId, req.body);
    }

    res.json({
      status: "sent",
      phone: cleanPhone,
      messageId: msgId,
      result,
      emailSent
    });
  } catch (error) {
    console.error("Error enviando bienvenida:", error?.response?.data || error);
    
    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({
      error: "Error al enviar la bienvenida",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
  }
});

app.post("/api/send-projection-notification", async (req, res) => {
  const { to, experienceName, userName } = req.body;

  if (!to || !experienceName || !userName) {
    return res.status(400).json({
      error: "Faltan datos requeridos",
      required: ["to", "experienceName", "userName"]
    });
  }

  try {
    const cleanPhone = String(to).replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "template",
      template: {
        name: "notificacion_proyeccion_comuna13",
        language: { code: "es" },
        components: [
          {
            type: "header",
            parameters: [
              { type: "text", text: String(experienceName).trim().substring(0, 60) }
            ]
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: String(userName).trim() }
            ]
          }
        ]
      }
    };

    const result = await sendTemplateWithButtons(payload);

    const msgId = result?.messages?.[0]?.id;
    if (msgId) registerFallbackForMessage(msgId, req.body);

    res.json({
      status: "sent",
      phone: cleanPhone,
      messageId: msgId,
      result
    });
  } catch (error) {
    console.error("Error enviando notificación de proyección:", error?.response?.data || error);
    
    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({
      error: "Error al enviar la notificación de proyección",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
  }
});

app.post("/api/send-image-result", async (req, res) => {
  const { to, imageUrl, userName, experienceName, organizationName } = req.body;

  if (!to || !imageUrl || !userName || !experienceName || !organizationName) {
    return res.status(400).json({
      error: "Faltan datos requeridos",
      required: ["to", "imageUrl", "userName", "experienceName", "organizationName"]
    });
  }

  try {
    const cleanPhone = String(to).replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    const mediaId = await uploadMedia(imageUrl);

    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "template",
      template: {
        name: "notificacion_resultado_imagen",
        language: { code: "es" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  id: mediaId
                }
              }
            ]
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: String(userName).trim() },
              { type: "text", text: String(experienceName).trim() },
              { type: "text", text: String(organizationName).trim() }
            ]
          }
        ]
      }
    };

    const result = await sendTemplateWithButtons(payload);

    const msgId = result?.messages?.[0]?.id;
    if (msgId) registerFallbackForMessage(msgId, req.body);

    res.json({
      status: "sent",
      phone: cleanPhone,
      messageId: msgId,
      result
    });
  } catch (error) {
    console.error("Error enviando resultado de imagen:", error?.response?.data || error);
    
    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({
      error: "Error al enviar el resultado de imagen",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
  }
});

// API: enviar la encuesta de valor de negocio (plantilla utility con 5 botones quick reply).
// El eventId se incrusta en el payload de cada botón y vuelve por el webhook principal.
// body: { to, name?, eventId }
//
// Orden de botones en la plantilla encuesta_valor_negiocio2:
//   0 -> "menos de 100 millones"            -> menos_100M
//   1 -> "entre 100 y 500 millones"         -> 100M_500M
//   2 -> "entre 500 y 1000 millones"        -> 500M_1000M
//   3 -> "entre 1000 y 5000 millones"       -> 1000M_5000M
//   4 -> "más de 5000 millones"             -> mas_5000M
app.post("/api/send-encuesta-valor-negocio", async (req, res) => {
  const { to, name = "", eventId } = req.body;

  if (!to || !eventId) {
    return res.status(400).json({
      error: "Faltan datos requeridos",
      required: ["to", "eventId"]
    });
  }

  try {
    const cleanPhone = String(to).replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "template",
      template: {
        name: "encuesta_valor_negiocio2",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: String(name).trim() || "Hola" }
            ]
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "0",
            parameters: [
              { type: "payload", payload: buildSurveyPayload("menos_100M", eventId) }
            ]
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "1",
            parameters: [
              { type: "payload", payload: buildSurveyPayload("100M_500M", eventId) }
            ]
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "2",
            parameters: [
              { type: "payload", payload: buildSurveyPayload("500M_1000M", eventId) }
            ]
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "3",
            parameters: [
              { type: "payload", payload: buildSurveyPayload("1000M_5000M", eventId) }
            ]
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "4",
            parameters: [
              { type: "payload", payload: buildSurveyPayload("mas_5000M", eventId) }
            ]
          }
        ]
      }
    };

    const result = await sendTemplateWithButtons(payload);

    const msgId = result?.messages?.[0]?.id;
    if (msgId) registerFallbackForMessage(msgId, req.body);

    res.json({
      status: "sent",
      phone: cleanPhone,
      eventId,
      messageId: msgId,
      result
    });
  } catch (error) {
    console.error("Error enviando encuesta de valor de negocio:", error?.response?.data || error);

    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({
      error: "Error al enviar la encuesta de valor de negocio",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
  }
});

// API genérica: enviar cualquier plantilla aprobada, sin endpoint dedicado por plantilla.
// `parameters` llena el body ({{1}}, {{2}}, ... en orden). `buttonUrl` es opcional: si se
// envía, se agrega un botón de tipo URL con ese valor como parámetro dinámico (por defecto
// en el índice 0 — el último botón de la plantilla salvo que pases buttonIndex).
app.post("/api/send-template", async (req, res) => {
  const { to, templateName, parameters = [], languageCode = 'es', buttonUrl, buttonIndex = '0' } = req.body;

  if (!to || !templateName) {
    return res.status(400).json({
      error: "Faltan datos: to, templateName"
    });
  }

  try {
    const cleanPhone = String(to).replace(/[^0-9]/g, '').replace(/^0+/, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    let result;

    if (buttonUrl) {
      // Necesitamos armar el payload completo para incluir el componente de botón.
      const components = [];

      if (parameters.length > 0) {
        components.push({
          type: "body",
          parameters: parameters.map(param => ({ type: "text", text: String(param) }))
        });
      }

      components.push({
        type: "button",
        sub_type: "URL",
        index: String(buttonIndex),
        parameters: [{ type: "text", text: String(buttonUrl).trim() }]
      });

      result = await sendTemplateWithButtons({
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: { name: templateName, language: { code: languageCode }, components }
      });
    } else {
      result = await sendTemplateWithParams(cleanPhone, templateName, parameters, languageCode);
    }

    const msgId = result?.messages?.[0]?.id;
    if (msgId) registerFallbackForMessage(msgId, req.body);

    res.json({
      status: "sent",
      phone: cleanPhone,
      templateName,
      messageId: msgId,
      result
    });
  } catch (error) {
    console.error("Error enviando plantilla:", error?.response?.data || error);

    const fallbackSent = await tryEmailFallback(req.body);

    const errData = error?.response?.data || {};
    res.status(500).json({
      error: "Error al enviar la plantilla",
      code: errData.error?.code,
      details: errData.error?.message || error.message,
      fullError: errData,
      fallbackEmailSent: fallbackSent
    });
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


