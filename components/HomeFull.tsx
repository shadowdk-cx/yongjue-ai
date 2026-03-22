'use client';

import { useState } from 'react';
import { FileText, Image, Video } from 'lucide-react';
import { ConfigBar } from '@/components/ConfigBar';
import { TextWorkflow } from '@/components/TextWorkflow';
import { ImageWorkflow } from '@/components/ImageWorkflow';
import { VideoWorkflow } from '@/components/VideoWorkflow';
import { clsx } from 'clsx';

type TabId = 'text' | 'image' | 'video';

export default function HomeFull() {
  const [activeTab, setActiveTab] = useState<TabId>('text');
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [videoApiKey, setVideoApiKey] = useState('');
  const [textModel, setTextModel] = useState('gemini-2.0-flash');
  const [imageModel, setImageModel] = useState('gemini-2.5-flash-image');
  const [videoModel, setVideoModel] = useState('veo-2.0-generate-001');

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'text', label: '图文工作区', icon: <FileText className="w-4 h-4" /> },
    { id: 'image', label: '图像生成', icon: <Image className="w-4 h-4" /> },
    { id: 'video', label: '视频生成', icon: <Video className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          涌觉商贸AI图文视频制作工具
        </h1>
        <nav className="flex gap-1">
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                activeTab === id
                  ? 'bg-sky-500 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
      </header>

      <ConfigBar
        provider={provider}
        setProvider={setProvider}
        apiKey={apiKey}
        setApiKey={setApiKey}
        videoApiKey={videoApiKey}
        setVideoApiKey={setVideoApiKey}
        textModel={textModel}
        setTextModel={setTextModel}
        imageModel={imageModel}
        setImageModel={setImageModel}
        videoModel={videoModel}
        setVideoModel={setVideoModel}
      />

      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className={activeTab === 'text' ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : 'hidden'}>
          <TextWorkflow apiKey={apiKey} provider={provider} textModel={textModel} />
        </div>
        <div className={activeTab === 'image' ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : 'hidden'}>
          <ImageWorkflow apiKey={apiKey} provider={provider} textModel={textModel} imageModel={imageModel} />
        </div>
        <div className={activeTab === 'video' ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : 'hidden'}>
          <VideoWorkflow apiKey={apiKey} videoApiKey={videoApiKey} videoModel={videoModel} />
        </div>
      </main>
    </div>
  );
}
