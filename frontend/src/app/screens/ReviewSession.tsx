import { X, Loader2, Volume2, Clock, Sparkles, Check, HelpCircle } from 'lucide-react';
import { useNavigate } from "react-router";
import { useState, useEffect } from 'react';
import { fetchReviewQueue, submitReviewAnswer, fetchWordById, type VocabularyWord } from '../../lib/api';
import { useLocation } from 'react-router';
import { speakWord } from '../../lib/speech';

type ReviewMode = 'flashcard' | 'multipleChoice' | 'spelling';

export function ReviewSession() {
  const navigate = useNavigate();
  
  const location = useLocation();
  const activeModes: ReviewMode[] = location.state?.activeModes || ['flashcard'];
  const limit: number = location.state?.limit || 20;
  const collectionId: string = location.state?.collectionId || 'all';

  const [queue, setQueue] = useState<VocabularyWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detailed word loaded on-demand
  const [detailedWord, setDetailedWord] = useState<VocabularyWord | null>(null);

  // Session stats tracking
  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSessionActive, setIsSessionActive] = useState(true);

  useEffect(() => {
    if (!isSessionActive) return;
    const timer = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isSessionActive]);

  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Multiple Choice learning feedback state
  const [selectedWrongOption, setSelectedWrongOption] = useState<string | null>(null);
  const [isReinforced, setIsReinforced] = useState(false);

  // Mode specific state
  const [currentMode, setCurrentMode] = useState<ReviewMode>('flashcard');
  const [mcOptions, setMcOptions] = useState<string[]>([]);
  const [spellInput, setSpellInput] = useState('');
  const [spellError, setSpellError] = useState(false);

  // On-demand load rich details for current word
  useEffect(() => {
    const currentWord = queue[currentIndex];
    if (currentWord) {
      setDetailedWord(null);
      fetchWordById(currentWord.id)
        .then(details => setDetailedWord(details))
        .catch(err => console.error("Error prefetching detailed word:", err));
    }
  }, [currentIndex, queue]);

  const initCard = (index: number, q: VocabularyWord[]) => {
    const word = q[index];
    if (!word) return;
    
    // Pick random mode
    const mode = activeModes[Math.floor(Math.random() * activeModes.length)];
    setCurrentMode(mode);
    setSpellInput('');
    setSpellError(false);
    
    // Reset learning feedback states
    setSelectedWrongOption(null);
    setIsReinforced(false);
    setDetailedWord(null);

    if (mode === 'multipleChoice') {
      // Pick 3 distractors
      const others = q.filter(w => w.id !== word.id).map(w => w.word);
      const distractors = others.sort(() => 0.5 - Math.random()).slice(0, 3);
      if (distractors.length < 3) {
        distractors.push(...['Example', 'Target', 'Context'].slice(0, 3 - distractors.length));
      }
      setMcOptions([...distractors, word.word].sort(() => 0.5 - Math.random()));
    }
  };

  useEffect(() => {
    fetchReviewQueue(limit, collectionId)
      .then(words => {
        setQueue(words);
        if (words.length > 0) initCard(0, words);
        setIsLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to load review queue');
        setIsLoading(false);
      });
  }, [limit, collectionId]);

  const handleAnswer = async (answer: 'again' | 'hard' | 'good' | 'easy') => {
    const currentWord = queue[currentIndex];
    if (!currentWord) return;

    const isCorrect = answer === 'good' || answer === 'easy';
    if (isCorrect) {
      setCorrectCount(prev => prev + 1);
    } else {
      setIncorrectCount(prev => prev + 1);
    }

    setIsSubmitting(true);
    try {
      await submitReviewAnswer(currentWord.id, answer);
      
      // Move to next card
      const nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        setIsSessionActive(false);
        const finalCorrect = isCorrect ? correctCount + 1 : correctCount;
        const finalIncorrect = !isCorrect ? incorrectCount + 1 : incorrectCount;
        const total = finalCorrect + finalIncorrect;
        const accuracy = total > 0 ? Math.round((finalCorrect / total) * 100) : 100;

        navigate('/review/result', { 
          state: { 
            reviewedCount: queue.length,
            accuracy,
            elapsedSeconds,
            correctCount: finalCorrect,
            incorrectCount: finalIncorrect
          } 
        });
      } else {
        setCurrentIndex(nextIndex);
        setRevealed(false);
        initCard(nextIndex, queue);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#f8fafb] flex flex-col items-center justify-center space-y-4 z-50 animate-in fade-in-50 duration-200">
        <Loader2 className="w-10 h-10 text-[#002434] animate-spin" strokeWidth={1.5} />
        <p className="text-[13.5px] text-[#42474b] font-bold">Initiating study workspace...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-[#f8fafb] flex flex-col items-center justify-center p-8 text-center space-y-5 z-50">
        <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-700 font-extrabold text-[20px] select-none shadow-sm">!</div>
        <p className="text-rose-700 font-bold max-w-sm text-[14.5px] leading-relaxed">{error}</p>
        <button 
          onClick={() => navigate('/review')} 
          className="h-10 px-5 bg-[#002434] hover:bg-[#0a3346] text-white font-bold rounded-xl cursor-pointer transition-all active:scale-95 shadow-md shadow-[#002434]/10 select-none text-[13.5px]"
        >
          Back to Review Hub
        </button>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="fixed inset-0 bg-[#f8fafb] flex flex-col items-center justify-center p-8 text-center space-y-5 z-50 animate-in fade-in duration-200">
        <div className="w-14 h-14 rounded-2xl bg-[#002434]/5 border border-[#002434]/10 flex items-center justify-center text-[#002434] shadow-sm">
          <Sparkles className="w-7 h-7" strokeWidth={1.5} />
        </div>
        <div className="space-y-1.5 max-w-xs mx-auto">
          <h2 className="text-[18px] font-extrabold text-[#191c1d] tracking-tight">Review Queue Caught Up!</h2>
          <p className="text-[#42474b] text-[13px] font-semibold leading-relaxed">No reviews scheduled at this threshold. Keep building your vocabulary dictionary!</p>
        </div>
        <button 
          onClick={() => navigate('/review')} 
          className="h-10 px-5 bg-[#002434] hover:bg-[#0a3346] text-white font-bold rounded-xl cursor-pointer transition-all active:scale-95 shadow-md shadow-[#002434]/10 select-none text-[13.5px]"
        >
          Back to Review Hub
        </button>
      </div>
    );
  }

  const currentWord = queue[currentIndex];
  const displayWord = detailedWord || currentWord;
  const currentCardNumber = currentIndex + 1;
  const totalCards = queue.length;
  const progress = (currentCardNumber / totalCards) * 100;

  return (
    <div className="fixed inset-0 bg-[#f8fafb] flex flex-col z-50 animate-in fade-in duration-300 text-[#191c1d] select-none">
      {/* High-Fidelity Navigation Progress Bar */}
      <div className="h-16 border-b border-[#c2c7cc]/60 bg-white/95 backdrop-blur-md flex items-center justify-between px-8 z-20">
        <div className="flex items-center gap-5">
          <div className="text-[13px] font-extrabold text-[#42474b] uppercase tracking-wider">
            Card {currentCardNumber} of {totalCards}
          </div>
          <div className="w-44 h-2 bg-[#eceeef] rounded-full overflow-hidden border border-[#c2c7cc]/20">
            <div className="h-full bg-[#002434] rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="text-[12.5px] font-bold text-[#42474b] flex items-center gap-1.5 bg-[#f2f4f5] px-3 py-1 rounded-lg border border-[#c2c7cc]/60">
            <Clock className="w-3.5 h-3.5 text-[#002434]" strokeWidth={2.5} />
            <span className="font-mono font-bold text-[#002434]">{formatTime(elapsedSeconds)}</span>
          </div>
        </div>
        <button
          onClick={() => navigate('/review')}
          className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#c2c7cc]/60 bg-white hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d] transition-all cursor-pointer shadow-sm active:scale-95"
          title="Exit Session"
        >
          <X className="w-4.5 h-4.5" strokeWidth={2} />
        </button>
      </div>

      {/* Main Focus Arena */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-8 overflow-y-auto relative z-10">
        <div className="w-full max-w-2xl">
          {!revealed ? (
            <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-8 md:p-12 text-center shadow-sm animate-in fade-in-50 duration-300">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-6 flex items-center justify-center gap-1.5">
                <span>{currentWord.language}</span>
                <span>•</span>
                <span>Active Recall Spaced Repetition</span>
              </div>
              
              {currentMode === 'flashcard' && (
                <div className="space-y-8">
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-full gap-3 flex-wrap">
                      <span className="text-[38px] md:text-[44px] font-extrabold text-[#191c1d] tracking-tight leading-none">
                        {currentWord.word}
                      </span>
                      <button
                        onClick={() => speakWord(currentWord.word, currentWord.language)}
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-[#f2f4f5] hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d] transition-all cursor-pointer shadow-sm active:scale-90"
                        title="Pronounce"
                      >
                        <Volume2 className="w-4.5 h-4.5" strokeWidth={2} />
                      </button>
                    </div>
                    {currentWord.ipa && (
                      <div className="text-[13px] font-mono text-[#002434] bg-[#002434]/5 border border-[#002434]/10 rounded-lg px-2.5 py-0.5 mt-3.5 font-bold">
                        /{currentWord.ipa.replace(/^\/|\/$/g, '')}/
                      </div>
                    )}
                    {currentWord.pos && (
                      <div className="mt-3.5">
                        <span className="px-2.5 py-0.5 bg-[#eceeef] border border-[#c2c7cc]/50 rounded-lg text-[10px] font-bold text-[#42474b] uppercase select-none tracking-wider">
                          {currentWord.pos}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-2">
                    <button
                      onClick={() => setRevealed(true)}
                      className="h-12 px-8 border border-[#002434] bg-white hover:bg-[#002434]/5 text-[#002434] rounded-xl transition-all text-[14px] font-extrabold shadow-sm active:scale-95 cursor-pointer select-none"
                    >
                      Reveal Definition
                    </button>
                  </div>
                </div>
              )}

              {currentMode === 'multipleChoice' && (
                <div className="space-y-8 text-left">
                  <div className="p-5.5 rounded-2xl border border-[#c2c7cc]/60 bg-[#f2f4f5]/30 leading-relaxed font-semibold text-[15.5px] text-[#191c1d]">
                    {currentWord.definition || currentWord.translation || "No definition available."}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    {mcOptions.map((opt, i) => {
                      const isCorrect = opt === currentWord.word;
                      const isSelectedWrong = opt === selectedWrongOption;
                      const hasSelectedAnyWrong = selectedWrongOption !== null;

                      let buttonStyle = "bg-[#f8fafb] hover:bg-[#eceeef]/50 border-[#c2c7cc] text-[#191c1d]";
                      if (hasSelectedAnyWrong) {
                        if (isCorrect) {
                          buttonStyle = "bg-emerald-50 border-emerald-250 text-emerald-800";
                        } else if (isSelectedWrong) {
                          buttonStyle = "bg-rose-50 border-rose-250 text-rose-800";
                        } else {
                          buttonStyle = "opacity-40 border-[#c2c7cc]/40 bg-[#f8fafb] cursor-not-allowed";
                        }
                      }

                      return (
                        <button
                          key={i}
                          disabled={hasSelectedAnyWrong}
                          onClick={() => {
                            if (opt === currentWord.word) {
                              setRevealed(true);
                            } else {
                              setSelectedWrongOption(opt);
                              setIsReinforced(true);
                            }
                          }}
                          className={`h-14 border rounded-xl font-bold text-[14.5px] transition-all cursor-pointer flex items-center justify-center px-4 ${buttonStyle} active:scale-[0.98] select-none`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  {selectedWrongOption !== null && (
                    <div className="mt-6 p-5 rounded-2xl border border-rose-200 bg-rose-50 text-left animate-in fade-in-50 duration-200 space-y-3.5">
                      <div className="text-[13px] text-rose-800 font-bold flex items-center gap-2 flex-wrap">
                        <span>Not quite! The correct answer is:</span>
                        <span className="font-mono bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-lg border border-emerald-200/50 font-bold">
                          {currentWord.word}
                        </span>
                      </div>
                      <p className="text-[12px] text-rose-600 font-semibold leading-relaxed">
                        {isReinforced 
                          ? "We've scheduled this word for reinforcement review within this session." 
                          : "Reinforcement review disabled."}
                      </p>
                      
                      <div className="flex gap-2 pt-2 border-t border-rose-200/40">
                        <button
                          type="button"
                          onClick={() => setIsReinforced(!isReinforced)}
                          className="h-9 px-3.5 rounded-lg border border-rose-200 bg-white text-rose-700 text-[12px] hover:bg-rose-50 font-bold transition-all cursor-pointer select-none"
                        >
                          {isReinforced ? "Cancel Reinforce" : "Reinforce Term"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAnswer(isReinforced ? 'again' : 'good')}
                          disabled={isSubmitting}
                          className="h-9 px-4.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[12px] font-bold flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 select-none"
                        >
                          {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Continue'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {currentMode === 'spelling' && (
                <div className="space-y-6">
                  <div className="p-5.5 rounded-2xl border border-[#c2c7cc]/60 bg-[#f2f4f5]/30 leading-relaxed font-semibold text-[15.5px] text-[#191c1d] max-w-lg mx-auto">
                    {currentWord.definition || currentWord.translation || "No definition available."}
                  </div>
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (spellInput.trim().toLowerCase() === currentWord.word.toLowerCase()) {
                        setRevealed(true);
                      } else {
                        setSpellError(true);
                        setTimeout(() => setSpellError(false), 800);
                      }
                    }}
                    className="max-w-xs mx-auto space-y-3.5 pt-2"
                  >
                    <input
                      type="text"
                      autoFocus
                      placeholder="Spell the word..."
                      value={spellInput}
                      onChange={(e) => setSpellInput(e.target.value)}
                      className={`w-full h-12 bg-white border ${spellError ? 'border-rose-500 focus:ring-rose-500/20' : 'border-[#c2c7cc] focus:border-[#002434]'} rounded-xl px-4 text-[17px] font-extrabold text-center focus:outline-none focus:ring-2 focus:ring-[#002434]/10 transition-all text-[#191c1d]`}
                    />
                    <button
                      type="submit"
                      className="w-full h-11 border border-[#002434] bg-white hover:bg-[#002434]/5 text-[#002434] rounded-xl font-bold transition-all text-[13.5px] cursor-pointer shadow-sm active:scale-[0.98] select-none"
                    >
                      Verify Spelling
                    </button>
                  </form>
                  <div className="pt-2">
                    <button 
                      onClick={() => setRevealed(true)}
                      className="text-[12.5px] text-[#42474b] hover:text-[#191c1d] underline font-bold cursor-pointer select-none"
                    >
                      I don't know (Reveal)
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 md:p-10 shadow-sm space-y-6 md:space-y-8 animate-in fade-in-50 duration-300 max-h-[70vh] overflow-y-auto">
              {/* Card Header Information */}
              <div className="text-center pb-6 border-b border-[#c2c7cc]/40">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-4 flex items-center justify-center gap-1.5">
                  <span>{displayWord.language}</span>
                  <span>•</span>
                  <span>Target Details</span>
                </div>
                <div className="flex items-center justify-center w-full gap-3 flex-wrap mb-3">
                  <span className="text-[34px] md:text-[40px] font-extrabold text-[#191c1d] tracking-tight leading-none">
                    {displayWord.word}
                  </span>
                  <button
                    onClick={() => speakWord(displayWord.word, displayWord.language)}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-[#f2f4f5] hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d] transition-all cursor-pointer shadow-sm active:scale-90"
                    title="Pronounce"
                  >
                    <Volume2 className="w-4.5 h-4.5" strokeWidth={2} />
                  </button>
                </div>
                {displayWord.ipa && (
                  <div className="text-[13px] font-mono text-[#002434] bg-[#002434]/5 border border-[#002434]/10 rounded-lg px-2.5 py-0.5 inline-block mb-3.5 font-bold">
                    /{displayWord.ipa.replace(/^\/|\/$/g, '')}/
                  </div>
                )}
                {displayWord.pos && (
                  <div className="mb-3.5">
                    <span className="px-2.5 py-0.5 bg-[#eceeef] border border-[#c2c7cc]/50 rounded-lg text-[10px] font-bold text-[#42474b] uppercase select-none tracking-wider">
                      {displayWord.pos}
                    </span>
                  </div>
                )}
                <div className="text-[19px] font-bold text-[#002434] mt-2 select-all">{displayWord.translation}</div>
              </div>

              {/* Rich Linguistic Contents */}
              <div className="space-y-6 text-left">
                {displayWord.definition && (
                  <div className="space-y-2">
                    <div className="text-[10px] text-[#42474b]/85 font-bold uppercase tracking-wider">Definition</div>
                    <div className="text-[14px] leading-relaxed text-[#191c1d] font-semibold">
                      {displayWord.definition}
                    </div>
                  </div>
                )}

                {displayWord.examples && displayWord.examples.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-[10px] text-[#42474b]/85 font-bold uppercase tracking-wider">Examples Sentences</div>
                    <div className="space-y-3">
                      {displayWord.examples.map((ex, idx) => {
                        const sentence = typeof ex === 'object' ? ex.sentence : ex;
                        const trans = typeof ex === 'object' ? ex.translation : '';
                        return (
                          <div key={idx} className="pl-3.5 border-l-2 border-[#002434]/25 py-0.5 space-y-0.5">
                            <div className="text-[14px] leading-relaxed font-bold text-[#191c1d]">
                              {sentence}
                            </div>
                            {trans && (
                              <div className="text-[12.5px] text-[#42474b] font-semibold">{trans}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {displayWord.collocations && displayWord.collocations.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-[10px] text-[#42474b]/85 font-bold uppercase tracking-wider">Common Collocations</div>
                    <div className="flex flex-wrap gap-1.5">
                      {displayWord.collocations.map((item, i) => (
                        <span key={i} className="px-2.5 py-0.5 bg-[#eceeef] rounded-lg text-[12.5px] font-semibold text-[#42474b] border border-[#c2c7cc]/50">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {(displayWord.synonyms?.length > 0 || displayWord.relatedWords?.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {displayWord.synonyms && displayWord.synonyms.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-[#42474b]/85 font-bold uppercase tracking-wider">Synonyms</div>
                        <div className="flex flex-wrap gap-1.5">
                          {displayWord.synonyms.map((item, i) => (
                            <span key={i} className="px-2.5 py-0.5 bg-emerald-50 border border-emerald-250/20 rounded-lg text-[12px] font-semibold text-emerald-800">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {displayWord.relatedWords && displayWord.relatedWords.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-[#42474b]/85 font-bold uppercase tracking-wider">Related Words</div>
                        <div className="flex flex-wrap gap-1.5">
                          {displayWord.relatedWords.map((item, i) => (
                            <span key={i} className="px-2.5 py-0.5 bg-blue-50 border border-blue-250/20 rounded-lg text-[12px] font-semibold text-blue-800">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {displayWord.collection && (
                  <div className="flex flex-wrap items-center gap-2 pt-4.5 border-t border-[#c2c7cc]/40">
                    <span className="px-2.5 py-0.5 bg-[#eceeef] border border-[#c2c7cc]/60 rounded-lg text-[10px] font-bold uppercase tracking-wider text-[#42474b] select-none">
                      {displayWord.collection}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Exquisite Rating Spaced Repetition Bottom Buttons Panel */}
      {revealed && (
        <div className="border-t border-[#c2c7cc]/60 bg-white p-6 md:p-7.5 relative z-20">
          <div className="max-w-xl mx-auto">
            <div className="text-[11.5px] text-[#42474b] font-bold text-center mb-4 uppercase tracking-wider">
              Rate your recall ability
            </div>
            <div className="grid grid-cols-4 gap-3.5">
              {/* Again */}
              <button 
                onClick={() => handleAnswer('again')}
                disabled={isSubmitting}
                className="h-14 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-250 text-rose-800 transition-all disabled:opacity-50 cursor-pointer flex flex-col items-center justify-center shadow-sm active:scale-95"
              >
                <div className="text-[13.5px] font-extrabold">Again</div>
                <div className="text-[9.5px] font-bold uppercase tracking-wide mt-0.5 text-rose-600/80">Soon</div>
              </button>
              
              {/* Hard */}
              <button 
                onClick={() => handleAnswer('hard')}
                disabled={isSubmitting}
                className="h-14 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-250 text-amber-800 transition-all disabled:opacity-50 cursor-pointer flex flex-col items-center justify-center shadow-sm active:scale-95"
              >
                <div className="text-[13.5px] font-extrabold">Hard</div>
                <div className="text-[9.5px] font-bold uppercase tracking-wide mt-0.5 text-amber-600/80">1 Day</div>
              </button>
              
              {/* Good */}
              <button 
                onClick={() => handleAnswer('good')}
                disabled={isSubmitting}
                className="h-14 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-250 text-blue-800 transition-all disabled:opacity-50 cursor-pointer flex flex-col items-center justify-center shadow-sm active:scale-95"
              >
                <div className="text-[13.5px] font-extrabold">Good</div>
                <div className="text-[9.5px] font-bold uppercase tracking-wide mt-0.5 text-blue-600/80">3 Days</div>
              </button>
              
              {/* Easy */}
              <button 
                onClick={() => handleAnswer('easy')}
                disabled={isSubmitting}
                className="h-14 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-250 text-emerald-800 transition-all disabled:opacity-50 cursor-pointer flex flex-col items-center justify-center shadow-sm active:scale-95"
              >
                <div className="text-[13.5px] font-extrabold">Easy</div>
                <div className="text-[9.5px] font-bold uppercase tracking-wide mt-0.5 text-emerald-600/80">7 Days</div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
