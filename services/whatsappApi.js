// services/whatsappApi.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

// Configuración de cuentas (puedes tener múltiples)
const accounts = {};

/**
 * Registra una cuenta de WhatsApp Business
 * @param {string} accountId - ID único de la cuenta
 * @param {string} phoneNumberId - ID del número de teléfono de WhatsApp Business
 * @param {string} accessToken - Token de acceso de la API
 */
export function registerAccount(accountId, phoneNumberId, accessToken) {
  accounts[accountId] = {
    phoneNumberId,
    accessToken,
    apiUrl: `${WHATSAPP_API_URL}/${phoneNumberId}/messages`
  };
  console.log(`✅ Cuenta registrada: ${accountId}`);
}

/**
 * Obtiene una cuenta registrada
 */
export function getAccount(accountId) {
  return accounts[accountId] || null;
}

/**
 * Lista todas las cuentas registradas
 */
export function listAccounts() {
  return Object.keys(accounts).map(id => ({
    accountId: id,
    phoneNumberId: accounts[id].phoneNumberId,
    status: 'ready'
  }));
}

/**
 * Sube una media (imagen/documento) a WhatsApp Cloud API y devuelve su ID
 * @param {string} accountId - ID de la cuenta
 * @param {string} mediaUrl - URL del archivo a descargar y subir
 */
export async function uploadMedia(accountId, mediaUrl) {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Cuenta ${accountId} no encontrada`);

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

 * @param {string} accountId - ID de la cuenta
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} message - Texto del mensaje
 * @param {boolean} previewUrl - Habilitar preview de URLs (default: false)
 */
export async function sendTextMessage(accountId, to, message, previewUrl = false) {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Cuenta ${accountId} no encontrada`);

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
export async function sendImageMessage(accountId, to, imageUrl, caption = '') {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Cuenta ${accountId} no encontrada`);

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
export async function sendTemplate(accountId, to, templateName, languageCode = 'en_US') {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Cuenta ${accountId} no encontrada`);

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
 * @param {string} accountId - ID de la cuenta
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} templateName - Nombre del template
 * @param {Array<string>} parameters - Parámetros para el template
 * @param {string} languageCode - Código de idioma (default: es_MX)
 */
export async function sendTemplateWithParams(accountId, to, templateName, parameters = [], languageCode = 'es_MX') {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Cuenta ${accountId} no encontrada`);

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
 * @param {string} accountId - ID de la cuenta
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} templateName - Nombre del template
 * @param {Array<string>} bodyParameters - Parámetros para el cuerpo del mensaje
 * @param {Array<Object>} buttons - Botones de acción [{type: 'URL', text: 'Aceptar', url: 'https://...'}]
 * @param {string} languageCode - Código de idioma (default: es_MX)
 */
export async function sendTemplateWithButtons(accountId, payload) {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Cuenta ${accountId} no encontrada`);



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
 * Elimina una cuenta registrada
 */
export function removeAccount(accountId) {
  if (accounts[accountId]) {
    delete accounts[accountId];
    console.log(`🗑️ Cuenta eliminada: ${accountId}`);
    return true;
  }
  return false;
}
