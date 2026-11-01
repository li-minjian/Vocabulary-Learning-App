import { ArrowLeft, ArrowRight, CheckSquare, Square, Filter, Plus, Loader2, BookOpen } from 'lucide-react';
import { useNavigate, useLocation } from "react-router";
import { useState, useEffect } from 'react';

export function ImportStep2() {
  const navigate = useNavigate();
  const location = useLocation();
  const data = location.state;
  
  const text = data?.text || '';
  const language = data?.language || 'English';
  const title = data?.title || '';
  const initialCandidates = data?.candidates || [];

  const [candidates, setCandidates] = useState<any[]>(initialCandidates);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  
  const [manualWord, setManualWord] = useState('');
  const [isCheckingTypo, setIsCheckingTypo] = useState(false);
  const [typoError, setTypoError] = useState<string | null>(null);

  // Filter state for hiding existing words
  const [hideExisting, setHideExisting] = useState(false);

  // Auto-select all by default when candidates load
  useEffect(() => {
    if (candidates.length > 0) {
      setSelected(new Set(candidates.map((_, i) => i)));
    }
  }, [candidates]);

  const toggleSelect = (index: number) => {
    const newSelected = new Set(selected);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelected(newSelected);
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const wordToAdd = manualWord.trim();
    if (!wordToAdd) return;
    
    setIsCheckingTypo(true);
    setTypoError(null);
    try {
      const { checkTypo } = await import('../../lib/api');
      const result = await checkTypo(text, wordToAdd);
      
      if (result.not_found) {
        setTypoError(`'${wordToAdd}' was not found in the source text.`);
      } else {
        let finalWord = wordToAdd;
        if (result.is_typo && result.corrected_word) {
          const confirmCorrection = window.confirm(`'${wordToAdd}' looks like a typo. Did you mean '${result.corrected_word}'?`);
          if (confirmCorrection) {
            finalWord = result.corrected_word;
          }
        }
        
        // Add to candidates
        const newCandidate = {
          word: finalWord,
          translation: 'Pending AI...',
          pos: 'Unknown',
          context: 'Manually added'
        };
        
        setCandidates(prev => [...prev, newCandidate]);
        // Select it automatically
        setSelected(prev => {
          const next = new Set(prev);
          next.add(candidates.length);
          return next;
        });
        setManualWord('');
      }
    } catch (err) {
      setTypoError(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setIsCheckingTypo(false);
    }
  };

  const handleContinue = () => {
    const selectedWords = candidates.filter((_, i) => selected.has(i));
    navigate('/import/step3', {
      state: {
        text,
        language,
        title,
        words: selectedWords
      }
    });
  };

  // Safe and robust regex-based candidate highlighting inside the source text panel
  const renderHighlightedText = () => {
    if (!text) return <span className="text-[#42474b] italic">No text content provided.</span>;

    const wordsToHighlight = candidates
      .map(c => c.word)
      .filter(w => w && w.trim().length > 1)
      .sort((a, b) => b.length - a.length);

    if (wordsToHighlight.length === 0) return text;

    try {
      // Escape special regex control characters safely
      const escaped = wordsToHighlight.map(w => w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
      
      // Use word boundaries (\b) to match candidates cleanly, case-insensitive
      const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
      const parts = text.split(regex);

      return parts.map((part: string, idx: number) => {
        const isMatch = wordsToHighlight.some(w => w.toLowerCase() === part.toLowerCase());
        if (isMatch) {
          return (
            <span 
              key={idx} 
              className="px-1 py-0.5 rounded bg-[#002434]/8 border-b-2 border-[#002434]/30 font-bold text-[#002434] select-all transition-all duration-200"
              title="Extracted vocabulary candidate"
            >
              {part}
            </span>
          );
        }
        return part;
      });
    } catch (err) {
      return text;
    }
  };

  // Filtered candidates based on "hideExisting" status
  const visibleCandidates = candidates.map((item, idx) => ({ ...item, originalIndex: idx }))
    .filter(item => !hideExisting || !item.existing);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6 lg:h-[calc(100vh-100px)] flex flex-col lg:overflow-hidden bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d]">
      
      {/* Top Bar Navigation */}
      <div className="shrink-0 flex items-center justify-between border-b border-[#c2c7cc]/50 pb-4.5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/import/step1')}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#c2c7cc]/60 hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d] transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 bg-white"
            title="Back to text paste"
          >
            <ArrowLeft className="w-4.5 h-4.5" strokeWidth={2} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#e6e8e9] text-[#002434] border border-[#c2c7cc]/50 flex items-center justify-center text-[14px] font-bold shadow-sm shrink-0">
              2
            </div>
            <div>
              <h1 className="text-[22px] md:text-[24px] font-bold tracking-tight text-[#191c1d] leading-none">Select Candidates</h1>
              <p className="text-[13px] text-[#42474b] font-semibold mt-1">
                {candidates.length} keywords detected • {selected.size} marked for database save
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Workspace Arena: Split Screen Viewport */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-8 lg:overflow-hidden min-h-0">
        
        {/* Left Side: Monospace Source Immersion Panel (Span 2) */}
        <div className="lg:col-span-2 flex flex-col lg:h-full lg:min-h-0 min-h-[350px] bg-[#f2f4f5] border border-[#c2c7cc]/65 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#c2c7cc]/60 bg-[#eceeef]/60 shrink-0">
            <h3 className="font-bold text-[14.5px] text-[#191c1d] flex items-center gap-2">
              <BookOpen className="w-4.5 h-4.5 text-[#002434]" strokeWidth={2} />
              <span>Source Text Immersion</span>
            </h3>
            <p className="text-[11.5px] text-[#42474b] font-semibold mt-1">
              Extracted words are highlighted in pale blue-grey below. Toggle checkboxes on the right to import.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-5 m-4 bg-white border border-[#c2c7cc]/50 rounded-xl shadow-sm font-mono text-[13.5px] leading-relaxed text-[#191c1d] select-text whitespace-pre-wrap break-words">
            {renderHighlightedText()}
          </div>
        </div>

        {/* Right Side: Candidate Feeds & Tools (Span 3) */}
        <div className="lg:col-span-3 flex flex-col lg:h-full lg:min-h-0 space-y-4">
          
          {/* Toolbar controllers */}
          <div className="shrink-0 flex flex-wrap items-center gap-3">
            <button 
              onClick={() => setHideExisting(!hideExisting)}
              className={`h-9 px-4 rounded-xl border transition-all text-[12.5px] font-bold flex items-center gap-2 cursor-pointer select-none active:scale-95 ${
                hideExisting 
                  ? 'bg-[#eceeef] text-[#002434] border-[#002434]/20 shadow-sm' 
                  : 'bg-white border-[#c2c7cc]/60 hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d]'
              }`}
            >
              <Filter className="w-3.5 h-3.5" strokeWidth={hideExisting ? 2.5 : 1.5} />
              <span>{hideExisting ? 'Show Existing' : 'Hide Existing'}</span>
            </button>
            <button
              onClick={() => setSelected(new Set(candidates.map((_, i) => i)))}
              className="h-9 px-4 rounded-xl border border-[#c2c7cc]/60 bg-white hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d] font-bold transition-all text-[12.5px] cursor-pointer select-none active:scale-95"
            >
              Select All
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="h-9 px-4 rounded-xl border border-[#c2c7cc]/60 bg-white hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d] font-bold transition-all text-[12.5px] cursor-pointer select-none active:scale-95"
            >
              Deselect All
            </button>
          </div>

          {/* Manual keyword correction bar */}
          <form onSubmit={handleManualAdd} className="shrink-0 bg-[#f2f4f5] border border-[#c2c7cc]/65 p-3.5 rounded-2xl flex items-center gap-3 shadow-sm">
            <input 
              type="text"
              value={manualWord}
              onChange={e => setManualWord(e.target.value)}
              placeholder="Did Voca miss a word? Add it manually from the text..."
              className="flex-1 h-10 px-3.5 bg-white border border-[#c2c7cc]/70 rounded-xl text-[13.5px] focus:outline-none focus:border-[#002434]/20 focus:ring-4 focus:ring-[#002434]/5 transition-all placeholder:text-slate-400 text-[#191c1d]"
            />
            <button 
              type="submit" 
              disabled={isCheckingTypo || !manualWord.trim()}
              className="h-10 px-4.5 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 font-bold rounded-xl text-[13px] flex items-center gap-1.5 disabled:opacity-50 transition-all active:scale-95 cursor-pointer shrink-0 shadow-sm"
            >
              {isCheckingTypo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 text-teal-400" strokeWidth={2.5} />}
              <span>{isCheckingTypo ? 'Verifying...' : 'Add Word'}</span>
            </button>
          </form>
          {typoError && (
            <div className="shrink-0 text-[12.5px] text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-1.5 font-medium animate-in fade-in-50 duration-200">
              {typoError}
            </div>
          )}

          {/* Candidate scroll feed list */}
          <div className="flex-1 lg:overflow-y-auto pr-1 space-y-3 lg:min-h-0">
            {visibleCandidates.length === 0 ? (
              <div className="text-center py-20 bg-white border border-[#c2c7cc]/65 border-dashed rounded-2xl shadow-sm">
                <p className="text-[14px] text-[#42474b] font-semibold">No candidate words match your current filter settings.</p>
              </div>
            ) : (
              visibleCandidates.map((item) => {
                const idx = item.originalIndex;
                const isSelected = selected.has(idx);

                return (
                  <button
                    key={idx}
                    onClick={() => toggleSelect(idx)}
                    className={`w-full bg-white border rounded-2xl p-4 text-left hover:border-[#002434]/30 transition-all cursor-pointer flex items-start gap-4 shadow-sm active:scale-99 ${
                      isSelected 
                        ? 'border-[#002434]/40 bg-[#f2f4f5]/40 shadow-sm' 
                        : 'border-[#c2c7cc]/65'
                    } ${item.existing ? 'opacity-65' : ''}`}
                  >
                    {/* Checkbox icon */}
                    <div className="mt-0.5 shrink-0">
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5 text-[#002434] animate-in zoom-in-50 duration-100" strokeWidth={2} />
                      ) : (
                        <Square className="w-5 h-5 text-slate-400" strokeWidth={1.5} />
                      )}
                    </div>

                    {/* Word Details */}
                    <div className="flex-1 space-y-1.5 min-w-0">
                      <div className="flex items-center gap-3.5 flex-wrap">
                        <span className="font-bold text-[15.5px] text-[#191c1d]">{item.word}</span>
                        {item.ipa && (
                          <span className="text-[12.5px] font-mono text-[#002434]/70 bg-[#002434]/5 border border-[#002434]/10 rounded px-1.5 font-bold">
                            /{item.ipa.replace(/^\/|\/$/g, '')}/
                          </span>
                        )}
                        <span className="text-[13.5px] text-[#42474b] font-semibold truncate max-w-xs">{item.translation}</span>
                        {item.existing && (
                          <span className="px-2.5 py-0.5 bg-[#eceeef] text-[#42474b] border border-[#c2c7cc]/60 rounded-lg text-[10.5px] font-bold uppercase tracking-wider shrink-0 select-none">
                            In Dictionary
                          </span>
                        )}
                      </div>
                      {item.context && (
                        <div className="text-[13px] text-[#42474b] italic font-semibold leading-relaxed break-words line-clamp-2">
                          "{item.context}"
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="shrink-0 flex justify-end gap-3.5 pt-4 border-t border-[#c2c7cc]/50">
        <button
          onClick={() => navigate('/import/step1')}
          className="h-10 px-5 border border-[#c2c7cc]/60 hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d] font-semibold transition-colors text-[14px] cursor-pointer select-none active:scale-95 bg-white"
        >
          Cancel
        </button>
        <button
          onClick={handleContinue}
          disabled={selected.size === 0}
          className="h-10 px-5 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 font-bold rounded-xl transition-all text-[14px] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm active:scale-95 select-none"
        >
          <span>Continue with {selected.size} words</span>
          <ArrowRight className="w-4 h-4 text-teal-400" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
