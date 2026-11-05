const dgram = require('dgram');
const WebSocket = require('ws');

const UDP_PORT = 5005;
const WS_PORT = 8080;

const udpSocket = dgram.createSocket('udp4');

const wss = new WebSocket.Server({ port: WS_PORT });

console.log(`[UDP] Listening on port ${UDP_PORT}`);
console.log(`[WS] WebSocket Server running on ws://localhost:${WS_PORT}`);

udpSocket.on('message', (msg, rinfo) => {
    try {
        const msgStr = msg.toString('utf-8');
        const data = JSON.parse(msgStr);
        

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    } catch (err) {
    
    }
});

udpSocket.on('listening', () => {
    udpSocket.setBroadcast(true);
});

udpSocket.bind(UDP_PORT, () => {
    console.log(`[UDP] Bound to port ${UDP_PORT}`);
});

wss.on('connection', (ws) => {
    console.log('[WS] New client connected');

    ws.on('message', (message) => {
        try {
           
            const data = JSON.parse(message);
            const msgBuffer = Buffer.from(JSON.stringify(data));
            
            udpSocket.send(msgBuffer, 0, msgBuffer.length, UDP_PORT, '255.255.255.255', (err) => {
                if (err) console.error("UDP Send Error:", err);
            });
        } catch (err) {
            console.error("Error parsing WS message:", err);
        }
    });

    ws.on('close', () => {
        console.log('[WS] Client disconnected');
    });
});
