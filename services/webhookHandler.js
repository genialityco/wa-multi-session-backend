import Confirmation from '../models/Confirmation.js';

/**
 * Procesa mensajes entrantes de WhatsApp
 */
export async function processIncomingMessage(messageData) {
  try {
    const { from, text } = messageData;
    
    if (!from || !text?.body) {
      console.log('Mensaje sin remitente o texto, ignorando');
      return;
    }

    // Buscar si existe una confirmación pendiente para este usuario
    const confirmation = await Confirmation.findOne({ 
      phone: from,
      confirmed: null 
    }).sort({ createdAt: -1 });

    if (!confirmation) {
      console.log(`No hay confirmación pendiente para ${from}`);
      return;
    }

    // Procesar respuesta
    const responseText = text.body.toLowerCase().trim();
    const isConfirmed = responseText === 'si' || responseText === 'sí';
    
    confirmation.confirmed = isConfirmed;
    confirmation.responseText = text.body;
    confirmation.updatedAt = new Date();
    
    await confirmation.save();
    
    console.log(`✅ Confirmación actualizada para ${from}: ${isConfirmed ? 'SI' : 'NO'}`);
    
    return {
      userId: confirmation.userId,
      confirmed: isConfirmed,
      responseText: text.body
    };
  } catch (error) {
    console.error('Error procesando mensaje entrante:', error);
    throw error;
  }
}
