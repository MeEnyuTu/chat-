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

// ================= 14种语言的代码解析模块 =================
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

// ================= 🧠 专属 AI 管家 =================
const chatHistory = [];
async function getAIResponse(prompt) {
    // 直接读取 Render 的环境变量
    const groqKey = process.env.GROQ_API_KEY; 
    
    if (!groqKey) {
        return "[Simulated AI] 哎呀，还没配置 API Key。请在 Render 配置 GROQ_API_KEY。🐬";
    }

    try {
        const messages = [
            { 
                role: "system", 
                content: "你现在是极客聊天室的专属赛博管家，名字叫“Enyu的赛博海豚”。你的老板叫EnyuTu，他手里拿着Flipper Zero。你说话要简短、傲娇、喜欢用黑客术语。每次回复必须加一个 🐬 的emoji。如果别人骂你，你就嘲讽他代码全是Bug。" 
            },
            ...chatHistory, 
            { role: "user", content: prompt }
        ];

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${groqKey}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: messages,
                temperature: 0.7,
                max_tokens: 300
            })
        });

        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content;
        }
        return "[AI Error] 大脑短路了。";
    } catch (error) {
        console.error("AI API Error:", error);
        return "[AI Error] 网络连接错误，无法召唤管家。";
    }
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

    ws.on('message', async (message) => {
        if (message.length > 2000) return;

        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                ws.userData.config = data.userConfig;
                clients.set(ws, ws.userData);
                setTimeout(() => {
                    const aiData = { type: 'chat', user: "DeepSeek", userCredits: "∞", codeLang: "AI", originalCode: "", originalText: `欢迎极客 @${data.userConfig.nickname} 接入系统！🐬`, time: new Date().toTimeString().split(' ')[0] };
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(aiData));
                }, 1000);
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

                    if (parsedText.startsWith('/ai ') || parsedText.startsWith('@DeepSeek ')) {
                        const prompt = parsedText.replace(/^(\/ai |@DeepSeek )/, '');
                        broadcastToAll(ws, data, parsedText, true);

                        const aiReply = await getAIResponse(prompt);
                        
                        const aiData = { type: 'chat', user: "DeepSeek", userCredits: "∞", codeLang: "AI", originalCode: `// AI Response`, originalText: aiReply, time: new Date().toTimeString().split(' ')[0] };
                        clients.forEach((c, clientWs) => {
                            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(aiData));
                        });

                        chatHistory.push({ role: "user", content: `[${ws.userData.config.nickname}]: ${prompt}` });
                        chatHistory.push({ role: "assistant", content: aiReply });
                        if (chatHistory.length > 10) chatHistory.splice(0, 2);
                        return;
                    }

                    chatHistory.push({ role: "user", content: `[${ws.userData.config.nickname}]: ${parsedText}` });
                    if (chatHistory.length > 10) chatHistory.splice(0, 2);

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

                    broadcastToAll(ws, data, parsedText, true);
                } else {
                    ws.send(JSON.stringify({ type: 'error', text: `[Parse Error] 无法解析您的 ${ws.userData.config.codeLang.toUpperCase()} 代码。` }));
                }
            }
        } catch (err) { console.error(err); }
    });

    ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, () => console.log(`[Cloud Server] Listening on port ${PORT}`));
