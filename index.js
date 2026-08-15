const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const fs = require('fs');

let qrActual = '';

const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (!qrActual) {
        return res.end('<h2>¡Bot conectado y enfocado en Recargas Nexus!</h2>');
    }
    try {
        const qrImage = await QRCode.toDataURL(qrActual);
        res.end(`
            <html>
                <head><meta http-equiv="refresh" content="30"><title>QR Bot WhatsApp</title></head>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif;background:#111;color:#fff;">
                    <h2>Escanea este QR con tu WhatsApp:</h2>
                    <img src="${qrImage}" style="width:300px;height:300px;background:#fff;padding:10px;border-radius:10px;"/>
                    <p style="margin-top:20px;color:#aaa;">La página se actualiza sola cada 30 segundos.</p>
                </body>
            </html>
        `);
    } catch (err) {
        res.end('Generando QR...');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor web escuchando en el puerto ${PORT}`);
});

const MI_ID_JUGADOR = '1248591792';
const URL_REDIMIR = 'https://recargasnexus.net/redimir/';

// Canal oficial de Recargas Nexus ya configurado con su ID correcto
const CANAL_NEXUS_JID = '0029Vb2cjk5B4hdL1FMLfW0W@newsletter'; 

function resolveChromeExecutable() {
    return process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome';
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Mac OS', 'Chrome', '116.0.5845.187']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrActual = qr;
            console.log('Nuevo QR generado. Ábrelo en la URL de tu Render.');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            qrActual = '';
            console.log('¡Bot conectado y vigilando EXCLUSIVAMENTE el canal de Recargas Nexus!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid || '';
        
        // Filtro estricto: Solo acepta mensajes que vengan de ese canal específico
        if (remoteJid !== CANAL_NEXUS_JID) {
            return; 
        }

        const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
        const patron = /[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+|[A-Z0-9]{8,16}/gi;
        const codigos = texto.match(patron);

        if (codigos) {
            console.log(`¡Código detectado en el canal de Nexus! Procesando rápidamente...`);
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
            const btnFinal = await page.$('button[type="submit"]');
            if (btnFinal) await btnFinal.click();
            console.log(`¡Canje enviado con éxito para el PIN: ${codigo}!`);
        }
    } catch (e) {
        console.error('Error en canje:', e.message);
    } finally {
        if (browser) await browser.close();
    }
}

startBot();
