import { 
  ArrowLeft, 
  Save, 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  Plus, 
  FolderOpen, 
  Edit2, 
  Check, 
  X, 
  BookOpen, 
  Globe, 
  Layers 
} from 'lucide-react';
import { useNavigate, useLocation } from "react-router";
import { useState, useEffect } from 'react';
import { enrichWord, bulkEnrichWords, createWord, fetchCollections, createCollection, type Collection } from '../../lib/api';
import { SelectField, type SelectOption } from '../components/ui/SelectField';

export function ImportStep3() {
  const navigate = useNavigate();
  const location = useLocation();
  const data = location.state;
  
  const text = data?.text || '';
  const language = data?.language || 'English';
  const title = data?.title || '';
  const initialWords = data?.words || [];

  const [words, setWords] = useState<any[]>(initialWords);
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  
  const [tags, setTags] = useState(''); // kept for backward compatibility / references
  
  const collectionOptions: SelectOption[] = [
    { value: '', label: 'None (Library Root)' },
    ...collections.map(c => ({ value: c.name, label: c.name })),
    { value: '___CREATE_NEW___', label: '+ Create new collection...' }
  ];

  const posOptions: SelectOption[] = [
    { value: 'Noun', label: 'Noun' },
    { value: 'Verb', label: 'Verb' },
    { value: 'Adjective', label: 'Adjective' },
    { value: 'Adverb', label: 'Adverb' },
    { value: 'Pronoun', label: 'Pronoun' },
    { value: 'Preposition', label: 'Preposition' },
    { value: 'Conjunction', label: 'Conjunction' },
    { value: 'Interjection', label: 'Interjection' }
  ];

  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichedCount, setEnrichedCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [saveProgressCount, setSaveProgressCount] = useState(0);
  const [currentSavingWord, setCurrentSavingWord] = useState('');

  // Inline editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftWord, setDraftWord] = useState<any>(null);

  // Load collections
  useEffect(() => {
    fetchCollections().then(setCollections).catch(console.error);
  }, []);

  // AI enrichment runs only after the user explicitly requests it.
  const performEnrichment = async () => {
    if (!initialWords.length) {
      setIsEnriching(false);
      return;
    }

    setIsEnriching(true);
      try {
        const aiDataList = await bulkEnrichWords(words, language);
        
          const enriched = words.map((item, i) => {
            const aiData = aiDataList.find(a => a.word?.toLowerCase() === item.word?.toLowerCase()) || aiDataList[i] || {};
            return {
              ...item,
              ...aiData,
              translation: aiData.translation || item.translation,
              pos: aiData.pos || item.pos || 'Noun'
            };
          });
          setWords(enriched);
          setEnrichedCount(enriched.length);
          setIsEnriching(false);
      } catch (err: any) {
        console.error("Bulk enrichment failed", err);
          setIsEnriching(false);
          
          const errMsg = err?.message || '';
          if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit') || errMsg.includes('429') || errMsg.toLowerCase().includes('temporarily unavailable')) {
            setError('AI enrichment is temporarily unavailable. You can still save the words manually, or try again later.');
          } else {
            setError('AI enrichment failed. You can still save the words manually without AI assistance.');
          }
      }
  };

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpanded(newExpanded);
  };

  const expandAll = () => {
    setExpanded(new Set(words.map((_, i) => i)));
  };

  const collapseAll = () => {
    setExpanded(new Set());
  };

  const startEditing = (i: number, e: React.MouseEvent) => {
    e.stopPropagation(); // prevent accordion toggle!
    setEditingIndex(i);
    setDraftWord({ ...words[i] });
  };

  const updateDraftField = (field: string, value: any) => {
    setDraftWord((prev: any) => ({
      ...prev,
      [field]: value
    }));
  };

  const updateDraftExampleSentence = (exampleIndex: number, sentence: string) => {
    setDraftWord((prev: any) => {
      const examples = [...(prev.examples || [])];
      if (examples[exampleIndex]) {
        examples[exampleIndex] = { ...examples[exampleIndex], sentence };
      } else {
        examples[exampleIndex] = { sentence, translation: '' };
      }
      return { ...prev, examples };
    });
  };

  const updateDraftExampleTranslation = (exampleIndex: number, translation: string) => {
    setDraftWord((prev: any) => {
      const examples = [...(prev.examples || [])];
      if (examples[exampleIndex]) {
        examples[exampleIndex] = { ...examples[exampleIndex], translation };
      } else {
        examples[exampleIndex] = { sentence: '', translation };
      }
      return { ...prev, examples };
    });
  };

  const saveDraftChanges = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingIndex === null || !draftWord) return;
    const newWords = [...words];
    newWords[editingIndex] = draftWord;
    setWords(newWords);
    setEditingIndex(null);
    setDraftWord(null);
  };

  const cancelDraftChanges = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingIndex(null);
    setDraftWord(null);
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    setError(null);
    try {
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        setSaveProgressCount(i + 1);
        setCurrentSavingWord(word.word);
        
        await createWord({
          word: word.word,
          ipa: word.ipa,
          translation: word.translation || '',
          language,
          pos: word.pos || 'Noun',
          source: title || 'Article import',
          collection: selectedCollection || undefined,
          definition: word.definition,
          examples: word.examples || [],
          collocations: word.collocations || [],
          synonyms: word.synonyms || [],
          relatedWords: word.relatedWords || []
        });
      }
      navigate('/library?type=vocabulary');
    } catch (err) {
      const failedWordStr = currentSavingWord ? ` (failed at "${currentSavingWord}")` : '';
      setError((err instanceof Error ? err.message : 'Failed to save words') + failedWordStr);
      setIsSaving(false);
    }
  };

  if (isEnriching) {
    return (
      <div className="fixed inset-0 bg-[#f8fafb] flex flex-col items-center justify-center p-8 z-50 animate-in fade-in duration-300">
        <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-10 text-center max-w-lg shadow-xl shadow-slate-200/30 space-y-6 border-b-4 border-b-[#002434]">
          <div className="w-16 h-16 rounded-2xl bg-[#002434]/5 border border-[#002434]/10 flex items-center justify-center mx-auto text-[#002434] shadow-sm animate-bounce">
            <Sparkles className="w-8 h-8 animate-pulse text-[#002434]" strokeWidth={1.5} />
          </div>
          <div className="space-y-2">
            <h2 className="text-[22px] font-extrabold tracking-tight text-[#191c1d]">AI Enriching Vocabulary</h2>
            <p className="text-[#42474b] text-[14px] leading-relaxed max-w-md mx-auto font-medium">
              Voca is dynamically generating definitions, IPA phonetics, common collocations, and contextual examples for your selected terms.
            </p>
          </div>
          
          <div className="space-y-3 bg-[#f8fafb] rounded-2xl p-4 border border-[#c2c7cc]/40">
            <div className="flex items-center justify-between text-[12px] font-bold text-[#42474b]">
              <span>Processing pipeline</span>
              <span className="font-mono text-[#002434] bg-[#002434]/5 px-2 py-0.5 rounded border border-[#002434]/10">{initialWords.length} candidates</span>
            </div>
            <div className="w-full h-2.5 bg-[#eceeef] rounded-full overflow-hidden border border-[#c2c7cc]/30">
              <div className="h-full bg-[#002434] rounded-full animate-pulse w-full"></div>
            </div>
          </div>
          
          <div className="text-[12px] text-slate-400 font-semibold flex items-center justify-center gap-1.5 pt-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Analyzing grammatical structures...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6 bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-28">
      {/* Top Bar Navigation */}
      <div className="shrink-0 flex items-center justify-between border-b border-[#c2c7cc]/50 pb-4.5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/import/step2', { state: data })}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#c2c7cc]/60 hover:bg-[#eceeef] text-[#42474b] hover:text-[#191c1d] transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 bg-white"
            title="Back to selection"
          >
            <ArrowLeft className="w-4.5 h-4.5" strokeWidth={2} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#e6e8e9] text-[#002434] border border-[#c2c7cc]/50 flex items-center justify-center text-[14px] font-bold shadow-sm shrink-0">
              3
            </div>
            <div>
              <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none">
                Import Workspace
              </div>
              <h1 className="text-[24px] font-extrabold tracking-tight text-[#191c1d] leading-none mt-0.5">
                Review & Save Pipeline
              </h1>
            </div>
          </div>
        </div>
      </div>

      {isSaving && (
        <div className="bg-white border border-[#c2c7cc]/60 rounded-2xl p-5 flex flex-col gap-3 shadow-md animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-[13.5px] font-bold text-[#191c1d]">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#002434]" />
              <span>Saving words: <span className="font-mono text-[#002434] bg-[#002434]/5 px-2 py-0.5 rounded border border-[#002434]/10">"{currentSavingWord}"</span></span>
            </div>
            <div className="font-mono text-[#002434]">
              {saveProgressCount} / {words.length}
            </div>
          </div>
          <div className="w-full h-2 bg-[#f2f4f5] rounded-full overflow-hidden border border-[#c2c7cc]/30">
            <div 
              className="h-full bg-[#002434] transition-all duration-300 rounded-full" 
              style={{ width: `${(saveProgressCount / words.length) * 100}%` }}
            ></div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200/50 bg-rose-50 px-4 py-3.5 text-[13.5px] font-semibold text-rose-750 flex items-start gap-2 shadow-sm">
          <div className="w-5 h-5 rounded-full bg-rose-100 flex items-center justify-center text-rose-700 shrink-0 font-extrabold select-none text-[12px]">!</div>
          <p>{error}</p>
        </div>
      )}

      {/* Batch parameters settings card */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4">
        <p className="text-sm text-muted-foreground">Review and save as supplied, or explicitly request AI enrichment.</p>
        <button type="button" onClick={performEnrichment} disabled={!words.length || isSaving}
          className="rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">Enrich selected with AI</button>
      </div>
      <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-[#c2c7cc]/40 pb-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-[#002434]/70" strokeWidth={2} />
            <h3 className="font-bold text-[15px] text-[#191c1d] tracking-tight">Pipeline Import Parameters</h3>
          </div>
          <span className="text-[12px] font-bold text-[#42474b] bg-[#f2f4f5] px-2.5 py-1 rounded-lg border border-[#c2c7cc]/50">
            {words.length} Selected Words
          </span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Destination Collection Select */}
          <div className="space-y-2">
            <label className="block text-[12px] font-bold text-[#42474b] uppercase tracking-wider">
              Destination Collection
            </label>
            {isCreatingCollection ? (
              <div className="flex gap-2 animate-in fade-in-50 duration-150">
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="Enter collection name..."
                  className="flex-1 h-10 px-3.5 bg-[#f8fafb] border border-[#c2c7cc] rounded-xl text-[13.5px] focus:outline-none focus:border-[#002434] focus:ring-2 focus:ring-[#002434]/10 transition-all text-[#191c1d] font-semibold"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newCollectionName.trim()) return;
                    try {
                      const created = await createCollection({ name: newCollectionName.trim(), description: '' });
                      setCollections([...collections, created]);
                      setSelectedCollection(created.name);
                      setIsCreatingCollection(false);
                      setNewCollectionName('');
                    } catch (err) {
                      setError('Failed to create collection');
                    }
                  }}
                  className="h-10 px-4 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 font-bold rounded-xl text-[13px] cursor-pointer shadow-sm active:scale-95 transition-all"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingCollection(false)}
                  className="h-10 px-4 border border-[#c2c7cc] bg-white hover:bg-[#f2f4f5] text-[#42474b] font-bold rounded-xl text-[13px] cursor-pointer transition-all"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <SelectField
                value={selectedCollection}
                onChange={(val) => {
                  if (val === '___CREATE_NEW___') {
                    setIsCreatingCollection(true);
                  } else {
                    setSelectedCollection(val);
                  }
                }}
                options={collectionOptions}
              />
            )}
            <p className="text-[11.5px] text-[#42474b] font-semibold">
              Words will be imported to the selected folder workspace.
            </p>
          </div>

          {/* Import Source Metadata */}
          <div className="space-y-2">
            <label className="block text-[12px] font-bold text-[#42474b] uppercase tracking-wider">
              Import Metadata
            </label>
            <div className="bg-[#f8fafb] border border-[#c2c7cc]/50 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between text-[13px] font-semibold text-[#42474b]">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <Globe className="w-4 h-4" strokeWidth={1.5} /> Language:
                </span>
                <span className="text-[#002434] font-bold bg-[#002434]/5 px-2 py-0.5 rounded border border-[#002434]/10 text-[12px]">
                  {language}
                </span>
              </div>
              <div className="flex items-center justify-between text-[13px] font-semibold text-[#42474b]">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <Layers className="w-4 h-4" strokeWidth={1.5} /> Source Origin:
                </span>
                <span className="text-[#191c1d] font-bold max-w-[200px] truncate" title={title || 'Pasted Content'}>
                  {title || 'Pasted Content'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Accordions controls & candidates list */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pt-2">
          <h3 className="font-bold text-[15px] text-[#191c1d]">Vocabulary Candidates ({words.length})</h3>
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="text-[11.5px] font-bold text-[#002434] hover:text-[#0a3346] px-2.5 py-1 rounded-lg border border-[#c2c7cc]/60 hover:bg-[#eceeef] bg-white transition-all select-none active:scale-95 cursor-pointer shadow-sm"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="text-[11.5px] font-bold text-[#42474b] hover:text-[#191c1d] px-2.5 py-1 rounded-lg border border-[#c2c7cc]/60 hover:bg-[#eceeef] bg-white transition-all select-none active:scale-95 cursor-pointer shadow-sm"
            >
              Collapse All
            </button>
          </div>
        </div>

        <div className="space-y-4.5">
          {words.map((item, i) => {
            const isExpanded = expanded.has(i);
            const isEditing = editingIndex === i;

            if (isEditing && draftWord) {
              return (
                <form key={i} onSubmit={saveDraftChanges} className="bg-white border border-[#002434]/40 rounded-2xl overflow-hidden shadow-md transition-all animate-in fade-in-50 duration-150">
                  <div className="px-6 py-4.5 bg-[#002434]/5 border-b border-[#c2c7cc]/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Edit2 className="w-4 h-4 text-[#002434]" />
                      <span className="font-bold text-[13.5px] text-[#002434] uppercase tracking-wide">Editing Candidate #{i + 1}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelDraftChanges}
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#c2c7cc]/70 bg-white hover:bg-[#f2f4f5] text-[#42474b] transition-all cursor-pointer"
                        title="Cancel changes"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        type="submit"
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-[#002434]/10 hover:bg-[#002434]/20 text-[#002434] transition-all cursor-pointer"
                        title="Save changes"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-4 bg-[#f8fafb]/30">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Word */}
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold text-[#42474b] uppercase tracking-wider">Word term</label>
                        <input
                          type="text"
                          value={draftWord.word || ''}
                          onChange={(e) => updateDraftField('word', e.target.value)}
                          className="w-full h-9 px-3 bg-white border border-[#c2c7cc] rounded-lg text-[13px] focus:outline-none focus:border-[#002434] transition-all text-[#191c1d] font-bold"
                          required
                        />
                      </div>
                      
                      {/* IPA */}
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold text-[#42474b] uppercase tracking-wider">IPA Phonetics</label>
                        <input
                          type="text"
                          value={draftWord.ipa || ''}
                          onChange={(e) => updateDraftField('ipa', e.target.value)}
                          placeholder="/ pronunciation /"
                          className="w-full h-9 px-3 bg-white border border-[#c2c7cc] rounded-lg text-[13px] focus:outline-none focus:border-[#002434] transition-all text-[#191c1d] font-mono font-semibold"
                        />
                      </div>
                      
                      {/* POS */}
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold text-[#42474b] uppercase tracking-wider">Part of Speech</label>
                        <SelectField
                          value={draftWord.pos || 'Noun'}
                          onChange={(val) => updateDraftField('pos', val)}
                          options={posOptions}
                          variant="compact"
                        />
                      </div>
                    </div>

                    {/* Translation */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-[#42474b] uppercase tracking-wider">Translation / Meaning</label>
                      <input
                        type="text"
                        value={draftWord.translation || ''}
                        onChange={(e) => updateDraftField('translation', e.target.value)}
                        className="w-full h-9 px-3 bg-white border border-[#c2c7cc] rounded-lg text-[13px] focus:outline-none focus:border-[#002434] transition-all text-[#191c1d] font-semibold"
                        required
                      />
                    </div>

                    {/* Definition */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-[#42474b] uppercase tracking-wider">Linguistic Definition</label>
                      <textarea
                        value={draftWord.definition || ''}
                        onChange={(e) => updateDraftField('definition', e.target.value)}
                        rows={2}
                        className="w-full p-3 bg-white border border-[#c2c7cc] rounded-lg text-[13px] focus:outline-none focus:border-[#002434] transition-all text-[#191c1d] font-semibold leading-normal"
                      />
                    </div>

                    {/* Examples */}
                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold text-[#42474b] uppercase tracking-wider">Primary Example Sentence & Translation</label>
                      <div className="grid grid-cols-1 gap-2.5 bg-[#f2f4f5] p-3 rounded-xl border border-[#c2c7cc]/50">
                        <input
                          type="text"
                          value={draftWord.examples?.[0]?.sentence || draftWord.examples?.[0] || ''}
                          onChange={(e) => updateDraftExampleSentence(0, e.target.value)}
                          placeholder="Context sentence..."
                          className="w-full h-9 px-3 bg-white border border-[#c2c7cc]/85 rounded-lg text-[12.5px] focus:outline-none focus:border-[#002434] transition-all text-[#191c1d] font-medium"
                        />
                        <input
                          type="text"
                          value={draftWord.examples?.[0]?.translation || ''}
                          onChange={(e) => updateDraftExampleTranslation(0, e.target.value)}
                          placeholder="Sentence translation..."
                          className="w-full h-9 px-3 bg-white border border-[#c2c7cc]/85 rounded-lg text-[12.5px] focus:outline-none focus:border-[#002434] transition-all text-[#191c1d] font-medium"
                        />
                      </div>
                    </div>

                    {/* Collocations */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-[#42474b] uppercase tracking-wider">Collocations (comma-separated)</label>
                      <input
                        type="text"
                        value={Array.isArray(draftWord.collocations) ? draftWord.collocations.join(', ') : draftWord.collocations || ''}
                        onChange={(e) => updateDraftField('collocations', e.target.value.split(',').map((c: string) => c.trim()).filter(Boolean))}
                        placeholder="e.g. robust system, visual design, custom theme"
                        className="w-full h-9 px-3 bg-white border border-[#c2c7cc] rounded-lg text-[13px] focus:outline-none focus:border-[#002434] transition-all text-[#191c1d]"
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-2.5 border-t border-[#c2c7cc]/50">
                      <button
                        type="button"
                        onClick={cancelDraftChanges}
                        className="h-9 px-4 border border-[#c2c7cc]/70 bg-white hover:bg-[#f2f4f5] text-[#42474b] font-bold rounded-xl text-[12.5px] cursor-pointer transition-all select-none active:scale-95"
                      >
                        Discard
                      </button>
                      <button
                        type="submit"
                        className="h-9 px-4 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 font-bold rounded-xl text-[12.5px] cursor-pointer shadow-sm active:scale-95 transition-all select-none"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                </form>
              );
            }

            return (
              <div key={i} className="bg-white border border-[#c2c7cc]/60 rounded-2xl overflow-hidden shadow-sm transition-all hover:border-[#002434]/25">
                <div
                  onClick={() => toggleExpand(i)}
                  className="w-full px-6 py-4.5 flex items-center justify-between hover:bg-[#f2f4f5]/30 transition-colors text-left cursor-pointer select-none"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#002434]/5 border border-[#002434]/10 flex items-center justify-center text-[#002434] shrink-0">
                      <Sparkles className="w-4.5 h-4.5 animate-pulse text-[#002434]" strokeWidth={1.5} />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2.5 flex-wrap">
                        <span className="font-bold text-[16px] text-[#191c1d] tracking-tight">
                          {item.word}
                        </span>
                        {item.ipa && (
                          <span className="text-[12px] font-mono text-[#002434]/70 bg-[#002434]/5 px-2 rounded border border-[#002434]/10 font-bold select-all">
                            /{item.ipa.replace(/^\/|\/$/g, '')}/
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                        <span className="inline-flex items-center rounded-lg bg-[#eceeef] px-2 py-0.5 text-[10px] font-bold text-[#42474b] uppercase border border-[#c2c7cc]/50 select-none">
                          {item.pos || 'Noun'}
                        </span>
                        <span className="text-[13px] text-[#42474b] font-semibold truncate max-w-[300px]">
                          {item.translation}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => startEditing(i, e)}
                      className="w-8 h-8 flex items-center justify-center rounded-xl border border-[#c2c7cc]/60 bg-white hover:bg-[#eceeef] text-[#42474b] hover:text-[#002434] transition-all cursor-pointer shadow-sm active:scale-90"
                      title="Edit candidate data"
                    >
                      <Edit2 className="w-4 h-4" strokeWidth={2} />
                    </button>
                    <div className="w-8 h-8 flex items-center justify-center text-[#42474b]">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-[#42474b]" strokeWidth={2.5} />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-[#42474b]" strokeWidth={2.5} />
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-6 pb-6 pt-3.5 border-t border-[#c2c7cc]/50 bg-[#f2f4f5]/15 space-y-5 animate-in slide-in-from-top-1 duration-150">
                    {/* Phonetics */}
                    {item.ipa && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-[#42474b]/80 font-bold uppercase tracking-wider">IPA Phonetics</div>
                        <div className="text-[13px] font-mono font-bold text-[#002434]">/{item.ipa.replace(/^\/|\/$/g, '')}/</div>
                      </div>
                    )}
                    
                    {/* Definition */}
                    <div className="space-y-1">
                      <div className="text-[10px] text-[#42474b]/80 font-bold uppercase tracking-wider">Linguistic Definition</div>
                      <p className="text-[13.5px] font-semibold text-[#191c1d] leading-relaxed">
                        {item.definition || 'No AI-generated definition available.'}
                      </p>
                    </div>
                    
                    {/* Context Examples */}
                    {item.examples && item.examples.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="text-[10px] text-[#42474b]/80 font-bold uppercase tracking-wider">Context Examples</div>
                        <div className="space-y-2.5">
                          {item.examples.map((ex: any, j: number) => {
                            const sentence = typeof ex === 'string' ? ex : ex.sentence || '';
                            const trans = typeof ex === 'string' ? '' : ex.translation || '';
                            return (
                              <div key={j} className="text-[13.5px] pl-3.5 border-l-2 border-[#002434]/25 py-0.5 space-y-0.5">
                                <div className="leading-relaxed font-bold text-[#191c1d]">{sentence}</div>
                                {trans && (
                                  <div className="text-[12.5px] text-[#42474b] font-medium">{trans}</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Collocations */}
                    {item.collocations && item.collocations.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-[#42474b]/80 font-bold uppercase tracking-wider">Common Collocations</div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.collocations.map((col: string, j: number) => (
                            <span key={j} className="px-2.5 py-0.5 bg-[#eceeef] border border-[#c2c7cc]/50 rounded-lg text-[12px] font-semibold text-[#42474b]">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Synonyms & Related Words */}
                    {item.synonyms && item.synonyms.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-[#42474b]/80 font-bold uppercase tracking-wider">Synonyms</div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.synonyms.map((syn: string, j: number) => (
                            <span key={j} className="px-2.5 py-0.5 bg-emerald-50 border border-emerald-250/20 rounded-lg text-[12px] font-semibold text-[#42474b] text-emerald-800">
                              {syn}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.relatedWords && item.relatedWords.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-[#42474b]/80 font-bold uppercase tracking-wider">Related Terms</div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.relatedWords.map((rel: string, j: number) => (
                            <span key={j} className="px-2.5 py-0.5 bg-blue-50 border border-blue-250/20 rounded-lg text-[12px] font-semibold text-[#42474b] text-blue-800">
                              {rel}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky Bottom Action Footer */}
      <div className="sticky bottom-0 -mx-4 px-4 sm:-mx-8 sm:px-8 h-20 bg-[#f2f4f5]/90 backdrop-blur-md border-t border-[#c2c7cc]/65 flex items-center justify-between z-10 shadow-lg animate-in slide-in-from-bottom-5 duration-300 mt-8">
        <div className="max-w-5xl mx-auto w-full flex items-center justify-center sm:justify-between gap-3.5">
          <div className="hidden sm:block text-[13.5px] font-bold text-[#42474b]">
            Reviewing <span className="font-mono text-[#002434] font-bold bg-[#002434]/5 px-2 py-0.5 rounded border border-[#002434]/10">{words.length}</span> terms in total
          </div>
          <div className="flex gap-3.5">
            <button
              onClick={() => navigate('/import/step2', { state: data })}
              className="h-10 px-5 border border-[#c2c7cc]/60 hover:bg-[#eceeef] text-[#42474b] font-semibold rounded-xl transition-all text-[14px] cursor-pointer select-none active:scale-95 bg-white shadow-sm"
              disabled={isSaving}
            >
              Back
            </button>
            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="h-10 px-5 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 font-bold rounded-xl transition-all text-[14px] flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm active:scale-95 select-none"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : <Save className="w-4 h-4" strokeWidth={2} />}
              <span>{isSaving ? `Saving ${saveProgressCount}/${words.length}...` : `Save ${words.length} Words to Voca`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
