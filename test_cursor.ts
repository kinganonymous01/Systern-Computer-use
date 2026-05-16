import { Sandbox } from '@e2b/desktop';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.AI_API_KEY });
  const activeSandbox = await Sandbox.create({ timeoutMs: 300_000 });
  await activeSandbox.stream.start();
  
  await activeSandbox.moveMouse(512, 384);
  const screenshotBuf = await activeSandbox.screenshot();
  const base64Image = Buffer.from(screenshotBuf).toString('base64');
  
  const res = await ai.models.generateContent({
    model: 'gemini-1.5-pro',
    contents: [{
      role: 'user',
      parts: [
        { text: "This is a screenshot of a desktop. Look closely at the exact center of the screen. Do you see a mouse cursor/pointer (like an arrow). Answer yes or no, and describe the cursor if you see it." },
        { inlineData: { mimeType: 'image/png', data: base64Image } }
      ]
    }]
  });
  
  console.log("Model response about cursor:", res.text);
  
  await activeSandbox.kill();
}

main().catch(console.error);
