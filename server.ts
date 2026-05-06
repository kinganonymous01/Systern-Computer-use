import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import path from 'path';
import { Sandbox } from '@e2b/desktop';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

// Ensure required variables
if (!process.env.AI_API_KEY) {
  console.warn("WARNING: AI_API_KEY is not set.");
}
if (!process.env.E2B_API_KEY) {
  console.warn("WARNING: E2B_API_KEY is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.AI_API_KEY });
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

app.use(express.json());

const PORT = 3000;

let activeSandbox: Sandbox | null = null;
let isAgentRunning = false;
let currentTask = "";
let serverLogs: { type: string; message: string }[] = [];

// ...

function emitLog(payload: { type: string; message: string }) {
  serverLogs.push(payload);
  if (serverLogs.length > 200) serverLogs.shift();
  io.emit('log', payload);
}

function getExactError(err: any): string {
  if (typeof err === 'string') return err;
  let errorDetails = err.message || '';
  if (err.stack) {
    errorDetails += `\nStack trace: ${err.stack}`;
  }
  if (typeof err === 'object') {
    try {
      const extraProps = Object.getOwnPropertyNames(err).filter(p => p !== 'stack' && p !== 'message');
      if (extraProps.length > 0) {
        const extraObj: any = {};
        extraProps.forEach(p => extraObj[p] = err[p]);
        errorDetails += `\nError details: ${JSON.stringify(extraObj, null, 2)}`;
      }
    } catch(e){}
  }
  return errorDetails;
}

const tools = [
  {
    name: 'mouse_move',
    description: 'Move the mouse cursor to a specific exact pixel coordinate. Standard screen resolution is 1024x768. Top-left is 0,0. Bottom-right is 1024,768.',
    parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }
  },
  {
    name: 'mouse_click',
    description: 'Click the mouse at the current position. Use left, right, or middle.',
    parameters: { type: 'object', properties: { button: { type: 'string', enum: ['left', 'right', 'middle'] }, doubleClick: { type: 'boolean' } } }
  },
  {
    name: 'keyboard_type',
    description: 'Type a string of text.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  },
  {
    name: 'keyboard_press',
    description: 'Press a single key or a combination of keys (e.g. ["Alt", "Tab"], ["Control", "c"], "Enter"). Key modifiers must be in an array with the target key if it is a combination.',
    parameters: { 
      type: 'object', 
      properties: { 
        keys: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'An array of keys to press together' 
        } 
      }, 
      required: ['keys'] 
    }
  },
  {
    name: 'drag_mouse',
    description: 'Drag the mouse from one coordinate to another.',
    parameters: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } }, required: ['x1', 'y1', 'x2', 'y2'] }
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command. CRITICAL: Set background to true when opening GUI applications (like google-chrome-stable) or long-running processes, otherwise the agent will hang waiting for it to finish.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, background: { type: 'boolean' } }, required: ['command'] }
  },
  {
    name: 'finish_task',
    description: 'Signal that the task is completed.',
    parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }
  }
];

async function startAgentLoop(task: string) {
  isAgentRunning = true;
  currentTask = task;
  
  emitLog({ type: 'agent', message: `Initializing E2B Desktop Sandbox for task: ${task}` });
  
  try {
    if (activeSandbox) {
      await activeSandbox.kill();
    }
    activeSandbox = await Sandbox.create({ timeoutMs: 3600_000 }); // 1 hour
    await activeSandbox.stream.start();
    const streamUrl = activeSandbox.stream.getUrl();
    io.emit('vnc_url', streamUrl);
    emitLog({ type: 'system', message: `Sandbox started. VNC URL: ${streamUrl}` });

    let messages: any[] = [
      { role: 'user', parts: [{ text: `You are a GUI computer using AI agent. You have access to a full Linux desktop via E2B Sandbox. The user wants you to do the following task: "${task}". You will receive a screenshot on every turn. Use the tools to interact with the GUI, or use 'execute_command' to run terminal commands to help achieve the goal. When you are done, call 'finish_task'. 

CRITICAL RULES:
- When using 'execute_command' to start a GUI application (like Google Chrome), you MUST set "background": true. If you do not, the environment will hang forever waiting for the application to close.
- The desktop resolution is precisely 1024x768 pixels.
- Top-left corner is X: 0, Y: 0.
- Bottom-right corner is X: 1024, Y: 768.
- When using the 'mouse_move' tool:
  - Estimate the exact pixel location of the UI element you want to interact with.
  - Do NOT use normalized percentages (e.g. 500, 500). Use the absolute 1024x768 scale.
  - For example, the middle of the screen is x=512, y=384.` }] },
      { role: 'model', parts: [{ text: "I understand the task and will now begin executing it." }] }
    ];

    while (isAgentRunning) {
      try {
        await activeSandbox.setTimeout(3600_000); // refresh timeout to 1 hour on every loop
        emitLog({ type: 'system', message: 'Taking screenshot...' });
        const screenshotBuf = await activeSandbox.screenshot();
        const base64Image = Buffer.from(screenshotBuf).toString('base64');
        
        const currentTurnMessage = {
          role: 'user',
          parts: [
            { text: "Here is the current screen state. What is your next action?" },
            { inlineData: { mimeType: 'image/png', data: base64Image } }
          ]
        };

        const res = await ai.models.generateContent({
          model: 'gemma-4-31b-it',
          contents: [...messages, currentTurnMessage],
          config: { 
            temperature: 0.1,
            tools: [{ functionDeclarations: tools as any }]
          }
        });

        const calls = res.functionCalls;
        
        messages.push(currentTurnMessage);

        if (!calls || calls.length === 0) {
           const reply = res.text;
           emitLog({ type: 'agent', message: reply || 'Thinking...' });
           messages.push({ role: 'model', parts: [{ text: reply || 'No action chosen.' }] });
           await new Promise(r => setTimeout(r, 2000));
           continue;
        }

        // push all the model's function calls
        messages.push({
          role: 'model',
          parts: calls.map(c => ({ functionCall: { name: c.name, args: c.args } }))
        });

        const responsesParts = [];

        for (const call of calls) {
          emitLog({ type: 'agent', message: `Action: ${call.name}(${JSON.stringify(call.args)})` });

          let outputStr = "Success";
          
          try {
            if (call.name === 'mouse_move') {
              await activeSandbox.moveMouse(Number(call.args.x), Number(call.args.y));
            } else if (call.name === 'mouse_click') {
              if (call.args.doubleClick) {
                await activeSandbox.doubleClick();
              } else {
                if (call.args.button === 'right') await activeSandbox.rightClick();
                else if (call.args.button === 'middle') await activeSandbox.middleClick();
                else await activeSandbox.leftClick();
              }
            } else if (call.name === 'keyboard_type') {
              await activeSandbox.write(call.args.text as string);
            } else if (call.name === 'keyboard_press') {
              await activeSandbox.press(call.args.keys as string[]);
            } else if (call.name === 'drag_mouse') {
              await activeSandbox.drag([Number(call.args.x1), Number(call.args.y1)], [Number(call.args.x2), Number(call.args.y2)]);
            } else if (call.name === 'execute_command') {
              if (call.args.background) {
                const cmdRes = await activeSandbox.commands.run(call.args.command as string, { background: true });
                outputStr = `Command started in background.`;
                emitLog({ type: 'terminal', message: `$ ${call.args.command} [BACKGROUND]\n${outputStr}` });
              } else {
                const cmdRes = await activeSandbox.commands.run(call.args.command as string, { timeoutMs: 0 }); // 0 means no timeout
                
                if (cmdRes.error) {
                   outputStr = `Command Error: ${cmdRes.error}\nStdout: ${cmdRes.stdout}\nStderr: ${cmdRes.stderr}`;
                } else {
                   outputStr = `Exit Code: ${cmdRes.exitCode}\nStdout: ${cmdRes.stdout}\nStderr: ${cmdRes.stderr}`;
                }

                emitLog({ type: 'terminal', message: `$ ${call.args.command}\n${outputStr}` });
              }
            } else if (call.name === 'finish_task') {
              emitLog({ type: 'agent', message: `Task finished: ${call.args.message}` });
              isAgentRunning = false;
              break;
            }
          } catch (e: any) {
            outputStr = `Error executing tool: ${getExactError(e)}`;
            if (typeof e.stdout === 'string' || typeof e.stderr === 'string') {
              outputStr += `\nStdout: ${e.stdout}\nStderr: ${e.stderr}`;
            }
            emitLog({ type: 'error', message: outputStr });
          }

          responsesParts.push({ functionResponse: { name: call.name, response: { output: outputStr } } });
        }
        
        messages.push({
          role: 'user',
          parts: responsesParts
        });

      } catch (err: any) {
        emitLog({ type: 'error', message: `AI Loop Error: ${getExactError(err)}` });
        // wait a bit before retrying
        await new Promise(r => setTimeout(r, 2000));
      }
    }

  } catch (error: any) {
    emitLog({ type: 'error', message: `Sandbox Error: ${getExactError(error)}` });
    isAgentRunning = false;
  }
}


io.on('connection', (socket) => {
  console.log('Client connected');
  
  if (activeSandbox && isAgentRunning) {
    socket.emit('vnc_url', activeSandbox.stream.getUrl());
  }

  // send backlog of logs to new connection
  serverLogs.forEach(log => socket.emit('log', log));

  socket.on('start_agent', async ({ task }) => {
    if (isAgentRunning) {
      socket.emit('log', { type: 'system', message: 'Agent is already running. Wait for it to finish or restart server.' });
      return;
    }
    startAgentLoop(task);
  });

  socket.on('stop_agent', async () => {
    isAgentRunning = false;
    if (activeSandbox) {
      await activeSandbox.kill();
      activeSandbox = null;
    }
    emitLog({ type: 'system', message: 'Agent stopped by user.' });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
