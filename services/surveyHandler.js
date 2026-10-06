// services/surveyHandler.js
// Procesa las respuestas a botones quick reply de plantillas y las reenvía a la
// Cloud Function de Firebase que las almacena. Soporta dos formatos de payload:
//  - Encuesta "valor de negocio" (legacy): { t: 'encuesta_valor_negocio', v, e }
//  - Campañas de meetings-app:            { t: 'wac', e, c, u, b }
import axios from 'axios';

/** Identificador que viaja en el payload de los botones para reconocer nuestra encuesta. */
export const SURVEY_TAG = 'encuesta_valor_negocio';

/** Identificador de los botones de campañas masivas (meetings-app). */
export const CAMPAIGN_TAG = 'wac';

// Las variables de entorno se leen al usarse (no al cargar el módulo): server.js
// ejecuta dotenv.config() después de que se evalúan los imports.
const getFirebaseFnUrl = () =>
  process.env.FIREBASE_WA_REPLY_FN_URL || process.env.FIREBASE_SURVEY_FN_URL;

/** Secreto compartido con la Cloud Function. Debe coincidir con SURVEY_WEBHOOK_SECRET en Firebase. */
const getFirebaseSecret = () =>
  process.env.FIREBASE_SURVEY_SECRET || "geniality-encuesta-webhook";

/**
 * Construye el payload que se incrusta en cada botón quick reply.
 * @param {string} valor - valor del rango ("menos_100M" | "100M_500M" | "500M_1000M" | "1000M_5000M" | "mas_5000M")
 * @param {string} eventId - id del evento al que pertenece el contacto
 */
export function buildSurveyPayload(valor, eventId) {
  return JSON.stringify({ t: SURVEY_TAG, v: valor, e: String(eventId) });
}

/**
 * Procesa la respuesta a un botón de plantilla (message.type === 'button') y la
 * reenvía a la función de Firebase.
 *
 * @param {Object} data
 * @param {string} data.from       - teléfono del contacto (message.from)
 * @param {string} data.payload    - payload del botón (message.button.payload)
 * @param {string} data.buttonText - texto visible del botón (message.button.text)
 * @param {string} data.wamid      - id del mensaje entrante (message.id)
 * @param {string} data.timestamp  - timestamp del mensaje entrante
 */
export async function processButtonReply({ from, payload, buttonText, wamid, timestamp }) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    console.log(`Botón con payload no-JSON, se ignora: ${payload}`);
    return null;
  }

  let body;
  if (parsed?.t === SURVEY_TAG && parsed?.e) {
    body = {
      eventId: parsed.e,
      phone: from,
      answer: parsed.v,        // menos_100M | 100M_500M | 500M_1000M | 1000M_5000M | mas_5000M
      answerText: buttonText,  // texto legible del botón
      wamid,
      timestamp
    };
  } else if (parsed?.t === CAMPAIGN_TAG && parsed?.e && parsed?.c && parsed?.u) {
    body = {
      type: 'campaign',
      eventId: parsed.e,
      campaignId: parsed.c,
      userId: parsed.u,
      buttonIndex: Number(parsed.b ?? 0),
      answerText: buttonText,
      phone: from,
      wamid,
      timestamp
    };
  } else {
    console.log('Botón que no pertenece a una encuesta/campaña conocida, se ignora');
    return null;
  }

  const fnUrl = getFirebaseFnUrl();
  if (!fnUrl) {
    console.error('⚠️ FIREBASE_WA_REPLY_FN_URL / FIREBASE_SURVEY_FN_URL no está configurado; no se pudo almacenar la respuesta', body);
    return null;
  }

  const secret = getFirebaseSecret();
  try {
    const res = await axios.post(fnUrl, body, {
      timeout: 10000,
      headers: secret ? { 'x-webhook-secret': secret } : {}
    });
    console.log(`✅ Respuesta de botón (${parsed.t}) almacenada en Firebase para ...${String(from).slice(-4)} (evento ${parsed.e})`);
    return res.data;
  } catch (error) {
    console.error('Error enviando respuesta de botón a Firebase:', error.response?.data || error.message);
    throw error;
  }
}

/** @deprecated usar processButtonReply */
export const processSurveyButtonReply = processButtonReply;
