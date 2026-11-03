import { useVocabularyVersion } from '../hooks/useVocabularyVersion';
import { RotateCcw, TrendingUp, Clock, Calendar, Loader2, BookOpen, Layers, Settings, Check, HelpCircle } from 'lucide-react';
import { useNavigate } from "react-router";
import { useState, useEffect } from 'react';
import { fetchReviewQueue, fetchCollections, type VocabularyWord, type Collection } from '../../lib/api';
import { SelectField, type SelectOption } from '../components/ui/SelectField';

export function ReviewHub() {
  const vocabularyVersion = useVocabularyVersion();
  const navigate = useNavigate();
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedModes, setSelectedModes] = useState({
    flashcard: true,
    multipleChoice: true,
    spelling: true
  });
  const [wordCountMode, setWordCountMode] = useState<'preset' | 'custom'>('preset');
  const [collectionId, setCollectionId] = useState<string>('all');
  const [wordCount, setWordCount] = useState<number>(20);
  const [customWordCount, setCustomWordCount] = useState<string>('20');
  const [collections, setCollections] = useState<Collection[]>([]);

  const collectionOptions: SelectOption[] = [
    { value: 'all', label: 'All Library Words' },
    ...collections.map(c => ({ value: c.id, label: c.name }))
  ];

  const wordCountOptions: SelectOption[] = [
    { value: '10', label: '10 Words' },
    { value: '20', label: '20 Words' },
    { value: '50', label: '50 Words' },
    { value: '100', label: '100 Words' },
    { value: 'custom', label: 'Custom count...' }
  ];

  const activeModes = Object.entries(selectedModes).filter(([_, v]) => v).map(([k]) => k);

  useEffect(() => {
    Promise.all([
      fetchReviewQueue(100, collectionId),
      fetchCollections()
    ])
      .then(([words, cols]) => {
        setDueCount(words.length);
        setCollections(cols);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [collectionId, vocabularyVersion]);

  const handleToggleMode = (mode: 'flashcard' | 'multipleChoice' | 'spelling') => {
    setSelectedModes(prev => {
      const next = { ...prev, [mode]: !prev[mode] };
      // Ensure at least one mode is active
      const activeCount = Object.values(next).filter(Boolean).length;
      return activeCount > 0 ? next : prev;
    });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-24">
      {/* Header Block */}
      <div className="shrink-0 border-b border-[#c2c7cc]/50 pb-5">
        <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none">
          Spaced Repetition System
        </div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-[#191c1d] leading-none mt-1">
          Review Hub
        </h1>
        <p className="text-[13.5px] text-[#42474b] font-medium mt-2">
          Strengthen memory retention with structured active recall spaced repetition sessions.
        </p>
      </div>

      <div className="rounded-2xl border border-teal-200 bg-white p-5"><h2 className="font-bold">Exercise Review</h2><p className="mt-1 text-sm text-slate-600">Review due grammar and question cards with their own saved progress.</p><button className="mt-3 min-h-11 rounded-xl bg-[#002434] px-5 py-2 text-sm font-bold text-white" onClick={()=>navigate('/exercises')}>Choose Exercise Set / Review all due</button></div>
      {/* Main Configuration Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        
        {/* Left Column: Study Queue Card */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 flex flex-col justify-between h-full shadow-sm">
            {/* Header */}
            <div className="space-y-1 border-b border-[#c2c7cc]/40 pb-3 flex items-center gap-2">
              <Calendar className="w-4.5 h-4.5 text-[#002434]/80" strokeWidth={1.5} />
              <h3 className="font-bold text-[14.5px] text-[#191c1d] tracking-tight">Recall Queue</h3>
            </div>
            
            {/* Content */}
            <div className="py-6 flex flex-col items-center justify-center text-center space-y-1.5 flex-grow">
              <div className="text-[52px] font-extrabold text-[#002434] leading-none tracking-tight font-mono select-all">
                {isLoading ? (
                  <Loader2 className="w-10 h-10 animate-spin text-[#002434]/40" strokeWidth={1.5} />
                ) : (
                  dueCount
                )}
              </div>
              <span className="text-[11px] font-bold text-[#42474b] uppercase tracking-wider">
                Words Due Today
              </span>
            </div>

            {/* Estimated time block */}
            <div className="space-y-4">
              <div className="p-3.5 bg-[#f2f4f5]/65 border border-[#c2c7cc]/50 rounded-2xl flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-405" strokeWidth={2} />
                  <span className="text-[12.5px] text-[#42474b] font-semibold">Estimated Duration</span>
                </div>
                <span className="text-[13px] font-mono font-bold text-[#002434]">
                  {dueCount !== null ? Math.ceil(dueCount * 0.5) : 0} mins
                </span>
              </div>
              
              <p className="text-[12px] text-[#42474b]/80 font-semibold leading-normal text-center px-1">
                Bring your words, learn smarter. Consolidate your memory curve today.
              </p>
            </div>

            {/* CTA Trigger (Refined, elegant outline styling) */}
            <div className="pt-6">
              <button
                onClick={() => navigate('/review/session', { state: { activeModes, collectionId, limit: wordCount } })}
                disabled={dueCount === 0 || isLoading || activeModes.length === 0}
                className="w-full h-11 border border-[#002434] bg-white hover:bg-[#002434]/5 text-[#002434] rounded-xl transition-all font-extrabold text-[13.5px] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm active:scale-[0.98] select-none flex items-center justify-center gap-2"
              >
                {dueCount === 0 ? "All Caught Up!" : "Start Recall Session"}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Session Configuration Card */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 flex flex-col justify-between h-full shadow-sm">
            {/* Header */}
            <div className="space-y-1 border-b border-[#c2c7cc]/40 pb-3 flex items-center gap-2">
              <Settings className="w-4.5 h-4.5 text-[#002434]/80" strokeWidth={1.5} />
              <h3 className="font-bold text-[14.5px] text-[#191c1d] tracking-tight">Configuration Settings</h3>
            </div>

            {/* Content Form */}
            <div className="space-y-6 flex-grow pt-4.5">
              {/* 1. Review Format Selection (Checkpills refined) */}
              <div className="space-y-2.5">
                <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider">
                  1. Study Formats
                </label>
                <div className="flex flex-wrap gap-2.5">
                  {/* Flashcard Pill */}
                  <button
                    type="button"
                    onClick={() => handleToggleMode('flashcard')}
                    className={`h-10 px-4 rounded-xl border text-[13px] font-bold flex items-center gap-2 cursor-pointer select-none transition-all ${
                      selectedModes.flashcard
                        ? 'bg-[#002434]/5 text-[#002434] border-[#002434] shadow-sm'
                        : 'bg-white text-[#42474b] border-[#c2c7cc] hover:bg-[#f2f4f5]/40'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${selectedModes.flashcard ? 'bg-white/10 border-[#002434]/30' : 'border-[#c2c7cc]'}`}>
                      {selectedModes.flashcard && <Check className="w-2 h-2 text-[#002434]" strokeWidth={3} />}
                    </span>
                    <span>Flashcard</span>
                  </button>

                  {/* Multiple Choice Pill */}
                  <button
                    type="button"
                    onClick={() => handleToggleMode('multipleChoice')}
                    className={`h-10 px-4 rounded-xl border text-[13px] font-bold flex items-center gap-2 cursor-pointer select-none transition-all ${
                      selectedModes.multipleChoice
                        ? 'bg-[#002434]/5 text-[#002434] border-[#002434] shadow-sm'
                        : 'bg-white text-[#42474b] border-[#c2c7cc] hover:bg-[#f2f4f5]/40'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${selectedModes.multipleChoice ? 'bg-white/10 border-[#002434]/30' : 'border-[#c2c7cc]'}`}>
                      {selectedModes.multipleChoice && <Check className="w-2 h-2 text-[#002434]" strokeWidth={3} />}
                    </span>
                    <span>Multiple Choice</span>
                  </button>

                  {/* Spelling Pill */}
                  <button
                    type="button"
                    onClick={() => handleToggleMode('spelling')}
                    className={`h-10 px-4 rounded-xl border text-[13px] font-bold flex items-center gap-2 cursor-pointer select-none transition-all ${
                      selectedModes.spelling
                        ? 'bg-[#002434]/5 text-[#002434] border-[#002434] shadow-sm'
                        : 'bg-white text-[#42474b] border-[#c2c7cc] hover:bg-[#f2f4f5]/40'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${selectedModes.spelling ? 'bg-white/10 border-[#002434]/30' : 'border-[#c2c7cc]'}`}>
                      {selectedModes.spelling && <Check className="w-2 h-2 text-[#002434]" strokeWidth={3} />}
                    </span>
                    <span>Spelling Write</span>
                  </button>
                </div>
              </div>

              {/* 2. Collection Filters & Word Count Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Collection Dropdown */}
                <div className="space-y-2">
                  <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
                    <span>2. Source Material</span>
                  </label>
                  <SelectField
                    value={collectionId}
                    onChange={(val) => {
                      setIsLoading(true);
                      setCollectionId(val);
                    }}
                    options={collectionOptions}
                  />
                </div>

                {/* Threshold Dropdown */}
                <div className="space-y-2">
                  <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
                    <span>3. Threshold Limit</span>
                  </label>
                  <div className="flex gap-2">
                    <SelectField
                      className="flex-1"
                      value={wordCountMode === 'custom' ? 'custom' : wordCount.toString()}
                      onChange={(val) => {
                        if (val === 'custom') {
                          setWordCountMode('custom');
                          const parsed = parseInt(customWordCount, 10);
                          if (!isNaN(parsed) && parsed >= 1 && parsed <= 200) {
                            setWordCount(parsed);
                          } else {
                            setWordCount(20);
                          }
                        } else {
                          setWordCountMode('preset');
                          const num = parseInt(val, 10);
                          setWordCount(num);
                          setCustomWordCount(val);
                        }
                      }}
                      options={wordCountOptions}
                    />
                    
                    {wordCountMode === 'custom' && (
                      <input
                        type="number"
                        min="1"
                        max="200"
                        value={customWordCount}
                        onChange={(e) => {
                          setCustomWordCount(e.target.value);
                          const parsed = parseInt(e.target.value, 10);
                          if (!isNaN(parsed) && parsed >= 1 && parsed <= 200) {
                            setWordCount(parsed);
                          } else {
                            setWordCount(20);
                          }
                        }}
                        className="w-1/3 h-10 bg-white border border-[#c2c7cc] rounded-xl px-3 text-[13px] focus:outline-none focus:border-[#002434] focus:ring-2 focus:ring-[#002434]/10 transition-all font-bold text-[#191c1d]"
                        placeholder="1-200"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Helper Info Footer to balance visual height */}
            <div className="text-[11px] text-slate-400 font-bold flex items-center gap-1.5 pt-6 border-t border-[#c2c7cc]/30 select-none">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Select recall options to customize session algorithms.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Spaced Repetition Statistics Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
        <div className="bg-white border border-[#c2c7cc]/60 rounded-2xl p-5.5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-[#42474b] select-none">
            <Calendar className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Weekly Volume</span>
          </div>
          <div className="text-[28px] font-extrabold text-[#191c1d] leading-none">--</div>
          <p className="text-[11.5px] text-[#42474b] font-semibold select-none">Terms reviewed this week</p>
        </div>

        <div className="bg-white border border-[#c2c7cc]/60 rounded-2xl p-5.5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-[#42474b] select-none">
            <TrendingUp className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Recall Accuracy</span>
          </div>
          <div className="text-[28px] font-extrabold text-[#191c1d] leading-none">--%</div>
          <p className="text-[11.5px] text-[#42474b] font-semibold select-none">Average target memory accuracy</p>
        </div>

        <div className="bg-white border border-[#c2c7cc]/60 rounded-2xl p-5.5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-[#42474b] select-none">
            <Clock className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Learning Time</span>
          </div>
          <div className="text-[28px] font-extrabold text-[#191c1d] leading-none">--</div>
          <p className="text-[11.5px] text-[#42474b] font-semibold select-none">Total minutes studied this week</p>
        </div>
      </div>
    </div>
  );
}
