// services/whatsappApi.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

if (!phoneNumberId || !accessToken) {
  console.warn('⚠️ WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_ACCESS_TOKEN no están configurados en el .env');
}

const account = {
  phoneNumberId,
  accessToken,
  apiUrl: `${WHATSAPP_API_URL}/${phoneNumberId}/messages`
};

/**
 * Sube una media (imagen/documento) a WhatsApp Cloud API y devuelve su ID
 * @param {string} mediaUrl - URL del archivo a descargar y subir
 */
export async function uploadMedia(mediaUrl) {
  try {
    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
    const buffer = response.data;
    const contentType = response.headers['content-type'] || 'image/jpeg';

    let ext = 'jpg';
    if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('webp')) ext = 'webp';
    else if (contentType.includes('pdf')) ext = 'pdf';

    const filename = `file.${ext}`;

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', new Blob([buffer], { type: contentType }), filename);

    const uploadUrl = `${WHATSAPP_API_URL}/${account.phoneNumberId}/media`;

    const uploadResponse = await axios.post(uploadUrl, formData, {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`
      }
    });

    return uploadResponse.data.id;
  } catch (error) {
    console.error('Error subiendo media a WhatsApp:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un mensaje de texto

 * @param {string} to - Número de teléfono del destinatario
 * @param {string} message - Texto del mensaje
 * @param {boolean} previewUrl - Habilitar preview de URLs (default: false)
 */
export async function sendTextMessage(to, message, previewUrl = false) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'text',
    text: {
      preview_url: previewUrl,
      body: message
    }
  };
  console.log("payload axios: ", payload)
  try {
    const response = await axios.post(account.apiUrl, payload, {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error enviando mensaje:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un mensaje interactivo (botones de respuesta o lista). Solo funciona
 * dentro de la ventana de 24 h desde el último mensaje del usuario.
 * @param {string} to - Número de teléfono del destinatario
 * @param {Object} interactive - Objeto `interactive` de Meta ({ type: 'button' | 'list', body, action, ... })
 */
export async function sendInteractiveMessage(to, interactive) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive
  };

  try {
    const response = await axios.post(account.apiUrl, payload, {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error enviando mensaje interactivo:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía una imagen con caption opcional
 */
export async function sendImageMessage(to, imageUrl, caption = '') {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'image',
    image: {
      link: imageUrl
    }
  };

  if (caption) {
    payload.image.caption = caption;
  }

  try {
    const response = await axios.post(account.apiUrl, payload, {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error enviando imagen:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un template (como hello_world)
 */
export async function sendTemplate(to, templateName, languageCode = 'en_US') {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: languageCode
      }
    }
  };

  try {
    const response = await axios.post(account.apiUrl, payload, {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error enviando template:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un template utility con parámetros
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} templateName - Nombre del template
 * @param {Array<string>} parameters - Parámetros para el template
 * @param {string} languageCode - Código de idioma (default: es_MX)
 */
export async function sendTemplateWithParams(to, templateName, parameters = [], languageCode = 'es_MX') {
  const components = [];

  if (parameters.length > 0) {
    components.push({
      type: 'body',
      parameters: parameters.map(param => ({
        type: 'text',
        text: param
      }))
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: languageCode
      },
      components: components
    }
  };

  try {
    const response = await axios.post(account.apiUrl, payload, {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error enviando template con parámetros:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un template utility con parámetros y botones de acción
 * @param {Object} payload - Payload completo del template (body/header/botones)
 */
export async function sendTemplateWithButtons(payload) {
  try {
    const response = await axios.post(account.apiUrl, payload, {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    console.log("Respuesta de Meta enviando template con botones:", JSON.stringify(response.data));
    return response.data;
  } catch (error) {
    console.error('Error enviando template con botones:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Lista las plantillas de la cuenta de WhatsApp Business (WABA), recorriendo la paginación.
 * Requiere WHATSAPP_WABA_ID en el .env.
 * @param {Object} opts
 * @param {string} [opts.status] - filtra por estado (ej. 'APPROVED'); vacío = todas
 */
export async function listTemplates({ status = 'APPROVED' } = {}) {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!wabaId) {
    throw new Error('WHATSAPP_WABA_ID no está configurado en el .env');
  }

  const templates = [];
  let url = `${WHATSAPP_API_URL}/${wabaId}/message_templates`;
  let params = {
    fields: 'id,name,language,status,category,parameter_format,components,rejected_reason',
    limit: 100,
    ...(status ? { status } : {})
  };

  // Tope de seguridad para no quedar en un bucle si Meta devuelve paginación cíclica
  for (let page = 0; url && page < 50; page++) {
    const response = await axios.get(url, {
      params,
      headers: { 'Authorization': `Bearer ${account.accessToken}` }
    });
    templates.push(...(response.data?.data || []));
    // `next` ya trae los query params incluidos
    url = response.data?.paging?.next || null;
    params = undefined;
  }

  return templates;
}

/**
 * Crea una plantilla en la WABA y la envía a revisión de Meta. Devuelve
 * { id, status, category } (status suele ser PENDING; Meta puede cambiar la
 * categoría si no corresponde al contenido).
 * Requiere WHATSAPP_WABA_ID en el .env.
 * @param {Object} template - { name, language, category, components, parameter_format? }
 */
export async function createTemplate(template) {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!wabaId) {
    throw new Error('WHATSAPP_WABA_ID no está configurado en el .env');
  }
  const response = await axios.post(
    `${WHATSAPP_API_URL}/${wabaId}/message_templates`,
    template,
    {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
}

/**
 * Analítica diaria de plantillas (Template Analytics de Meta): enviados,
 * entregados y leídos por plantilla y por día. Meta solo la entrega con
 * granularidad DAILY, días en UTC, solo de los últimos 90 días (el inicio se
 * recorta) y máximo 10 plantillas por consulta, así que se consulta en tandas.
 * Requiere las estadísticas de plantillas activadas en la WABA
 * (is_enabled_for_insights); si no, Meta responde con el subcódigo 4182004.
 * @param {Object} opts
 * @param {number} opts.start - unix (s), inicio del rango
 * @param {number} opts.end - unix (s), fin del rango
 * @param {string[]} [opts.templateIds] - ids de plantillas; vacío = todas las de la cuenta
 * @returns {Promise<{ templates: Object[], points: Object[], start: number, end: number, clamped: boolean }>}
 */
export async function getTemplateAnalytics({ start, end, templateIds }) {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!wabaId) {
    throw new Error('WHATSAPP_WABA_ID no está configurado en el .env');
  }

  const templates = (await listTemplates({ status: '' })).map(({ id, name, language, status, category }) => ({
    id, name, language, status, category
  }));
  const ids = templateIds?.length ? templateIds : templates.map((t) => t.id);

  const now = Math.floor(Date.now() / 1000);
  const from = Math.max(start, Math.ceil((now - 89 * 86400) / 86400) * 86400);
  const to = Math.min(end, now);
  if (to <= from) return { templates, points: [], start: from, end: to, clamped: true };

  const points = [];
  for (let i = 0; i < ids.length; i += 10) {
    let url = `${WHATSAPP_API_URL}/${wabaId}/template_analytics`;
    let params = {
      start: from,
      end: to,
      granularity: 'DAILY',
      metric_types: JSON.stringify(['SENT', 'DELIVERED', 'READ']),
      template_ids: JSON.stringify(ids.slice(i, i + 10))
    };
    for (let page = 0; url && page < 50; page++) {
      const response = await axios.get(url, {
        params,
        headers: { 'Authorization': `Bearer ${account.accessToken}` }
      });
      for (const block of response.data?.data || []) {
        points.push(...(block.data_points || []));
      }
      url = response.data?.paging?.next || null;
      params = undefined;
    }
  }

  return { templates, points, start: from, end: to, clamped: from > start };
}

let mainPhoneDigits = null;
/** Número visible (solo dígitos) de WHATSAPP_PHONE_NUMBER_ID, para filtrar la analítica */
async function getMainPhoneDigits() {
  if (mainPhoneDigits) return mainPhoneDigits;
  const response = await axios.get(`${WHATSAPP_API_URL}/${account.phoneNumberId}`, {
    params: { fields: 'display_phone_number' },
    headers: { 'Authorization': `Bearer ${account.accessToken}` }
  });
  mainPhoneDigits = String(response.data?.display_phone_number || '').replace(/\D/g, '');
  return mainPhoneDigits;
}

const HALF_HOUR = 1800;
const DAY = 86400;
// Meta solo permite los últimos 365 días; con media hora, rangos largos dan error 500
const MESSAGE_ANALYTICS_MAX_DAYS = 364;
const MESSAGE_ANALYTICS_CHUNK = 15 * DAY;

/**
 * Analítica de mensajes del número principal (campo `analytics` de la WABA):
 * enviados y entregados cada media hora, de todas las plantillas y mensajes del
 * número juntos. No requiere activación (a diferencia de template_analytics) y
 * cubre hasta 365 días atrás. Se consulta en tandas de 15 días.
 * @param {Object} opts
 * @param {number} opts.start - unix (s)
 * @param {number} opts.end - unix (s)
 * @returns {Promise<{ phoneLast4: string, start: number, end: number, clamped: boolean, points: Object[] }>}
 */
export async function getMessageAnalytics({ start, end }) {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!wabaId) {
    throw new Error('WHATSAPP_WABA_ID no está configurado en el .env');
  }
  const digits = await getMainPhoneDigits();

  const now = Math.floor(Date.now() / 1000);
  const minStart = Math.ceil((now - MESSAGE_ANALYTICS_MAX_DAYS * DAY) / HALF_HOUR) * HALF_HOUR;
  const from = Math.max(Math.floor(start / HALF_HOUR) * HALF_HOUR, minStart);
  const to = Math.min(Math.ceil(end / HALF_HOUR) * HALF_HOUR, Math.ceil(now / HALF_HOUR) * HALF_HOUR);

  const points = [];
  for (let s = from; s < to; s += MESSAGE_ANALYTICS_CHUNK) {
    const e = Math.min(s + MESSAGE_ANALYTICS_CHUNK, to);
    const fields =
      `analytics.start(${s}).end(${e}).granularity(HALF_HOUR)` +
      (digits ? `.phone_numbers(["${digits}"])` : '');
    let response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await axios.get(`${WHATSAPP_API_URL}/${wabaId}`, {
          params: { fields },
          headers: { 'Authorization': `Bearer ${account.accessToken}` }
        });
        break;
      } catch (error) {
        // Meta devuelve 500 transitorios en esta consulta: un reintento
        if (attempt >= 2 || (error?.response?.status || 500) < 500) throw error;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    for (const p of response.data?.analytics?.data_points || []) {
      points.push({ start: p.start, end: p.end, sent: p.sent || 0, delivered: p.delivered || 0 });
    }
  }

  return { phoneLast4: digits.slice(-4), start: from, end: to, clamped: from > start, points };
}

/**
 * Crea un grupo de WhatsApp desde el número de negocio (Groups API).
 * @param {Object} opts
 * @param {string} opts.subject - Nombre del grupo
 * @param {string} [opts.description] - Descripción opcional
 * @param {string} [opts.joinApprovalMode] - 'auto_approve' (default) o 'approval_required'
 */
export async function createGroup({ subject, description, joinApprovalMode = 'auto_approve' }) {
  const payload = {
    messaging_product: 'whatsapp',
    subject,
    join_approval_mode: joinApprovalMode,
    ...(description ? { description } : {})
  };

  try {
    const response = await axios.post(`${WHATSAPP_API_URL}/${account.phoneNumberId}/groups`, payload, {
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error creando grupo:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía una plantilla con los `components` de Meta ya armados por el llamador
 * (header/body/botones). Útil para campañas, donde cada destinatario lleva sus
 * propios parámetros.
 */
export async function sendTemplateComponents(to, templateName, languageCode, components = []) {
  return sendTemplateWithButtons({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {})
    }
  });
}
