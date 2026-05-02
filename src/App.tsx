import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Play, Square, Terminal, MonitorPlay, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const socket: Socket = io();

export default function App() {
  const [page, setPage] = useState<'home' | 'workspace'>('home');
  const [task, setTask] = useState('');
  
  const [vncUrl, setVncUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ id: string; type: string; message: string; timestamp: Date }[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socket.on('vnc_url', (url: string) => {
      setVncUrl(url);
    });

    socket.on('log', (data: { type: string; message: string }) => {
      setLogs((prevLogs) => [
        ...prevLogs,
        { id: Math.random().toString(36).substr(2, 9), type: data.type, message: data.message, timestamp: new Date() }
      ]);
    });

    return () => {
      socket.off('vnc_url');
      socket.off('log');
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleStart = () => {
    if (!task.trim()) return;
    setLogs([]); // clear logs on multiple runs
    setVncUrl(null);
    socket.emit('start_agent', { task });
    setPage('workspace');
  };

  const handleStop = () => {
    socket.emit('stop_agent');
  };

  const getLogColor = (type: string) => {
    switch (type) {
      case 'agent': return 'text-green-400';
      case 'system': return 'text-blue-400';
      case 'terminal': return 'text-yellow-300';
      case 'error': return 'text-red-500';
      default: return 'text-slate-200';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-indigo-500/30 overflow-hidden">
      <AnimatePresence mode="wait">
        {page === 'home' && (
          <motion.div 
            key="home"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center justify-center min-h-screen max-w-2xl mx-auto p-4 sm:p-6"
          >
            <div className="flex flex-col sm:flex-row items-center gap-3 mb-6 sm:mb-8 text-indigo-400 text-center sm:text-left">
              <MonitorPlay className="w-10 h-10 sm:w-12 sm:h-12 shrink-0" />
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">Full-Stack AI Agent</h1>
            </div>
            
            <p className="text-slate-400 mb-6 sm:mb-8 text-center text-base sm:text-lg leading-relaxed">
              Describe a complex computer task. The AI agent will provision a secure desktop sandbox, open applications, run terminal commands, and perform the actions step-by-step.
            </p>
            
            <div className="w-full bg-slate-900/50 p-3 sm:p-4 border border-slate-800 rounded-2xl shadow-xl backdrop-blur-sm">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="e.g. Open chromium-browser, go to github.com/e2b-dev/e2b, find the latest release version and write it down in a file named release.txt on the desktop..."
                className="w-full h-40 bg-zinc-950 text-white placeholder-slate-500 outline-none resize-none p-4 rounded-xl border border-slate-800/50 focus:border-indigo-500/50 transition-colors"
                autoFocus
              />
              <div className="flex justify-end mt-4">
                <button
                  onClick={handleStart}
                  disabled={!task.trim()}
                  className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-medium transition-all shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:shadow-[0_0_30px_rgba(79,70,229,0.5)] w-full sm:w-auto"
                >
                  <Play className="w-5 h-5" fill="currentColor" />
                  Initialize Agent
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {page === 'workspace' && (
          <motion.div 
            key="workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-[100dvh] flex flex-col pt-3 px-3 pb-3 md:pt-4 md:px-6 md:pb-6"
          >
            <header className="flex justify-between items-center mb-4 md:mb-6 shrink-0">
              <div className="flex items-center gap-3 md:gap-4">
                <button 
                  onClick={() => setPage('home')}
                  className="text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                >
                  &larr; <span className="hidden sm:inline">Back</span>
                </button>
                <div className="h-4 w-px bg-slate-800 shrink-0" />
                <h2 className="text-base md:text-lg font-medium text-slate-200 flex items-center gap-2 whitespace-nowrap">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                  </span>
                  <span className="hidden sm:inline">Agent Workspace</span>
                  <span className="sm:hidden">Workspace</span>
                </h2>
              </div>
              <button
                onClick={handleStop}
                className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-2 md:px-4 rounded-lg font-medium transition-colors border border-red-500/20"
              >
                <Square className="w-4 h-4" />
                <span className="hidden sm:inline">Stop Execution</span>
                <span className="sm:hidden">Stop</span>
              </button>
            </header>

            <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-full min-h-0">
              {/* Screen Viewer Panel */}
              <div className="flex-none h-64 sm:h-80 lg:h-auto lg:flex-[2] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col relative w-full min-h-0">
                <div className="bg-slate-950 border-b border-slate-800 px-4 py-3 shrink-0 flex items-center justify-between">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-slate-800"></div>
                    <div className="w-3 h-3 rounded-full bg-slate-800"></div>
                    <div className="w-3 h-3 rounded-full bg-slate-800"></div>
                  </div>
                  <span className="text-xs font-mono text-slate-500 tracking-wider">LIVE DESKTOP</span>
                </div>
                
                <div className="flex-1 bg-black w-full h-full relative overflow-hidden">
                  {vncUrl ? (
                    <iframe 
                      src={vncUrl} 
                      className="w-full h-full border-none pointer-events-none" 
                      title="Desktop Stream"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                      <Loader2 className="w-10 h-10 animate-spin mb-4 opacity-50" />
                      <p className="font-mono text-sm uppercase tracking-widest">Provisioning Sandbox</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Logs / Terminal Panel */}
              <div className="flex-1 bg-zinc-950 border border-slate-800 rounded-2xl shadow-2xl flex flex-col min-h-0 min-w-0">
                <div className="bg-zinc-900 border-b border-slate-800 px-4 py-3 shrink-0 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Terminal className="w-4 h-4" />
                    <span className="text-xs font-mono tracking-wider font-semibold">AGENT LOGS & TERMINAL</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed space-y-3">
                  {logs.length === 0 && (
                    <div className="text-slate-600 italic">Waiting for agent to start...</div>
                  )}
                  {logs.map((log) => (
                    <div key={log.id} className="flex gap-3">
                      <span className="text-slate-600 shrink-0 select-none">
                        [{log.timestamp.toLocaleTimeString([], { hour12: false })}]
                      </span>
                      <span className={`${getLogColor(log.type)} whitespace-pre-wrap break-words`}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
