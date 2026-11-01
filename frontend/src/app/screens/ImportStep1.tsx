import { ArrowLeft, ArrowRight, FileText, Loader2, UploadCloud, Settings2 } from 'lucide-react';
import { useNavigate } from "react-router";
import { useState, useRef } from 'react';
import { analyzeText, extractTextFromFile } from '../../lib/api';
import { saveArticle } from '../../lib/articles';
import { SelectField, type SelectOption } from '../components/ui/SelectField';

export function ImportStep1() {
  const navigate = useNavigate();
  
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('English');
  const [text, setText] = useState('');
  
  // Dynamic AI configuration states
  const [level, setLevel] = useState('Intermediate');
  const [goal, setGoal] = useState('General');
  const [count, setCount] = useState(10);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSavingArticle, setIsSavingArticle] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const languageOptions: SelectOption[] = [
    { value: 'German', label: 'German' },
    { value: 'English', label: 'English' },
    { value: 'French', label: 'French' },
    { value: 'Spanish', label: 'Spanish' },
    { value: 'Japanese', label: 'Japanese' }
  ];

  const levelOptions: SelectOption[] = [
    { value: 'Beginner', label: 'Beginner (A1-A2)' },
    { value: 'Intermediate', label: 'Intermediate (B1-B2)' },
    { value: 'Advanced', label: 'Advanced (C1-C2)' }
  ];

  const goalOptions: SelectOption[] = [
    { value: 'General', label: 'General' },
    { value: 'Business', label: 'Business' },
    { value: 'Travel', label: 'Travel' },
    { value: 'Academic', label: 'Academic' }
  ];

  const fileInputRef = useRef<HTMLInputElement>(null);

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    
    setIsAnalyzing(true);
    setError(null);
    try {
      const candidates = await analyzeText(text, language, level, goal, count);
      navigate('/import/step2', { 
        state: { 
          title, 
          language, 
          text, 
          candidates 
        } 
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze text');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePractice = async () => {
    setIsSavingArticle(true);
    setError(null);
    try {
      const article = await saveArticle({ title: title || 'Untitled article', raw_text: text, language, source_type: 'article_import' });
      navigate(`/practice/${article.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save article');
    } finally {
      setIsSavingArticle(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = (reader.result as string).split(',')[1];
        try {
          const extractedText = await extractTextFromFile(base64String, file.type);
          setText(prev => prev ? prev + '\n\n' + extractedText : extractedText);
          if (!title) setTitle(file.name.split('.')[0]);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to extract text from file');
        } finally {
          setIsExtracting(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
      setIsExtracting(false);
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 animate-in fade-in-50 duration-200">
      <button
        onClick={() => navigate('/import')}
        className="flex items-center gap-2 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={2} />
        Back to Import
      </button>

      {/* Stepper Progress Header */}
      <div className="flex items-start gap-4">
        <div className="w-9 h-9 rounded-xl bg-[#002434] text-white flex items-center justify-center text-[15px] font-bold shadow-md shadow-black/5 shrink-0">
          1
        </div>
        <div className="space-y-1">
          <h1 className="text-[26px] font-bold tracking-tight text-slate-900 dark:text-white leading-none">Paste Text & Document Capture</h1>
          <p className="text-muted-foreground text-[14px] font-medium pt-1">
            Provide the articles or document materials you want to analyze and extract vocabulary candidates from.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200/50 bg-rose-50 px-4 py-3 text-[13.5px] font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* Main Input Form Card */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-[13px] font-bold text-slate-550">Source Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., German Business Article, Scientific Paper"
              className="w-full h-10 px-3.5 bg-slate-50 dark:bg-slate-800/50 border border-border/80 rounded-xl text-[14px] placeholder:text-muted-foreground focus:outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-primary/20 focus:ring-4 focus:ring-primary/5 transition-all duration-200"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[13px] font-bold text-slate-550">Target Language</label>
            <SelectField
              value={language}
              onChange={setLanguage}
              options={languageOptions}
            />
          </div>
        </div>

        {/* AI Extraction Settings Sub-Card */}
        <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-2xl border border-border/40 space-y-4">
          <div className="flex items-center gap-2 text-[14px] font-bold text-slate-700 dark:text-slate-200">
            <Settings2 className="w-4.5 h-4.5 text-primary" strokeWidth={2} />
            <span>AI Extraction Parameters</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[12px] font-bold text-slate-500">My Level</label>
              <SelectField
                value={level}
                onChange={setLevel}
                options={levelOptions}
                variant="compact"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-bold text-slate-500">Goal</label>
              <SelectField
                value={goal}
                onChange={setGoal}
                options={goalOptions}
                variant="compact"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-bold text-slate-500">Max Candidates</label>
              <input 
                type="number"
                min="5" max="50"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full h-9 px-3 bg-card border border-border rounded-xl text-[13px] focus:outline-none focus:ring-4 focus:ring-primary/5 font-semibold text-slate-800 dark:text-slate-200"
              />
            </div>
          </div>
        </div>

        {/* Text Paste and Upload Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
            <label className="block text-[13px] font-bold text-slate-550">Text Content</label>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isExtracting}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-50 dark:bg-slate-800 border border-border/80 hover:bg-slate-100 hover:text-foreground text-[12px] font-bold text-slate-600 dark:text-slate-300 rounded-xl transition-all active:scale-95 cursor-pointer"
              type="button"
            >
              {isExtracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5 text-primary" strokeWidth={2} />}
              <span>{isExtracting ? 'Extracting text...' : 'Upload File (Image / PDF) (Beta)'}</span>
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload}
              accept="image/*,application/pdf" 
              className="hidden" 
            />
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your source foreign language article or study sentences here..."
            rows={14}
            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-border/80 rounded-2xl text-[14px] placeholder:text-muted-foreground focus:outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-primary/20 focus:ring-4 focus:ring-primary/5 transition-all resize-none font-mono leading-relaxed"
          />
        </div>

        {/* Word count status indicator */}
        <div className="flex items-center gap-2 text-[12.5px] font-bold text-slate-500 pt-1 border-t border-border/40">
          <FileText className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
          <span>{wordCount > 0 ? `${wordCount} words added` : 'Ready to import new material'}</span>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3.5 pt-2">
        <button type="button" onClick={handlePractice} disabled={!wordCount || isSavingArticle || isAnalyzing}
          className="h-10 px-5 border border-border rounded-xl text-sm font-semibold disabled:opacity-50">
          {isSavingArticle ? 'Saving article…' : 'Save for Reading & Typing'}
        </button>
        <button
          onClick={() => navigate('/import')}
          className="h-10 px-5 border border-border rounded-xl hover:bg-slate-50 font-semibold transition-colors text-[14px] cursor-pointer"
          disabled={isAnalyzing}
        >
          Cancel
        </button>
        <button
          onClick={handleAnalyze}
          disabled={wordCount === 0 || isAnalyzing}
          className="h-10 px-5 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-[#0a3346] transition-all text-[14px] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-primary/5 active:scale-95"
        >
          {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Analyze Material with AI'}
          {!isAnalyzing && <ArrowRight className="w-4 h-4 text-teal-400" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}
