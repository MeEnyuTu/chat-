const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// ================= 真实整句翻译引擎 =================
async function translateText(text, fromLang, toLang) {
    if (fromLang === toLang || !text.trim()) return text;
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;
        // 增加 5 秒超时控制，防止翻译接口卡死导致聊天室卡顿
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await response.json();
        
        if (data && data.responseData && data.responseData.translatedText) {
            if (data.responseData.translatedText.includes("MYMEMORY WARNING")) {
                return text;
            }
            return data.responseData.translatedText;
        }
        return text;
    } catch (error) {
        console.error("翻译请求失败或超时:", error.message);
        return text; 
    }
}

// ================= 脏话过滤模块 =================
const badWords = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', '傻逼', 'sb', '操', '草泥马', '妈的'];
function censorText(text) {
    let censored = text;
    badWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        censored = censored.replace(regex, '*'.repeat(word.length));
    });
    return censored;
}

// ================= 14种编程语言的代码解析模块 (超级兼容版) =================
function parseCodeToText(code, lang) {
    code = code.trim();
    if (code.length > 500) return "Code too long!";
    let match = null;
    
    // 兼容全角引号 “ ” 和半角引号 " '，忽略大小写 (i)
    const openQ = `['"“]`;
    const closeQ = `['"”]`;
    
    try {
        switch (lang) {
            case 'python': match = code.match(new RegExp(`print\\s*\\(\\s*f?${openQ}(.*?)${closeQ}`, 'is')); break;
            case 'c': case 'cpp': match = code.match(new RegExp(`(?:cout\\s*<<|printf\\s*\\()\\s*${openQ}(.*?)${closeQ}`, 'is')); break;
            case 'csharp': match = code.match(new RegExp(`Console\\.Write(?:Line)?\\s*\\(\\s*${openQ}(.*?)${closeQ}`, 'is')); break;
            case 'java': match = code.match(new RegExp(`System\\.out\\.print(?:ln)?\\s*\\(\\s*${openQ}(.*?)${closeQ}\\s*\\)`, 'is')); break;
            case 'js': case 'ts': match = code.match(new RegExp(`console\\.log\\s*\\(\\s*[\`"“](.*?)['"\`”]\\s*\\)`, 'is')); break;
            case 'go': match = code.match(new RegExp(`fmt\\.Print(?:ln|f)?\\s*\\(\\s*${openQ}(.*?)${closeQ}`, 'is')); break;
            case 'rust': match = code.match(new RegExp(`println!\\s*\\(\\s*${openQ}(.*?)${closeQ}`, 'is')); break;
            case 'php': match = code.match(new RegExp(`(?:echo\\s+|print\\s*\\()\\s*${openQ}(.*?)${closeQ}`, 'is')); break;
            case 'ruby': match = code.match(new RegExp(`(?:puts|print)\\s*${openQ}(.*?)${closeQ}`, 'is')); break;
            case 'shell': match = code.match(new RegExp(`echo\\s*${openQ}(.*?)${closeQ}`, 'is')); break;
            case 'swift': case 'kotlin': match = code.match(new RegExp(`print(?:ln)?\\s*\\(\\s*${openQ}(.*?)${closeQ}`, 'is')); break;
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

async function broadcastToAll(senderWs, rawData, parsedText, includeCredits) {
    const senderConfig = senderWs.userData.config;

    for (const [receiverWs, receiverData] of clients.entries()) {
        if (receiverWs.readyState === WebSocket.OPEN && receiverData.config) {
            const safeCode = rawData.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const safeText = parsedText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            
            const translatedText = await translateText(safeText, senderConfig.nativeLang, receiverData.config.nativeLang);

            receiverWs.send(JSON.stringify({
                type: 'chat',
                user: senderConfig.nickname,
                userCredits: includeCredits ? senderWs.userData.credits : undefined,
                codeLang: senderConfig.codeLang,
                originalCode: safeCode,
                originalText: safeText,
                translatedText: translatedText,
                time: rawData.time
            }));
        }
    }
}

wss.on('connection', (ws) => {
    ws.userData = { config: null, credits: 0, lastMessageTime: 0 };

    ws.on('message', async (message) => { 
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

                    await broadcastToAll(ws, data, parsedText, true);
                } else {
                    // 升级版错误提示，告知用户可能是语言选错或引号问题
                    ws.send(JSON.stringify({ type: 'error', text: `[Parse Error] 无法解析您的代码。请检查：1. 您当前选中的语言是否为 ${ws.userData.config.codeLang.toUpperCase()}；2. 是否使用了正确的语法（如 print("hello")）；3. 请务必使用英文半角引号。` }));
                }
            }
        } catch (err) { console.error(err); }
    });

    ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, '0.0.0.0', () => console.log(`[Cloud Server] Listening on port ${PORT}`));
