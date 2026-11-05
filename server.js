const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// ================= 翻译与过滤模块 =================
const dictionary = {
    "zh-en": { "你好": "Hello", "你好世界": "Hello World", "牛逼": "awesome" },
    "en-zh": { "hello": "你好", "hello world": "你好世界", "awesome": "牛逼" }
};
function simpleTranslate(text, fromLang, toLang) {
    if (fromLang === toLang) return text;
    const dict = dictionary[`${fromLang}-${toLang}`];
    if (dict && dict[text.toLowerCase()]) return dict[text.toLowerCase()];
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

// ================= 代码解析模块 =================
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

// ================= 服务器与 WebSocket =================
const clients = new Map(); // ws -> { config, credits, lastMessageTime }

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
    ws.userData = { config: null, credits: 0, lastMessageTime: 0 };

    ws.on('message', (message) => {
        if (message.length > 2000) return;

        try {
            const data = JSON.parse(message);

            // 初始化用户
            if (data.type === 'init') {
                ws.userData.config = data.userConfig;
                clients.set(ws, ws.userData);
                return;
            }

            // 处理聊天代码
            if (data.type === 'code' && ws.userData.config) {
                const now = Date.now();
                if (now - ws.userData.lastMessageTime < 1000) {
                    ws.send(JSON.stringify({ type: 'error', text: "发送太快啦！请稍后再试。" }));
                    return;
                }
                ws.userData.lastMessageTime = now;

                let parsedText = parseCodeToText(data.text, ws.userData.config.codeLang);
                
                if (parsedText) {
                    // 1. 脏话过滤
                    parsedText = censorText(parsedText);
                    
                    // 2. 积分增加
                    ws.userData.credits += 2;

                    // 3. 处理系统指令
                    if (data.text.includes('/top')) {
                        const sortedUsers = Array.from(clients.values())
                            .filter(u => u.config)
                            .sort((a, b) => b.credits - a.credits)
                            .slice(0, 5);
                        
                        let lbText = "=== 🏆 极客积分排行榜 ===\n";
                        sortedUsers.forEach((u, index) => {
                            lbText += `${index + 1}. ${u.config.nickname}: ${u.credits} 分\n`;
                        });
                        
                        ws.send(JSON.stringify({
                            type: 'chat', user: "SYSTEM", originalCode: data.text,
                            originalText: lbText, time: data.time
                        }));
                        return;
                    }

                    if (data.text.includes('/credits')) {
                        const creditsText = "=== 💻 CodeChat Credits ===\n" +
                            "👑 Creator: EnyuTu\n" +
                            "🤖 Debug Helper: DeepSeek AI\n" +
                            "⚙️ Stack: Node.js + WebSockets\n" +
                            "---------------------------\n" +
                            "Shout out to all the geeks! :)";
                        ws.send(JSON.stringify({
                            type: 'chat', user: "SYSTEM", originalCode: data.text,
                            originalText: creditsText, time: data.time
                        }));
                        return;
                    }

                    if (data.text.includes('/flipper')) {
                        const flipperArt = 
"_.-------.._                    -,\n" +
"  .-\"```\"--..,,_/ /`-,               -,  \\ \n" +
".:\"          /:/  /'\\  \\     ,_...,  `. |  |\n" +
"/       ,----/:/  /`\\ _\\~`_-\"`     _;\n" +
"'      / /`\"\"\"'\\ \\ \\.~`_-'      ,-\"'/ \n" +
"|      | |  0    | | .-'      ,/`  /\n" +
"|    ,..\\ \\     ,.-\"`       ,/`    /\n" +
";    :    `/`\"\"\\`           ,/--==,/-----,\n" +
"|    `-...|        -.___-Z:_______J...---;\n" +
":         `                           _-'\n" +
"_L_  _     ___  ___  ___  ___  ____--\"`___  _     ___";
                        ws.send(JSON.stringify({
                            type: 'chat', user: "FLIPPER", originalCode: data.text,
                            originalText: flipperArt, time: data.time
                        }));
                        return;
                    }

                    // 4. Shout Out 检测 (@用户名)
                    const mentionRegex = /@(\w+)/g;
                    let mentionMatch;
                    const mentionedUsers = [];
                    while ((mentionMatch = mentionRegex.exec(parsedText)) !== null) {
                        mentionedUsers.push(mentionMatch[1]);
                    }

                    if (mentionedUsers.length > 0) {
                        clients.forEach((receiverData, receiverWs) => {
                            if (receiverWs.readyState === WebSocket.OPEN && 
                                receiverData.config &&
                                mentionedUsers.includes(receiverData.config.nickname)) {
                                receiverWs.send(JSON.stringify({
                                    type: 'shoutout_alert',
                                    from: ws.userData.config.nickname,
                                    text: parsedText
                                }));
                            }
                        });
                    }

                    // 5. 广播消息给所有人
                    clients.forEach((receiverData, receiverWs) => {
                        if (receiverWs.readyState === WebSocket.OPEN && receiverData.config) {
                            const safeCode = data.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                            const safeText = parsedText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                            
                            const translatedText = simpleTranslate(
                                safeText, 
                                ws.userData.config.nativeLang, 
                                receiverData.config.nativeLang
                            );

                            receiverWs.send(JSON.stringify({
                                type: 'chat',
                                user: ws.userData.config.nickname,
                                userCredits: ws.userData.credits,
                                codeLang: ws.userData.config.codeLang,
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
                        text: `[Parse Error] 无法解析您的 ${ws.userData.config.codeLang.toUpperCase()} 代码。请使用正确的打印语法。`
                    }));
                }
            }
        } catch (err) { }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

server.listen(PORT, () => {
    console.log(`[Cloud Server] Listening on port ${PORT}`);
});
