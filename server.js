const chatHistory = [];
async function getAIResponse(prompt, retries = 2) {
    const openRouterKey = process.env.OPENROUTER_API_KEY; 
    
    if (!openRouterKey) {
        return "[Simulated AI] 哎呀，还没配置 OpenRouter API Key。请在 Render 配置 OPENROUTER_API_KEY。🐬";
    }

    try {
        const messages = [
            { 
                role: "system", 
                content: "你现在是极客聊天室的专属赛博管家。你极度聪明，脾气暴躁，极度讨厌蠢问题。老板是拿着 Flipper Zero 的 EnyuTu。别人问你问题，你要么用最简洁的一两句硬核代码给他解决，要么直接嘲讽他。每次回复不超过40个字，必须带一个 🐬。" 
            },
            ...chatHistory, 
            { role: "user", content: prompt }
        ];

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openRouterKey}`,
                "HTTP-Referer": "https://chat-w9w6.onrender.com", 
                "X-Title": "CodeChat"
            },
            body: JSON.stringify({
                model: "openrouter/free", 
                messages: messages,
                temperature: 0.7,
                max_tokens: 500 
            }),
            signal: controller.signal // 绑定超时信号
        });

        clearTimeout(timeoutId); // 请求成功，清除定时器

        const data = await response.json();
        
        if (!response.ok) {
            console.error("OpenRouter API 报错详情:", data);
            return `[AI Error] 接口拒绝回答: ${data.error?.message || response.status}`;
        }

        let reply = data.choices[0].message.content;
        if (reply.includes("<thought>")) {
            reply = reply.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
        }
        if (reply.includes("​")) {
            reply = reply.split("​").pop().trim();
        }

        return reply;
    } catch (error) {
        console.error("网络请求异常:", error);
        
        // 如果是超时或被主动中止，并且还有重试次数，则递归重试
        if ((error.name === 'AbortError' || error.message.includes('fetch failed')) && retries > 0) {
            console.log(`请求失败，正在重试... 剩余重试次数: ${retries}`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒再试
            return getAIResponse(prompt, retries - 1);
        }
        
        return "[AI Error] 网络连接错误，DeepSeek 正在思考中。";
    }
}
