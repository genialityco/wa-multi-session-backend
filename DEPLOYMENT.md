# Guía de Despliegue - Backend WhatsApp Multi-Sesión

Esta guía documenta cómo desplegar, reiniciar y mantener el backend en un Droplet de Digital Ocean usando **PM2** y **Caddy**.

---

## 📋 Requisitos Previos

- Droplet Ubuntu (22.04 LTS recomendado)
- Dominio apuntando a la IP del Droplet (ej: `apiwhatsapp.geniality.com.co`)
- MongoDB Atlas o instancia MongoDB accesible

---

## 🚀 Instalación Inicial (Primera vez)

### 1. Instalar Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Instalar PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

### 3. Instalar Caddy (HTTPS Server)
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 4. Instalar Dependencias de Chrome (para Puppeteer)
```bash
sudo apt-get update && sudo apt-get install -y \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
    libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 \
    libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils
```

---

## 📦 Despliegue del Backend

### 1. Clonar el Repositorio
```bash
cd ~
git clone https://github.com/tu-usuario/tu-repo.git
cd tu-repo/wa-multisession-backend
```

### 2. Instalar Dependencias
```bash
npm ci --omit=dev
```

### 3. Configurar Variables de Entorno
Crea el archivo `.env`:
```bash
nano .env
```

Contenido:
```env
PORT=3000
MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/whatsapp?retryWrites=true&w=majority
```

### 4. Iniciar con PM2
```bash
pm2 start server.js --name "whatsapp-api"
pm2 save
pm2 startup
```

Ejecuta el comando que PM2 te sugiera (empieza con `sudo env PATH=...`).

---

## 🌐 Configurar Caddy (HTTPS)

### 1. Crear Caddyfile
```bash
sudo nano /etc/caddy/Caddyfile
```

Contenido:
```text
{
    email contactogeniality@gmail.com
}

apiwhatsapp.geniality.com.co {
    reverse_proxy localhost:3000
}
```

### 2. Reiniciar Caddy
```bash
sudo systemctl reload caddy
```

Caddy obtendrá automáticamente un certificado SSL de Let's Encrypt.

---

## 🔄 Comandos de Mantenimiento

### Ver Estado del Backend
```bash
pm2 status
```

### Ver Logs en Tiempo Real
```bash
pm2 logs whatsapp-api
```

### Reiniciar el Backend
```bash
pm2 restart whatsapp-api
```

### Detener el Backend
```bash
pm2 stop whatsapp-api
```

### Reiniciar Caddy
```bash
sudo systemctl reload caddy
```

### Ver Logs de Caddy
```bash
sudo journalctl -u caddy --no-pager | tail -n 50
```

---

## 🔧 Actualizar el Código

```bash
cd ~/tu-repo/wa-multisession-backend
git pull origin main
npm ci --omit=dev
pm2 restart whatsapp-api
```

---

## 🆘 Troubleshooting

### El backend no arranca
```bash
pm2 logs whatsapp-api
# Busca errores de MongoDB, dependencias faltantes, etc.
```

### Caddy no obtiene certificado SSL
- Verifica que el dominio apunte correctamente a la IP del Droplet.
- Asegúrate de que Cloudflare (si lo usas) esté en modo **Full** SSL.
- Revisa logs: `sudo journalctl -u caddy -f`

### Error de librerías faltantes (Puppeteer)
Reinstala las dependencias de Chrome (ver paso 4 de instalación inicial).

---

## 📝 Notas Importantes

- **PM2** mantiene el backend corriendo incluso si crashea.
- **Caddy** renueva automáticamente los certificados SSL cada 90 días.
- Las sesiones de WhatsApp se guardan en **MongoDB** (RemoteAuth), por lo que sobreviven reinicios.
- Si cambias el `.env`, reinicia PM2: `pm2 restart whatsapp-api`.

---

¡Listo! 🎉
