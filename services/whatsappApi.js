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
