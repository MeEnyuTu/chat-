const dgram = require('dgram');
const WebSocket = require('ws');

const UDP_PORT = 5005;
const WS_PORT = 8080;

const udpSocket = dgram.createSocket('udp4');
const wss = new WebSocket.Server({ port: WS_PORT });

// 存储连接的客户端信息：key 为 ws 实例，value 为用户设置 { nickname, nativeLang, codeLang }
const clients = new Map();

console.log(`[System] Server started. UDP: ${UDP_PORT}, WS: ${WS_PORT}`);

// ------------------ 模拟翻译引擎 ------------------
// 字典：为了演示，这里只写几个常用的中英词汇。真实场景可接入 API
const dictionary = {
    "zh-en": { "你好": "Hello", "你好世界": "Hello World", "今晚开黑吗": "Play games tonight?", "写代码": "write code", "牛逼": "awesome" },
    "en-zh": { "hello": "你好", "hello world": "你好世界", "play games tonight": "今晚开黑吗", "write code": "写代码", "awesome": "牛逼" }
};

function simpleTranslate(text, fromLang, toLang) {
    if (fromLang === toLang) return text;
    const key = `${fromLang}-${toLang}`;
    const dict = dictionary[key];
    
    if (dict) {
        // 简单匹配：如果输入完全匹配字典中的词，直接返回
        const lowerText = text.toLowerCase();
        if (dict[lowerText]) return dict[lowerText];
        
        // 如果句子包含字典中的词，进行简单的替换 (伪翻译)
        let translatedText = text;
        for (const [word, translation] of Object.entries(dict)) {
            const regex = new RegExp(word, 'gi');
            translatedText = translatedText.replace(regex, translation);
        }
        if (translatedText !== text) return translatedText + " [Auto]";
    }
    
    // 如果字典里没有，原样返回并加上标记
    return text + ` [Original ${fromLang.toUpperCase()}]`;
}
// --------------------------------------------------

function parseCodeToText(code, lang) {
    let match;
    code = code.trim();
    try {
        switch (lang) {
            case 'python': match = code.match(/print\s*\(\s*['"](.*?)['"]\s*\)/); break;
            case 'cpp': match = code.match(/cout\s*<<\s*['"](.*?)['"]/); break;
            case 'java': match = code.match(/System\.out\.print(?:ln)?\s*\(\s*['"](.*?)['"]\s*\)/); break;
            case 'js': match = code.match(/console\.log\s*\(\s*['"](.*?)['"]\s*\)/); break;
        }
    } catch (e) { return null; }
    return (match && match[1]) ? match[1] : null;
}

// UDP 广播处理
udpSocket.on('message', (msg) => {
    try {
        const data = JSON.parse(msg.toString('utf-8'));
        // 转发给所有 WS 客户端
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
        });
    } catch (err) {}
});

udpSocket.bind(UDP_PORT, () => udpSocket.setBroadcast(true));

// WebSocket 连接处理
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. 用户初始化设置
            if (data.type === 'init') {
                clients.set(ws, data.userConfig);
                console.log(`[User Connected] ${data.userConfig.nickname} (Lang: ${data.userConfig.nativeLang}, Code: ${data.userConfig.codeLang})`);
                return;
            }

            // 2. 代码聊天消息
            if (data.type === 'code') {
                const senderConfig = clients.get(ws);
                if (!senderConfig) return;

                const parsedText = parseCodeToText(data.text, senderConfig.codeLang);
                
                if (parsedText) {
                    // 遍历所有在线用户，根据他们的母语发送翻译后的消息
                    clients.forEach((receiverConfig, receiverWs) => {
                        if (receiverWs.readyState === WebSocket.OPEN) {
                            // 进行翻译：从发送者母语 -> 接收者母语
                            const translatedText = simpleTranslate(
                                parsedText, 
                                senderConfig.nativeLang, 
                                receiverConfig.nativeLang
                            );

                            const chatData = {
                                type: 'chat',
                                user: senderConfig.nickname,
                                codeLang: senderConfig.codeLang,
                                nativeLang: senderConfig.nativeLang,
                                originalCode: data.text,
                                originalText: parsedText,
                                translatedText: translatedText,
                                time: data.time
                            };

                            receiverWs.send(JSON.stringify(chatData));
                        }
                    });

                    // UDP 广播（简单转发原始数据）
                    const udpData = { type: 'chat', user: senderConfig.nickname, text: parsedText, time: data.time };
                    const buffer = Buffer.from(JSON.stringify(udpData));
                    udpSocket.send(buffer, 0, buffer.length, UDP_PORT, '255.255.255.255');

                } else {
                    // 解析失败
                    ws.send(JSON.stringify({
                        type: 'error',
                        text: `[Parse Error] 无法解析您的 ${senderConfig.codeLang.toUpperCase()} 代码。请确保使用了正确的打印语句，例如: print("你好")`
                    }));
                }
            }
        } catch (err) {
            console.error(err);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});
