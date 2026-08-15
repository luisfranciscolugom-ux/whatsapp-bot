const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const puppeteer = require('puppeteer');
const fs = require('fs');

// Servidor web simple para mantener Render activo
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bot activo: Escuchando mensajes de Recargas Nexus...');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor web activo en el puerto ${PORT}`);
});

// CONFIGURACIÓN PERSONALIZADA
const MI_ID_JUGADOR = '1248591792'; 
const URL_REDIMIR = 'https://recargasnexus.net/redimir/';
const NUMERO_TELEFONO = '584126307409'; 

function resolveChromeExecutable() {
    return process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome';
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    // Configurado como Mac para máxima compatibilidad
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Mac OS', 'Chrome', '116.0.5845.187']
    });

    sock.ev.on('creds.update', saveCreds);

    // Solicitar código de vinculación por número
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let codigo = await sock.requestPairingCode(NUMERO_TELEFONO);
                console.log(`\n========================================`);
                console.log(`TU CÓDIGO DE VINCULACIÓN: ${codigo}`);
                console.log(`========================================\n`);
            } catch (err) {
                console.error('Error al pedir código:', err);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('¡Bot conectado y vigilando PINs!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
        const patron = /[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+|[A-Z0-9]{8,16}/gi;
        const codigos = texto.match(patron);

        if (codigos) {
            for (let cod of codigos) {
                await canjearFlexile(cod.replace(/-/g, ''), MI_ID_JUGADOR);
            }
        }
    });
}

async function canjearFlexile(codigo, idJugador) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: resolveChromeExecutable(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote']
        });

        const page = await browser.newPage();
        await page.goto(URL_REDIMIR, { waitUntil: 'networkidle2', timeout: 30000 });

        const inputCodigo = await page.$('input[placeholder*="NEXUS"], input[placeholder*="odigo"], input[type="text"]');
        if (inputCodigo) await inputCodigo.type(codigo);

        const boton = await page.$('button, input[type="submit"]');
        if (boton) await boton.click();

        await new Promise(r => setTimeout(r, 2000));

        const inputID = await page.$('input[placeholder*="ID"], input[name*="id"]');
        if (inputID) {
            await inputID.type(idJugador);
            const botonFinal = await page.$('button[type="submit"]');
            if (botonFinal) await botonFinal.click();
            console.log(`Canje enviado para PIN: ${codigo}`);
        }
    } catch (e) {
        console.error('Error en canje:', e.message);
    } finally {
        if (browser) await browser.close();
    }
}

startBot();
