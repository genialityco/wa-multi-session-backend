// services/surveyHandler.js
import axios from 'axios';

/**
 * URL de la Cloud Function de Firebase que almacena las respuestas de la encuesta.
 * Se define en el .env como FIREBASE_SURVEY_FN_URL.
 */
const FIREBASE_SURVEY_FN_URL = process.env.FIREBASE_SURVEY_FN_URL;

/** Secreto compartido con la Cloud Function (opcional). Debe coincidir con SURVEY_WEBHOOK_SECRET en Firebase. */
const FIREBASE_SURVEY_SECRET = process.env.FIREBASE_SURVEY_SECRET || "geniality-encuesta-webhook";

/** Identificador que viaja en el payload de los botones para reconocer nuestra encuesta. */
export const SURVEY_TAG = 'encuesta_valor_negocio';

/**
 * Construye el payload que se incrusta en cada botón quick reply.
 * @param {string} valor - valor del rango ("menos_100M" | "100M_500M" | "mas_500M")
 * @param {string} eventId - id del evento al que pertenece el contacto
 */
export function buildSurveyPayload(valor, eventId) {
  return JSON.stringify({ t: SURVEY_TAG, v: valor, e: String(eventId) });
}

/**
 * Procesa la respuesta a un botón de plantilla (message.type === 'button').
 * Extrae el eventId del payload y lo reenvía a la función de Firebase junto
 * con el teléfono y la respuesta elegida.
 *
 * @param {Object} data
 * @param {string} data.from       - teléfono del contacto (message.from)
 * @param {string} data.payload    - payload del botón (message.button.payload)
 * @param {string} data.buttonText - texto visible del botón (message.button.text)
 * @param {string} data.wamid      - id del mensaje entrante (message.id)
 * @param {string} data.timestamp  - timestamp del mensaje entrante
 */
export async function processSurveyButtonReply({ from, payload, buttonText, wamid, timestamp }) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    console.log(`Botón con payload no-JSON, se ignora: ${payload}`);
    return null;
  }

  if (parsed?.t !== SURVEY_TAG || !parsed?.e) {
    console.log('Botón que no pertenece a la encuesta de valor de negocio, se ignora');
    return null;
  }

  const body = {
    eventId: parsed.e,
    phone: from,
    answer: parsed.v,        // "menos_100M" | "100M_500M" | "mas_500M"
    answerText: buttonText,  // texto legible del botón
    wamid,
    timestamp
  };

  if (!FIREBASE_SURVEY_FN_URL) {
    console.error('⚠️ FIREBASE_SURVEY_FN_URL no está configurado; no se pudo almacenar la respuesta', body);
    return null;
  }

  try {
    const res = await axios.post(FIREBASE_SURVEY_FN_URL, body, {
      timeout: 10000,
      headers: FIREBASE_SURVEY_SECRET ? { 'x-webhook-secret': FIREBASE_SURVEY_SECRET } : {}
    });
    console.log(`✅ Respuesta de encuesta almacenada en Firebase para ${from} (evento ${parsed.e}): ${parsed.v}`);
    return res.data;
  } catch (error) {
    console.error('Error enviando respuesta de encuesta a Firebase:', error.response?.data || error.message);
    throw error;
  }
}
