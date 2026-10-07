// services/inboundForwarder.js
// Reenvía los mensajes entrantes del número principal a otro backend
// (GenCampus: evaluaciones de conocimientos y simulacros por WhatsApp). El
// backend decide si el mensaje le corresponde (código EV-XXXXXX, evaluación o
// simulacro en curso) y responde por /api/send-text o /api/send-interactive;
// si no, lo ignora.
//
// Además del texto, se reenvían las respuestas a botones/listas interactivos y
// a botones quick reply de plantillas sin payload JSON: `text` lleva el texto
// visible y `replyId` el id/payload del botón u opción elegida.
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const INBOUND_TEXT_FORWARD_URL = process.env.INBOUND_TEXT_FORWARD_URL;
const INBOUND_TEXT_FORWARD_SECRET = process.env.INBOUND_TEXT_FORWARD_SECRET;

/**
 * @param {Object} data
 * @param {string} data.from      - teléfono del contacto (message.from)
 * @param {string} data.text      - texto del mensaje o título del botón/opción elegida
 * @param {string} [data.replyId] - id del botón/opción (interactivos) o payload del quick reply
 * @param {string} data.wamid     - id del mensaje entrante (message.id)
 * @param {string} data.timestamp - timestamp del mensaje entrante
 */
export async function forwardInboundText({ from, text, replyId, wamid, timestamp }) {
  if (!INBOUND_TEXT_FORWARD_URL || !from || !text) return;

  try {
    await axios.post(
      INBOUND_TEXT_FORWARD_URL,
      { from, text, replyId, wamid, timestamp },
      {
        // El backend responde 202 de inmediato; el timeout evita retrasar la
        // respuesta a Meta si el backend no está disponible.
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          ...(INBOUND_TEXT_FORWARD_SECRET ? { 'x-webhook-secret': INBOUND_TEXT_FORWARD_SECRET } : {})
        }
      }
    );
  } catch (error) {
    console.error('❌ Error reenviando mensaje entrante:', error.response?.data || error.message);
  }
}

/** true si el payload del botón es JSON (encuestas/campañas, ver surveyHandler). */
export function isJsonPayload(payload) {
  try {
    const parsed = JSON.parse(payload);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}
