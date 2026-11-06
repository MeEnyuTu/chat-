const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// ================= 真实整句翻译引擎 =================
async function translateText(text, fromLang, toLang) {
    if (fromLang === toLang) return text;
    try {
        // 使用免密的 Google Translate 免费接口
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        const data = await response.json();
        
        // 解析 Google 返回的嵌套数组
        if (data && data[0] && Array.isArray(data[0])) {
            return data[0].map(item => item[0]).join('');
        }
        return text;
    } catch (error) {
        console.error("翻译请求失败:", error);
        return text; // 如果翻译挂了，就降级返回原文本
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

// 注意：因为涉及到翻译，这里改成了 async 函数
async function broadcastToAll(senderWs, rawData, parsedText, includeCredits) {
    const senderConfig = senderWs.userData.config;

    for (const [receiverWs, receiverData] of clients.entries()) {
        if (receiverWs.readyState === WebSocket.OPEN && receiverData.config) {
            const safeCode = rawData.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const safeText = parsedText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            
            // 如果接收者语言和发送者语言不同，进行整句真实翻译
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

    ws.on('message', async (message) => { // 这里加上了 async
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

                    // 系统指令处理 (系统指令不翻译，且不需要 await)
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

                    // 广播消息 (注意这里加了 await)
                    await broadcastToAll(ws, data, parsedText, true);
                } else {
                    ws.send(JSON.stringify({ type: 'error', text: `[Parse Error] 无法解析您的 ${ws.userData.config.codeLang.toUpperCase()} 代码。` }));
                }
            }
        } catch (err) { console.error(err); }
    });

    ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, '0.0.0.0', () => console.log(`[Cloud Server] Listening on port ${PORT}`));
