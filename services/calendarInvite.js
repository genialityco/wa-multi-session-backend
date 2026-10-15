// ============================================================================
// INVITACIONES DE CALENDARIO POR CORREO (reuniones de meetings-app)
// ============================================================================
//
// Envía un correo con un evento iCalendar para el calendario del asistente
// (Gmail/Google Calendar, Outlook, Apple):
//   PUBLISH  evento sin asistentes: Gmail muestra la tarjeta con el botón
//            "Agregar al calendario" (sin Sí/No/Quizás). Lo usa meetings-app.
//   REQUEST  invitación con el asistente: Gmail muestra Sí/No/Quizás. El mismo
//            UID + un SEQUENCE mayor actualiza el evento ya agregado.
//   CANCEL   con el mismo UID elimina el evento.
//
// Transporte (variables de entorno, leídas en el primer envío porque server.js
// corre dotenv.config() después de evaluar los imports):
//   MAIL_FROM            remitente y ORGANIZER de la invitación (ej. alert@geniality.com.co)
//   MAIL_FROM_NAME       nombre por defecto del remitente (default "Geniality")
//   SMTP_HOST            si está, se usa SMTP: SMTP_PORT (587), SMTP_SECURE ("true" = 465/TLS),
//                        SMTP_USER, SMTP_PASS (SES SMTP, Zoho, etc.)
//   AWS_ACCESS_KEY_ID    si no hay SMTP_HOST, se usa la API de AWS SES v2 con estas
//   AWS_SECRET_ACCESS_KEY  credenciales (IAM con ses:SendEmail) y AWS_REGION (default us-east-1)

import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    const sesClient = new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" });
    transporter = nodemailer.createTransport({ SES: { sesClient, SendEmailCommand } });
  }
  return transporter;
}

export function isMailConfigured() {
  return !!process.env.MAIL_FROM && !!getTransporter();
}

// ----------------------------------------------------------------------------
// iCalendar (RFC 5545)
// ----------------------------------------------------------------------------
const escapeIcs = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

// Parámetro entre comillas (CN): sin comillas ni saltos de línea
const quoteParam = (s) => `"${String(s ?? "").replace(/["\r\n]/g, "").trim()}"`;

// Fecha UTC en formato básico: 20261015T153000Z
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Las líneas no pueden pasar de 75 octetos: se doblan con CRLF + espacio
function foldLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, "utf8");
    if (size + len > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs({ method, uid, sequence, start, end, summary, description, location, url, organizer, attendee, alarmMinutes }) {
  const cancel = method === "CANCEL";
  const publish = method === "PUBLISH";
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Geniality//Meetings//ES",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${Number(sequence) || 0}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    description ? `DESCRIPTION:${escapeIcs(description)}` : null,
    location ? `LOCATION:${escapeIcs(location)}` : null,
    url ? `URL:${url}` : null,
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    `ORGANIZER;CN=${quoteParam(organizer.name)}:mailto:${organizer.email}`,
    // Sin ATTENDEE en PUBLISH: así Gmail ofrece "Agregar al calendario" en vez de
    // pedir respuesta. En REQUEST la reunión ya está confirmada: RSVP=FALSE
    publish
      ? null
      : `ATTENDEE;CN=${quoteParam(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${attendee.email}`,
  ];
  if (!cancel && Number(alarmMinutes) > 0) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcs(summary)}`,
      `TRIGGER:-PT${Math.round(Number(alarmMinutes))}M`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.filter(Boolean).map(foldLine).join("\r\n") + "\r\n";
}

// ----------------------------------------------------------------------------
// Correo
// ----------------------------------------------------------------------------
const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function buildEmailHtml(d, cancel) {
  const row = (label, value) =>
    value
      ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;">${label}</td><td style="padding:6px 0;font-weight:bold;color:#111827;">${escapeHtml(value)}</td></tr>`
      : "";
  const logo = d.logoUrl
    ? `<div style="text-align:center;margin-bottom:20px;"><img src="${escapeHtml(d.logoUrl)}" alt="Logo" style="max-width:200px;max-height:80px;" /></div>`
    : "";
  const intro = cancel
    ? `Tu reunión en <strong>${escapeHtml(d.eventName)}</strong> fue <strong>cancelada</strong>. La quitamos de tu calendario.`
    : d.isUpdate
      ? `Tu reunión en <strong>${escapeHtml(d.eventName)}</strong> cambió. Actualizamos la invitación en tu calendario.`
      : `Tienes una reunión confirmada en <strong>${escapeHtml(d.eventName)}</strong>. Adjuntamos la invitación para que quede en tu calendario.`;
  const button = d.accessUrl && !cancel
    ? `<div style="text-align:center;margin-top:24px;"><a href="${escapeHtml(d.accessUrl)}" style="display:inline-block;padding:12px 24px;color:#fff;background:#3b82f6;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;">Ver mi agenda</a></div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(d.subject)}</title></head>
  <body style="font-family:Arial,sans-serif;background:#f9fafb;color:#374151;margin:0;padding:20px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
      <div style="padding:30px;">
        ${logo}
        <p>Hola <strong>${escapeHtml(d.attendeeName)}</strong>,</p>
        <p>${intro}</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          ${row("Con", d.counterpartName)}
          ${row("Empresa", d.counterpartCompany)}
          ${row("Fecha", d.dateLabel)}
          ${row("Hora", d.timeLabel)}
          ${row("Mesa", d.table)}
          ${row("Lugar", d.location)}
        </table>
        ${button}
      </div>
      <div style="background:#f3f4f6;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
        Este es un mensaje automático de la plataforma de agendamiento.
      </div>
    </div>
  </body></html>`;
}

/**
 * Envía la invitación de una reunión.
 * @param {object} d
 *   method "PUBLISH" | "REQUEST" | "CANCEL", uid, sequence, start/end (ISO), to { email, name },
 *   eventName, counterpartName?, counterpartCompany?, table?, location?,
 *   dateLabel?, timeLabel?, accessUrl?, logoUrl?, fromName?, alarmMinutes?, isUpdate?
 * @returns {Promise<{ messageId: string }>}
 */
export async function sendMeetingInvite(d) {
  const transport = getTransporter();
  const fromEmail = process.env.MAIL_FROM;
  if (!transport || !fromEmail) throw new Error("Correo no configurado (MAIL_FROM y SMTP_HOST o AWS_*)");

  const cancel = d.method === "CANCEL";
  const method = ["PUBLISH", "CANCEL"].includes(d.method) ? d.method : "REQUEST";
  const fromName = d.fromName || d.eventName || process.env.MAIL_FROM_NAME || "Geniality";
  const withWho = d.counterpartName
    ? `${d.counterpartName}${d.counterpartCompany && d.counterpartCompany !== d.counterpartName ? ` (${d.counterpartCompany})` : ""}`
    : "";
  const summary = `Reunión${withWho ? ` con ${withWho}` : ""} · ${d.eventName}`;
  const location = [d.table ? `Mesa ${d.table}` : "", d.location || ""].filter(Boolean).join(" · ");
  const subject = cancel
    ? `Reunión cancelada: ${summary}`
    : `${d.isUpdate ? "Reunión actualizada" : "Invitación"}: ${summary}${d.dateLabel || d.timeLabel ? ` - ${[d.dateLabel, d.timeLabel].filter(Boolean).join(" ")}` : ""}`;
  const description = [
    withWho ? `Reunión con ${withWho}` : "",
    d.table ? `Mesa: ${d.table}` : "",
    d.accessUrl ? `Consulta tu agenda: ${d.accessUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const ics = buildIcs({
    method,
    uid: d.uid,
    sequence: d.sequence,
    start: d.start,
    end: d.end,
    summary,
    description,
    location,
    url: d.accessUrl,
    organizer: { name: fromName, email: fromEmail },
    attendee: { name: d.to.name || d.to.email, email: d.to.email },
    alarmMinutes: d.alarmMinutes ?? 15,
  });

  const info = await transport.sendMail({
    from: { name: fromName, address: fromEmail },
    to: d.to.name ? { name: d.to.name, address: d.to.email } : d.to.email,
    subject,
    text: `${cancel ? "Reunión cancelada" : summary}\n${description}`,
    html: buildEmailHtml({ ...d, subject, attendeeName: d.to.name || "", location: d.location }, cancel),
    icalEvent: { method, filename: cancel ? "cancelacion.ics" : "invitacion.ics", content: ics },
  });
  return { messageId: info.messageId };
}
