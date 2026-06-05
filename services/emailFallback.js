import axios from 'axios';

/**
 * Envía un correo electrónico usando la API de fallback
 * @param {Object} payload 
 * @param {string | string[]} payload.to - Correo(s) destinatario(s)
 * @param {string} payload.subject - Asunto del correo
 * @param {string} payload.html - Contenido HTML del correo
 * @param {string} [payload.fromName] - Nombre del remitente
 * @param {string} [payload.fromEmail] - Correo del remitente
 * @param {string | string[]} [payload.cc] - Copia
 * @param {string | string[]} [payload.bcc] - Copia oculta
 */
export async function sendEmailFallback(payload) {
  try {
    const response = await axios.post('https://apigencampus.geniality.com.co/email/custom', {
      ...payload,
      emailName: 'Magnetic' // Requisito especificado
    });
    console.log(`✅ [Fallback Email] Correo enviado correctamente a: ${payload.to}`);
    return response.data;
  } catch (error) {
    console.error(`❌ [Fallback Email] Error enviando correo a ${payload.to}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Función auxiliar para intentar el fallback de email si vienen los datos requeridos.
 */
export async function tryEmailFallback(reqBody) {
  const { fallbackEmail, fallbackSubject, fallbackHtml, fallbackFromName, fallbackFromEmail, fallbackCc, fallbackBcc } = reqBody;
  
  if (fallbackEmail && fallbackSubject && fallbackHtml) {
    console.log(`🔄 [WA Falló Sincrónico] Intentando fallback por email hacia: ${fallbackEmail}`);
    try {
      const payload = {
        to: fallbackEmail,
        subject: fallbackSubject,
        html: fallbackHtml
      };
      if (fallbackFromName) payload.fromName = fallbackFromName;
      if (fallbackFromEmail) payload.fromEmail = fallbackFromEmail;
      if (fallbackCc) payload.cc = fallbackCc;
      if (fallbackBcc) payload.bcc = fallbackBcc;

      await sendEmailFallback(payload);
      return true;
    } catch (err) {
      console.error("❌ [WA Falló Sincrónico] Falló el envío de email de fallback.");
      return false;
    }
  } else {
    console.log(`⚠️ [WA Falló Sincrónico] No se proporcionaron datos completos para enviar el fallback de email a este usuario.`);
  }
  return false;
}

// Mapa en memoria para almacenar los datos de fallback temporalmente por ID de mensaje
const pendingFallbacks = new Map();

/**
 * Registra los datos de fallback asociados a un messageId devuelto por la API de Meta.
 * Si el webhook reporta que este mensaje falló, se disparará este fallback.
 */
export function registerFallbackForMessage(messageId, reqBody) {
  const { fallbackEmail, fallbackSubject, fallbackHtml, fallbackFromName, fallbackFromEmail, fallbackCc, fallbackBcc } = reqBody;
  
  if (messageId && fallbackEmail && fallbackSubject && fallbackHtml) {
    // Convertir a string para asegurarnos de que la clave coincide
    const safeMessageId = String(messageId).trim();
    
    console.log(`📌 [Webhook Fallback] Registrando datos de fallback en memoria para el mensaje ID: ${safeMessageId} (Hacia: ${fallbackEmail})`);
    
    pendingFallbacks.set(safeMessageId, {
      to: fallbackEmail,
      subject: fallbackSubject,
      html: fallbackHtml,
      fromName: fallbackFromName,
      fromEmail: fallbackFromEmail,
      cc: fallbackCc,
      bcc: fallbackBcc
    });
    
    // Limpiar caché después de 24 horas por si nunca llega el estado del webhook
    setTimeout(() => {
      pendingFallbacks.delete(safeMessageId);
    }, 24 * 60 * 60 * 1000);
  } else {
    console.log(`⚠️ [Webhook Fallback] No se registraron datos de fallback para el ID: ${messageId}. Faltan parámetros requeridos en req.body (fallbackEmail, fallbackSubject, fallbackHtml).`);
    console.log(`[DEBUG] Valores recibidos en reqBody:`, JSON.stringify(reqBody, null, 2));
  }
}

/**
 * Dispara el fallback si existe un registro para ese messageId fallido.
 * Llamado desde el webhook.
 */
export async function triggerFallbackFromWebhook(messageId) {
  const safeMessageId = String(messageId).trim();
  console.log(`[DEBUG] Buscando fallback para messageId: "${safeMessageId}". Registros actuales en memoria:`, Array.from(pendingFallbacks.keys()));
  
  if (pendingFallbacks.has(safeMessageId)) {
    const payload = pendingFallbacks.get(safeMessageId);
    console.log(`⚠️ [Webhook Fallback] Meta reportó fallo asíncrono para el ID: ${safeMessageId}. Disparando email a: ${payload.to}`);
    try {
      await sendEmailFallback(payload);
      console.log(`✅ [Webhook Fallback] Registro limpiado para el mensaje ID: ${safeMessageId}`);
      pendingFallbacks.delete(safeMessageId); // Limpiar una vez procesado
      return true;
    } catch (err) {
      console.error(`❌ [Webhook Fallback] Falló el envío de email de fallback desde el webhook para ID: ${safeMessageId}`);
      return false;
    }
  } else {
    console.log(`ℹ️ [Webhook Fallback] Se reportó fallo para el ID: ${safeMessageId}, pero no había email de fallback registrado en memoria.`);
  }
  return false;
}

