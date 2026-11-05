// ================= 全新升级的代码解析模块 =================
function parseCodeToText(code, lang) {
    // 去除前后空白，限制长度防 DoS
    code = code.trim();
    if (code.length > 500) return "Code too long!";
    
    let match = null;

    try {
        switch (lang) {
            case 'python':
                // 支持 print("..."), print('...'), 以及 f-string
                match = code.match(/print\s*\(\s*f?['"](.*?)['"]/s); 
                break;
            case 'c':
            case 'cpp':
                // 支持 cout << "..." 和 printf("...")
                match = code.match(/(?:cout\s*<<|printf\s*\()\s*['"](.*?)['"]/s);
                break;
            case 'csharp':
                // 支持 Console.WriteLine("..."), Console.Write("...")
                match = code.match(/Console\.Write(?:Line)?\s*\(\s*['"](.*?)['"]/s);
                break;
            case 'java':
                // 支持 System.out.println("...")
                match = code.match(/System\.out\.print(?:ln)?\s*\(\s*['"](.*?)['"]\s*\)/s);
                break;
            case 'js':
            case 'ts':
                // 支持 console.log("..."), console.log(`...`)
                match = code.match(/console\.log\s*\(\s*['"`](.*?)['"`]\s*\)/s);
                break;
            case 'go':
                // 支持 fmt.Println("...")
                match = code.match(/fmt\.Print(?:ln|f)?\s*\(\s*['"](.*?)['"]/s);
                break;
            case 'rust':
                // 支持 println!("...")
                match = code.match(/println!\s*\(\s*['"](.*?)['"]/s);
                break;
            case 'php':
                // 支持 echo "..."; 和 print("...");
                match = code.match(/(?:echo\s+|print\s*\()\s*['"](.*?)['"]/s);
                break;
            case 'ruby':
                // 支持 puts "..."
                match = code.match(/(?:puts|print)\s*['"](.*?)['"]/s);
                break;
            case 'shell':
                // 支持 echo "..."
                match = code.match(/echo\s*['"](.*?)['"]/s);
                break;
            case 'swift':
            case 'kotlin':
                // 支持 println("..."), print("...")
                match = code.match(/print(?:ln)?\s*\(\s*['"](.*?)['"]/s);
                break;
        }
    } catch (e) { return null; }
    
    return (match && match[1]) ? match[1] : null;
}
