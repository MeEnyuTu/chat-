const dgram = require('dgram'); // 你的 UDP 框架
const WebSocket = require('ws');

// 你的端口定义
const UDP_PORT = 5005;
const WS_PORT = 8080;

// 1. 复刻你的 Python 代码创建 UDP Socket
const udpSocket = dgram.createSocket('udp4');
const wss = new WebSocket.Server({ port: WS_PORT });

// 2. 接收你 Python 脚本发来的广播
udpSocket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf-8');
    console.log(`[UDP 收到] 来自 ${rinfo.address}: ${text}`);
    
    // 转发给网页（WebSocket）
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ user: "Python终端", text: text, type: 'chat' }));
        }
    });
});

// 3. 绑定 5005 端口 (对应你的 BROADCAST_PORT)
udpSocket.bind(UDP_PORT, () => {
    udpSocket.setBroadcast(true); // 对应你的 sock.setsockopt
    console.log(`[UDP 框架] 正在监听端口 ${UDP_PORT}`);
});

// 4. 网页发来的消息，通过你的 UDP 框架广播出去
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'code') {
            // 简单提取一下代码里的文本
            let text = "未知消息";
            const match = data.text.match(/['"](.*?)['"]/); // 简单正则提取
            if (match && match[1]) text = match[1];

            // 构建你的 Python 脚本能收到的裸文本
            const fullMsg = `[${data.user}] ${text}`;
            const buffer = Buffer.from(fullMsg);

            // 对应你的 sock.sendto(..., ('255.255.255.255', 5005))
            udpSocket.send(buffer, 0, buffer.length, UDP_PORT, '255.255.255.255', (err) => {
                if (err) console.error(err);
            });
        }
    });
});
