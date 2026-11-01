import { Upload, FileText, CheckCircle2, ArrowRight } from 'lucide-react';
import { useNavigate } from "react-router";

export function ImportHub() {
  const navigate = useNavigate();

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in-50 duration-200">
      {/* Header Panel */}
      <div className="border-b border-border/80 pb-5">
        <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-white">Bring your words into Voca</h1>
        <p className="text-muted-foreground text-[14.5px] mt-1.5 font-medium max-w-2xl">
          Paste text articles, upload documents, and transform raw native materials into systematic reviewable flashcards.
        </p>
      </div>

      {/* Stepper Pipeline Overview */}
      <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
        <h2 className="font-bold text-[16px] text-slate-900 dark:text-white mb-6">Pipeline Process</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          <div className="text-center p-4 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/10 flex items-center justify-center mx-auto shadow-sm">
              <FileText className="w-5.5 h-5.5 text-primary" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-bold text-[14.5px] text-slate-850 dark:text-slate-100">1. Paste / Upload</div>
              <div className="text-[13px] text-muted-foreground mt-1 leading-relaxed font-medium">Add target articles, snippets, or documents</div>
            </div>
          </div>

          <div className="text-center p-4 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-teal-500/5 dark:bg-teal-500/10 border border-teal-500/15 flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-5.5 h-5.5 text-teal-600 dark:text-teal-400" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-bold text-[14.5px] text-slate-850 dark:text-slate-100">2. Select Candidates</div>
              <div className="text-[13px] text-muted-foreground mt-1 leading-relaxed font-medium">Filter automatically detected keywords</div>
            </div>
          </div>

          <div className="text-center p-4 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center mx-auto shadow-sm">
              <Upload className="w-5.5 h-5.5 text-indigo-600 dark:text-indigo-400" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-bold text-[14.5px] text-slate-850 dark:text-slate-100">3. Save & Enrich</div>
              <div className="text-[13px] text-muted-foreground mt-1 leading-relaxed font-medium">Review details; optional AI enrichment</div>
            </div>
          </div>
        </div>

        <button
          onClick={() => navigate('/import/step1')}
          className="w-full h-11 mt-8 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 rounded-xl font-bold transition-all text-[14px] flex items-center justify-center gap-2 shadow-sm active:scale-99 cursor-pointer select-none"
        >
          <span>Start New Import</span>
          <ArrowRight className="w-4 h-4 text-teal-400" strokeWidth={2.5} />
        </button>
      </div>

      {/* Import Methods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Paste Text Active */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/10 flex items-center justify-center text-primary">
              <FileText className="w-5 h-5" strokeWidth={1.5} />
            </div>
            <h3 className="font-bold text-[16px] text-slate-900 dark:text-white pt-1">Paste Text & Document Analysis</h3>
            <p className="text-[13.5px] text-muted-foreground leading-relaxed font-medium">
              Copy-paste target articles, upload image captures, or insert PDFs. Voca AI automatically extracts relevant vocabulary.
            </p>
          </div>
          <button 
            onClick={() => navigate('/import/step1')}
            className="mt-6 text-[13.5px] font-bold text-primary hover:text-primary/80 flex items-center gap-1.5 transition-colors cursor-pointer w-fit"
          >
            <span>Configure settings</span>
            <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {/* Future CSV/Anki Coming soon */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-450">
              <Upload className="w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <h3 className="font-bold text-[16px] text-slate-900">File & List Import</h3>
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-[10.5px] font-bold text-slate-500 rounded border border-border uppercase tracking-wide">
                Ready
              </span>
            </div>
            <p className="text-[13.5px] text-muted-foreground leading-relaxed font-medium">
              Support for importing CSV / TSV vocabulary lists, Anki TXT and APKG packages directly into custom collections.
            </p>
          </div>
          <button onClick={() => navigate('/import/files')} className="mt-6 text-sm font-bold text-primary text-left">Import a file or list →</button>
          <p className="mt-2 text-xs text-muted-foreground">Map fields, check duplicates, choose a collection. No AI requests.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="font-bold">Your reading library</h2><p className="text-sm text-muted-foreground mt-1">Save articles, look up words locally, and continue typing practice.</p></div>
        <button onClick={() => navigate('/practice')} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold">Open Reading & Typing</button>
      </div>
    </div>
  );
}
