// services/webhookRouter.js
// Enruta los eventos entrantes de Meta según el número de teléfono (phone_number_id)
// que los recibió. Ambos números comparten la misma cuenta de WhatsApp Business y por
// lo tanto la misma URL de webhook configurada en Meta; este módulo decide si un evento
// se procesa localmente (número propio) o se reenvía a otro backend (número secundario).
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const SECONDARY_PHONE_NUMBER_ID = process.env.SECONDARY_WEBHOOK_PHONE_NUMBER_ID;
const SECONDARY_WEBHOOK_URL = process.env.SECONDARY_WEBHOOK_URL;

export function belongsToSecondaryNumber(phoneNumberId) {
  return Boolean(SECONDARY_PHONE_NUMBER_ID) && phoneNumberId === SECONDARY_PHONE_NUMBER_ID;
}

/**
 * Reenvía un evento de webhook (una sola entry/change) al backend del número secundario.
 */
export async function forwardToSecondaryWebhook(entry, change) {
  if (!SECONDARY_WEBHOOK_URL) {
    console.warn('⚠️ SECONDARY_WEBHOOK_URL no configurada, no se pudo reenviar el evento');
    return;
  }

  const forwardedBody = {
    object: 'whatsapp_business_account',
    entry: [
      {
        ...entry,
        changes: [change]
      }
    ]
  };

  try {
    await axios.post(SECONDARY_WEBHOOK_URL, forwardedBody, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`↪️ Evento reenviado al webhook secundario (${SECONDARY_WEBHOOK_URL})`);
  } catch (error) {
    console.error('❌ Error reenviando evento al webhook secundario:', error.response?.data || error.message);
  }
}
