// sessions/sessionManager.js

import pkg from "whatsapp-web.js";
const { Client, RemoteAuth, MessageMedia } = pkg;
// import fs from "fs"; // Ya no se necesita fs para auth
// import path from "path";
import mongoose from "mongoose";
import { MongoStore } from "wwebjs-mongo";

// Mapa global de clientes activos
export const clients = {}; 

export async function getOrCreateClient({ clientId, io }) {
  if (clients[clientId]) return clients[clientId];

  // Asegura conexión a Mongo (utiliza la misma URI que el resto de la app)
  if (mongoose.connection.readyState === 0) {
     try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Mongoose conectado para RemoteAuth");
     } catch (err) {
        console.error("Error conectando Mongoose:", err);
        throw err; // No podemos seguir sin DB para RemoteAuth
     }
  }

  const store = new MongoStore({ mongoose: mongoose });

  const client = new Client({
    authStrategy: new RemoteAuth({
      clientId: clientId,
      store: store,
      backupSyncIntervalMs: 300000
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu", // Ya estaba, pero lo mantenemos
        "--disable-extensions", // Deshabilita extensiones
        "--disable-component-extensions-with-background-pages",
        "--disable-default-apps",
        "--mute-audio", // Mutea audio
        "--no-default-browser-check",
        "--autoplay-policy=user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-notifications",
        "--disable-background-networking",
        "--disable-breakpad",
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-sync",
      ],
    },
  });

  clients[clientId] = client;

  // Eventos principales
  client.on("qr", (qr) => {
    io.to(clientId).emit("qr", { qr });
    console.log(`[${clientId}] Nuevo QR emitido`);
  });

  client.on("ready", () => {
    io.to(clientId).emit("status", { status: "ready" });
    client.status = "ready";
    console.log(`[${clientId}] Sesión lista`);
  });

  client.on("authenticated", () => {
    io.to(clientId).emit("status", { status: "authenticated" });
    client.status = "authenticated";
    console.log(`[${clientId}] Autenticado`);
  });

  client.on("auth_failure", (msg) => {
    io.to(clientId).emit("status", { status: "auth_failure", error: msg });
    client.status = "auth_failure";
    console.log(`[${clientId}] Fallo de autenticación`);
    limpiarSesion(clientId, io, "auth_failure");
  });

  client.on("remote_session_saved", () => {
     console.log(`[${clientId}] Sesión remota guardada en DB`);
  });

  client.on("disconnected", (reason) => {
    io.to(clientId).emit("status", { status: "disconnected", reason });
    client.status = "disconnected";
    console.log(`[${clientId}] Desconectado`);
    limpiarSesion(clientId, io, "disconnected");
  });

  client.initialize().catch((err) => {
    console.error(`[${clientId}] Error en initialize:`, err);
    limpiarSesion(clientId, io, "init_error");
  });

  return client;
}

export function getClient(clientId) {
  return clients[clientId] || null;
}

// FUNCION CENTRAL de limpieza para usar en ambos lugares
function limpiarSesion(clientId, io, motivo = "") {
  if (clients[clientId]) {
    try {
      clients[clientId].destroy();
    } catch (err) {
      console.error(`[${clientId}] Error destruyendo cliente:`, err);
    }
    delete clients[clientId];
  }

  // Opcional: Eliminar sesión de la DB si es un logout manual real? 
  // RemoteAuth no tiene un método directo para borrar del store fácilmente expuesto en 'destroy', 
  // pero al destruir el cliente se detiene.
  // Si quisiéramos borrar la sesión de Mongo, necesitaríamos usar el store.
  
  // Por ahora solo liberamos memoria y notificamos.
  console.log(`[${clientId}] Cliente destruido en memoria`);

  // Opcional: notificar por websocket si necesitas más feedback
  io.to(clientId).emit("session_cleaned", { status: "cleaned", motivo });
}

// Función pública para logout manual (desde endpoint)
export function logoutClient(clientId, io) {
  limpiarSesion(clientId, io, "logout_manual");
}

// Exporta MessageMedia para uso en otros archivos
export { MessageMedia };
