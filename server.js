const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Render 会自动分配端口
const PORT = process.env.PORT || 8080;

// ------------------ 脏话过滤模块 (新增) ------------------
// 这里可以随时添加你不想看到的词
const badWords = [
    'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'dick', 'pussy', 
    '傻逼', 'sb', '操', '草泥马', '尼玛', '妈的', '狗日', '混蛋', '滚蛋'
];

function censorText(text) {
    let censored = text;
    badWords.forEach(word => {
        // 使用正则全局替换，忽略大小写 (gi)
        // 使用 'i' 可以匹配 Fuck、FUCK 等变体
        const regex = new RegExp(word, 'gi');
        // 替换为等长的星号，例如 fuck -> ****
        censored = censored.replace(regex, '*'.repeat(word.length));
    });
    return censored;
}
// ----------------------------------------------------------

// 翻译字典 (简单版)
const dictionary = {
    "zh-en": { "你好": "Hello", "你好世界": "Hello World" },
    "en-zh": { "hello": "你好", "hello world": "你好世界" }
};

function simpleTranslate(text, fromLang, toLang) {
    if (fromLang === toLang) return text;
    const dict = dictionary[`${fromLang}-${toLang}`];
    if (dict && dict[text.toLowerCase()]) return dict[text.toLowerCase()];
    return text + ` [Original ${fromLang.toUpperCase()}]`;
}

// 代码解析
function parseCodeToText(code, lang) {
    let match;
    code = code.trim();
    if (code.length > 500) return "Code too long!";
    
    try {
        switch (lang) {
            case 'python': match = code.match(/print\s*\(\s*['"](.*?)['"]\s*\)/s); break;
            case 'cpp': match = code.match(/cout\s*<<\s*['"](.*?)['"]/s); break;
            case 'java': match = code.match(/System\.out\.print(?:ln)?\s*\(\s*['"](.*?)['"]\s*\)/s); break;
            case 'js': match = code.match(/console\.log\s*\(\s*['"](.*?)['"]\s*\)/s); break;
        }
    } catch (e) { return null; }
    return (match && match[1]) ? match[1] : null;
}

const clients = new Map();

// 静态文件服务
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) { res.writeHead(500); res.end('Error loading HTML'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404); res.end();
    }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.userConfig = null;
    ws.lastMessageTime = 0;

    ws.on('message', (message) => {
        if (message.length > 2000) return;

        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                ws.userConfig = data.userConfig;
                clients.set(ws, data.userConfig);
                return;
            }

            if (data.type === 'code' && ws.userConfig) {
                // 限流 (1秒1条)
                const now = Date.now();
                if (now - ws.lastMessageTime < 1000) {
                    ws.send(JSON.stringify({ type: 'error', text: "发送太快啦！请稍后再试。" }));
                    return;
                }
                ws.lastMessageTime = now;

                let parsedText = parseCodeToText(data.text, ws.userConfig.codeLang);
                
                if (parsedText) {
                    // ==========================================
                    // 重点：在这里调用脏话过滤函数！
                    // 先过滤原始提取的文本，再去翻译
                    // ==========================================
                    parsedText = censorText(parsedText);

                    clients.forEach((receiverConfig, receiverWs) => {
                        if (receiverWs.readyState === WebSocket.OPEN) {
                            // XSS 防护
                            const safeCode = data.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                            const safeText = parsedText.replace(/</g, "&lt;").replace(/>/g, "&gt;");

                            const translatedText = simpleTranslate(
                                safeText, 
                                ws.userConfig.nativeLang, 
                                receiverConfig.nativeLang
                            );

                            receiverWs.send(JSON.stringify({
                                type: 'chat',
                                user: ws.userConfig.nickname,
                                codeLang: ws.userConfig.codeLang,
                                originalCode: safeCode,
                                originalText: safeText,
                                translatedText: translatedText,
                                time: data.time
                            }));
                        }
                    });
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        text: `[Parse Error] 无法解析您的 ${ws.userConfig.codeLang.toUpperCase()} 代码。`
                    }));
                }
            }
        } catch (err) {}
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

server.listen(PORT, () => {
    console.log(`[Cloud Server] Listening on port ${PORT}`);
});
