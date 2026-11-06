async function getAIResponse(prompt) {
    const groqKey = process.env.GROQ_API_KEY; 
    
    // 日志1：确认 Key 是否读取成功
    console.log("=== AI 唤醒了 ===");
    console.log("收到的 Prompt:", prompt);
    console.log("当前环境变量里是否有 Key:", groqKey ? "有" : "没有");

    if (!groqKey) {
        return "[Simulated AI] 没配置 Key。🐬";
    }

    try {
        const messages = [
            { role: "system", content: "你是赛博海豚。" },
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

        // 日志2：打印 HTTP 状态码
        console.log("Groq API 响应状态码:", response.status);

        const data = await response.json();
        
        // 日志3：如果失败，打印具体的错误原因
        if (!response.ok) {
            console.error("Groq API 报错详情:", data);
            return `[AI Error] Groq 返回错误: ${data.error?.message || response.status}`;
        }

        return data.choices[0].message.content;
    } catch (error) {
        console.error("网络请求异常:", error);
        return "[AI Error] 网络连接错误。";
    }
}
