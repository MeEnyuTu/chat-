const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// ================= 多语言翻译与过滤模块 =================
// 多语言基础词典 (以英文为基准桥梁，支持中、日、韩、法、德、西、俄)
const langDict = {
    "hello": { zh: "你好", ja: "こんにちは", ko: "안녕하세요", fr: "bonjour", de: "hallo", es: "hola", ru: "привет" },
    "world": { zh: "世界", ja: "世界", ko: "세계", fr: "monde", de: "welt", es: "mundo", ru: "мир" },
    "good": { zh: "好", ja: "良い", ko: "좋은", fr: "bon", de: "gut", es: "bueno", ru: "хорошо" },
    "code": { zh: "代码", ja: "コード", ko: "코드", fr: "code", de: "code", es: "código", ru: "код" },
    "awesome": { zh: "牛逼", ja: "素晴らしい", ko: "대단한", fr: "génial", de: "großartig", es: "increíble", ru: "потрясающе" },
    "goodbye": { zh: "再见", ja: "さようなら", ko: "안녕히 가세요", fr: "au revoir", de: "auf wiedersehen", es: "adiós", ru: "до свидания" },
    "hacker": { zh: "黑客", ja: "ハッカー", ko: "해커", fr: "pirate", de: "hacker", es: "hacker", ru: "хакер" }
};

function simpleTranslate(text, fromLang, toLang) {
    if (fromLang === toLang) return text;
    
    let translated = text;
    const lowerText = text.toLowerCase().trim();
    
    // 遍历多语言词典尝试翻译
    for (const [enWord, translations] of Object.entries(langDict)) {
        // 如果是英文，直接看目标语言
        if (fromLang === 'en' && lowerText === enWord) {
            return translations[toLang] || text;
        }
        
        // 如果是从其他语言翻译
        if (translations[fromLang] && lowerText === translations[fromLang].toLowerCase()) {
            // 如果目标是英文，返回英文
            if (toLang === 'en') return enWord;
            // 如果目标是其他语言，通过英文作为桥梁返回对应翻译
            if (translations[toLang]) return translations[toLang];
        }
    }
    
    // 如果没在词典里找到，原样返回并带上原始语言标签
    return text + ` [Original ${fromLang.toUpperCase()}]`;
}

const badWords = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', '傻逼', 'sb', '操', '草泥马', '妈的'];
function censorText(text) {
    let censored = text;
    badWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        censored = censored.replace(regex, '*'.repeat(word.length));
    });
    return censored;
}

// ================= 14种编程语言的代码解析模块 =================
function parseCodeToText(code, lang) {
    code = code.trim();
    if (code.length > 500) return "Code too long!";
    let match = null;
    try {
        switch (lang) {
            case 'python': match = code.match(/print\s*\(\s*f?['"](.*?)['"]/s); break;
            case 'c': case 'cpp': match = code.match(/(?:cout\s*<<|printf\s*\()\s*['"](.*?)['"]/s); break;
            case 'csharp': match = code.match(/Console\.Write(?:Line)?\s*\(\s*['"](.*?)['"]/s); break;
            case 'java': match = code.match(/System\.out\.print(?:ln)?\s*\(\s*['"](.*?)['"]\s*\)/s); break;
            case 'js': case 'ts': match = code.match(/console\.log\s*\(\s*['"`](.*?)['"`]\s*\)/s); break;
            case 'go': match = code.match(/fmt\.Print(?:ln|f)?\s*\(\s*['"](.*?)['"]/s); break;
            case 'rust': match = code.match(/println!\s*\(\s*['"](.*?)['"]/s); break;
            case 'php': match = code.match(/(?:echo\s+|print\s*\()\s*['"](.*?)['"]/s); break;
            case 'ruby': match = code.match(/(?:puts|print)\s*['"](.*?)['"]/s); break;
            case 'shell': match = code.match(/echo\s*['"](.*?)['"]/s); break;
            case 'swift': case 'kotlin': match = code.match(/print(?:ln)?\s*\(\s*['"](.*?)['"]/s); break;
        }
    } catch (e) { return null; }
    return (match && match[1]) ? match[1] : null;
}

// ================= 广播与服务器 =================
const clients = new Map(); 
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) { res.writeHead(500); res.end('Error loading HTML'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else if (req.url === '/my-avatar.jpg') {
        fs.readFile(path.join(__dirname, 'my-avatar.jpg'), (err, data) => {
            if (err) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': 'image/jpeg' });
            res.end(data);
        });
    } else {
        res.writeHead(404); res.end();
    }
});

const wss = new WebSocket.Server({ server });

function broadcastToAll(senderWs, rawData, parsedText, includeCredits) {
    clients.forEach((receiverData, receiverWs) => {
        if (receiverWs.readyState === WebSocket.OPEN && receiverData.config) {
            const safeCode = rawData.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const safeText = parsedText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const translatedText = simpleTranslate(safeText, senderWs.userData.config.nativeLang, receiverData.config.nativeLang);

            receiverWs.send(JSON.stringify({
                type: 'chat',
                user: senderWs.userData.config.nickname,
                userCredits: includeCredits ? senderWs.userData.credits : undefined,
                codeLang: senderWs.userData.config.codeLang,
                originalCode: safeCode,
                originalText: safeText,
                translatedText: translatedText,
                time: rawData.time
            }));
        }
    });
}

wss.on('connection', (ws) => {
    ws.userData = { config: null, credits: 0, lastMessageTime: 0 };

    ws.on('message', (message) => {
        if (message.length > 2000) return;

        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                ws.userData.config = data.userConfig;
                clients.set(ws, ws.userData);
                return;
            }

            if (data.type === 'code' && ws.userData.config) {
                const now = Date.now();
                if (now - ws.userData.lastMessageTime < 1000) {
                    ws.send(JSON.stringify({ type: 'error', text: "发送太快啦！请稍后再试。" }));
                    return;
                }
                ws.userData.lastMessageTime = now;

                let parsedText = parseCodeToText(data.text, ws.userData.config.codeLang);
                
                if (parsedText) {
                    parsedText = censorText(parsedText);
                    ws.userData.credits += 2;

                    // 系统指令处理
                    if (data.text.includes('/top')) {
                        const sortedUsers = Array.from(clients.values()).filter(u => u.config).sort((a, b) => b.credits - a.credits).slice(0, 5);
                        let lbText = "=== 🏆 极客积分排行榜 ===\n";
                        sortedUsers.forEach((u, index) => { lbText += `${index + 1}. ${u.config.nickname}: ${u.credits} 分\n`; });
                        ws.send(JSON.stringify({ type: 'chat', user: "SYSTEM", originalCode: data.text, originalText: lbText, time: data.time }));
                        return;
                    }
                    if (data.text.includes('/credits')) {
                        const creditsText = "=== 💻 CodeChat Credits ===\n👑 Creator: EnyuTu\n🤖 Debug Helper: DeepSeek AI\n⚙️ Stack: Node.js + WebSockets\nShout out to all the geeks! :)";
                        ws.send(JSON.stringify({ type: 'chat', user: "SYSTEM", originalCode: data.text, originalText: creditsText, time: data.time }));
                        return;
                    }
                    if (data.text.includes('/flipper')) {
                        const flipperArt = "_.-------.._                    -,\n  .-\"```\"--..,,_/ /`-,               -,  \\ \n.:\"          /:/  /'\\  \\     ,_...,  `. |  |\n/       ,----/:/  /`\\ _\\~`_-\"`     _;\n'      / /`\"\"\"'\\ \\ \\.~`_-'      ,-\"'/ \n|      | |  0    | | .-'      ,/`  /\n|    ,..\\ \\     ,.-\"`       ,/`    /\n;    :    `/`\"\"\\`           ,/--==,/-----,\n|    `-...|        -.___-Z:_______J...---;\n:         `                           _-'\n_L_  _     ___  ___  ___  ___  ____--\"`___  _     ___";
                        ws.send(JSON.stringify({ type: 'chat', user: "FLIPPER", originalCode: data.text, originalText: flipperArt, time: data.time }));
                        return;
                    }

                    // Shout Out 检测
                    const mentionRegex = /@(\w+)/g;
                    let mentionMatch;
                    const mentionedUsers = [];
                    while ((mentionMatch = mentionRegex.exec(parsedText)) !== null) { mentionedUsers.push(mentionMatch[1]); }
                    if (mentionedUsers.length > 0) {
                        clients.forEach((receiverData, receiverWs) => {
                            if (receiverWs.readyState === WebSocket.OPEN && receiverData.config && mentionedUsers.includes(receiverData.config.nickname)) {
                                receiverWs.send(JSON.stringify({ type: 'shoutout_alert', from: ws.userData.config.nickname, text: parsedText }));
                            }
                        });
                    }

                    broadcastToAll(ws, data, parsedText, true);
                } else {
                    ws.send(JSON.stringify({ type: 'error', text: `[Parse Error] 无法解析您的 ${ws.userData.config.codeLang.toUpperCase()} 代码。` }));
                }
            }
        } catch (err) { console.error(err); }
    });

    ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, '0.0.0.0', () => console.log(`[Cloud Server] Listening on port ${PORT}`));
