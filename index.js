const { makeWASocket, useMultiFileAuthState, DisconnectReason,getContentType } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const fs = require('fs');

let qrActual = '';

// Servidor web básico para mantener Render activo gratis
const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (!qrActual) {
        return res.end('<h2>¡Bot conectado correctamente! Si ya vinculaste, puedes cerrar esta pestaña.</h2>');
    }
    const qrImage = await QRCode.toDataURL(qrActual);
    res.end(`
        <html>
            <head><meta http-equiv="refresh" content="3"><title>QR Bot WhatsApp</title></head>
            <body style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif;">
                <h2>Escanea este QR con tu WhatsApp:</h2>
                <img src="${qrImage}" style="width:300px;height:300px;"/>
                <p>La página se actualiza sola cada 3 segundos.</p>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor web escuchando en el puerto ${PORT}`);
});

const MI_ID_JUGADOR = '1248591792';
const URL_REDIMIR = 'https://recargasnexus.net/redimir/';

// Función para ubicar el binario de Chrome compatible con Render
function resolveChromeExecutable() {
    const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome'
    ].filter(Boolean);
    return candidates.find(candidate => fs.existsSync(candidate)) || undefined;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '105.0.5195.125']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrActual = qr;
            console.log('Nuevo QR generado:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            qrActual = '';
            console.log('¡Bot conectado exitosamente y listo para cazar PINs de RECARGAS NEXUS!');
        }
    });

    // Lector de mensajes robusto y corregido para Baileys
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            // Extraer el texto correctamente sin importar si viene de un chat normal, grupo o canal
            const type = getContentType(msg.message);
            let texto = '';
            
            if (type === 'conversation') {
                texto = msg.message.conversation;
            } else if (type === 'extendedTextMessage') {
                texto = msg.message.extendedTextMessage?.text;
            } else if (type === 'imageMessage' || type === 'videoMessage') {
                texto = msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
            }

            if (!texto) return;

            const remoteJid = msg.key.remoteJid || '';
            console.log(`Mensaje capturado de [${remoteJid}]: "${texto}"`);

            // Filtrar o procesar si pertenece a Nexus o lee cualquier mensaje en busca de patrones de PIN
            const patronCodigo = /[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+|[A-Z0-9]{8,16}/gi;
            const codigos = texto.match(patronCodigo);

            if (codigos && codigos.length > 0) {
                console.log(`¡Se encontraron ${codigos.length} códigos/PINs potenciales!`);

                for (let i = 0; i < codigos.length; i++) {
                    const codigoLimpio = codigos[i].replace(/-/g, '');
                    console.log(`--- [Código ${i + 1} de ${codigos.length}] Procesando PIN: ${codigoLimpio} ---`);
                    await canjearFlexile(codigoLimpio, MI_ID_JUGADOR);
                }
            }
        } catch (err) {
            console.error('Error procesando mensaje entrante:', err.message);
        }
    });
}

// Función automatizada con Puppeteer optimizada para Render
async function canjearFlexile(codigo, idJugador) {
    let browser;
    try {
        console.log(`[Paso 1] Abriendo navegador para canjear el PIN: ${codigo}...`);
        const executablePath = resolveChromeExecutable();
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: executablePath,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--single-process',
                '--no-zygote'
            ]
        });

        const page = await browser.newPage();
        await page.goto(URL_REDIMIR, { waitUntil: 'networkidle2', timeout: 30000 });

        // Buscar input de código con múltiples selectores de respaldo
        const inputCodigo = await page.$('input[placeholder*="NEXUS"], input[placeholder*="odigo"], input[placeholder*="Código"], input[type="text"]');
        if (inputCodigo) {
            await inputCodigo.type(codigo);
            console.log(`[Paso 1] PIN (${codigo}) escrito en la página.`);
        } else {
            const todosInputs = await page.$$('input:not([type="hidden"])');
            if (todosInputs.length > 0) await todosInputs[0].type(codigo);
        }

        // Presionar botón de verificar
        const botonVerificar = await page.$('button, input[type="submit"]');
        if (botonVerificar) {
            await botonVerificar.click();
            console.log('[Paso 1] Botón de verificación presionado.');
        }

        await new Promise(r => setTimeout(r, 2000));

        // Buscar casilla de ID de jugador
        const inputID = await page.$('input[placeholder*="ID"], input[placeholder*="id"], input[name*="id"], input[type="number"]');

        if (inputID) {
            console.log(`[Paso 2] Casilla de ID detectada. Ingresando tu ID: ${idJugador}...`);
            await inputID.type(idJugador);

            const botonFinal = await page.$('button[type="submit"], input[type="submit"], button');
            if (botonFinal) {
                await botonFinal.click();
                console.log(`[Paso 2] ¡Canje enviado con éxito para el PIN ${codigo}!`);
                await new Promise(r => setTimeout(r, 1500));
            }
        } else {
            console.log(`[Paso 2] No se solicitó ID o el código ya fue redimido / es inválido.`);
        }

    } catch (error) {
        console.error(`Error crítico ejecutando Puppeteer para el PIN ${codigo}:`, error.message);
    } finally {
        if (browser) await browser.close();
    }
}

startBot();
