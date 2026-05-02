import fs from 'fs';
let content = fs.readFileSync('server.ts', 'utf8');
content = content.replace(/io\.emit\('log',\s*(\{[\s\S]*?\})\);/g, 'emitLog($1);');
fs.writeFileSync('server.ts', content);
