// services/inboundForwarder.js
// Reenvía los mensajes de texto entrantes del número principal a otro backend
// (GenCampus: evaluaciones de conocimientos por WhatsApp). El backend decide si
// el mensaje le corresponde (código EV-XXXXXX o evaluación en curso) y responde
// por /api/send-text; si no, lo ignora.
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const INBOUND_TEXT_FORWARD_URL = process.env.INBOUND_TEXT_FORWARD_URL;
const INBOUND_TEXT_FORWARD_SECRET = process.env.INBOUND_TEXT_FORWARD_SECRET;

/**
 * @param {Object} data
 * @param {string} data.from      - teléfono del contacto (message.from)
 * @param {string} data.text      - texto del mensaje (message.text.body)
 * @param {string} data.wamid     - id del mensaje entrante (message.id)
 * @param {string} data.timestamp - timestamp del mensaje entrante
 */
export async function forwardInboundText({ from, text, wamid, timestamp }) {
  if (!INBOUND_TEXT_FORWARD_URL || !from || !text) return;

  try {
    await axios.post(
      INBOUND_TEXT_FORWARD_URL,
      { from, text, wamid, timestamp },
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
