import { Sparkles, Save, X, Loader2, Volume2 } from 'lucide-react';
import { useNavigate } from "react-router";
import { useState, useEffect } from 'react';
import { createWord, enrichWord, fetchCollections, createCollection, type VocabularyWord, type Collection } from '../../lib/api';
import { speakWord } from '../../lib/speech';
import { SelectField, type SelectOption } from '../components/ui/SelectField';

export function AddWord() {
  const navigate = useNavigate();
  
  const [word, setWord] = useState('');
  const [ipa, setIpa] = useState('');
  const [translation, setTranslation] = useState('');
  const [language, setLanguage] = useState('English');
  const [pos, setPos] = useState('Noun');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  
  const [aiData, setAiData] = useState<Partial<VocabularyWord> | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const languageOptions: SelectOption[] = [
    { value: 'English', label: 'English' },
    { value: 'German', label: 'German' },
    { value: 'French', label: 'French' },
    { value: 'Spanish', label: 'Spanish' }
  ];

  const posOptions: SelectOption[] = [
    { value: 'Noun', label: 'Noun' },
    { value: 'Verb', label: 'Verb' },
    { value: 'Adjective', label: 'Adjective' },
    { value: 'Adverb', label: 'Adverb' },
    { value: 'Other', label: 'Other' }
  ];

  const collectionOptions: SelectOption[] = [
    { value: '', label: 'None (Standalone)' },
    ...collections.map(c => ({ value: c.name, label: c.name })),
    { value: '___CREATE_NEW___', label: '+ Create new collection folder...' }
  ];


  useEffect(() => {
    fetchCollections().then(setCollections).catch(console.error);
  }, []);

  const handleGenerate = async () => {
    if (!word.trim()) {
      setError('Please enter a word first');
      return;
    }
    
    setIsGenerating(true);
    setError(null);
    try {
      const result = await enrichWord(word.trim(), language);
      setAiData(result);
      if (result.translation && !translation) setTranslation(result.translation);
      if (result.pos && pos === 'Noun') setPos(result.pos);
      if (result.ipa && !ipa) setIpa(result.ipa);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI Enrichment failed';
      if (msg.includes('manually') || msg.includes('temporarily unavailable')) {
        setError(msg);
      } else {
        setError(`${msg}. You can still save the word manually without AI enrichment by clicking "Save Word" below.`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!word.trim()) {
      setError('Word is required');
      return;
    }
    
    setIsSaving(true);
    setError(null);
    
    try {
      await createWord({
        word,
        ipa,
        translation,
        language,
        pos,
        source: 'Manual input',
        collection: selectedCollection || undefined,
        definition: aiData?.definition,
        examples: aiData?.examples || [],
        collocations: aiData?.collocations || [],
        synonyms: aiData?.synonyms || [],
        relatedWords: aiData?.relatedWords || [],
      });
      navigate('/vocabulary');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save word');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-24 min-h-screen">
      {/* Header Panel */}
      <div className="shrink-0 border-b border-[#c2c7cc]/50 pb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none">
            Manual Entry Studio
          </div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#191c1d] leading-none mt-1">Add Word</h1>
          <p className="text-[13.5px] text-[#42474b] font-semibold mt-2">Create a new vocabulary entry for your personal spaced-repetition dictionary.</p>
        </div>
        <button
          onClick={() => navigate('/vocabulary')}
          className="h-10 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] rounded-xl hover:bg-[#f2f4f5] transition-all font-bold text-[13px] flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none"
        >
          <X className="w-4 h-4 text-[#42474b]" strokeWidth={2.5} />
          <span>Cancel</span>
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-[13.5px] text-rose-800 space-y-2">
          <div className="font-extrabold text-[15px]">Manual Entry Alert</div>
          <div className="text-[13.2px] text-rose-700 font-semibold leading-relaxed">
            {error}
          </div>
        </div>
      )}

      {/* Forms Split columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: Form Fields */}
        <div className="space-y-6">
          <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6.5 shadow-sm space-y-5">
            <h3 className="font-extrabold text-[15px] text-[#002434] tracking-tight mb-1 select-none">Core Information</h3>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[11.5px] font-bold text-[#42474b] uppercase tracking-wider select-none">Word *</label>
                  {word.trim() && (
                    <button
                      onClick={() => speakWord(word, language)}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#002434]/5 border border-[#002434]/15 text-[10.5px] font-bold text-[#002434] rounded-lg transition-all active:scale-95 cursor-pointer select-none"
                      type="button"
                      title="Preview Pronunciation"
                    >
                      <Volume2 className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>Listen</span>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  placeholder="Enter word..."
                  className="w-full h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[14px] text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-bold text-[#42474b] uppercase tracking-wider mb-2 select-none">Phonetic / IPA (Optional)</label>
                <input
                  type="text"
                  value={ipa}
                  onChange={(e) => setIpa(e.target.value)}
                  placeholder="e.g. /ˈtrɪɡər/"
                  className="w-full h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[13.5px] font-mono text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  value={language}
                  onChange={setLanguage}
                  options={languageOptions}
                  label="Language"
                />

                <SelectField
                  value={pos}
                  onChange={setPos}
                  options={posOptions}
                  label="Part of Speech"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-bold text-[#42474b] uppercase tracking-wider mb-2 select-none">Translation / Meaning</label>
                <input
                  type="text"
                  value={translation}
                  onChange={(e) => setTranslation(e.target.value)}
                  placeholder="Enter translation or meaning..."
                  className="w-full h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[14px] text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-bold text-[#42474b] uppercase tracking-wider mb-2 select-none">Notes / Memory Hooks (Optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add custom notes, spelling tricks, or mnemonics..."
                  rows={4}
                  className="w-full px-3.5 py-2.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[13.5px] leading-relaxed text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200 resize-none"
                />
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating || !word.trim()}
              className="w-full h-10 mt-2 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 rounded-xl font-bold transition-all text-[13.5px] flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm active:scale-95 select-none"
            >
              {isGenerating ? <Loader2 className="w-4.5 h-4.5 animate-spin text-[#002434]" strokeWidth={2.5} /> : <Sparkles className="w-4.5 h-4.5 text-teal-500" strokeWidth={2.5} />}
              <span>{isGenerating ? 'AI is enriching word details...' : 'Enrich word with AI'}</span>
            </button>
          </div>

          {/* Organization Widget */}
          <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6.5 shadow-sm space-y-4">
            <h3 className="font-extrabold text-[15px] text-[#002434] tracking-tight mb-1 select-none">Organization</h3>

            <div className="space-y-4">
              <div>
                {isCreatingCollection ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      placeholder="New folder name..."
                      className="flex-1 h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[14px] text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                      autoFocus
                    />
                    <button
                      onClick={async () => {
                        if (!newCollectionName.trim()) return;
                        try {
                          const created = await createCollection({ name: newCollectionName.trim(), description: '' });
                          setCollections([...collections, created]);
                          setSelectedCollection(created.name);
                          setIsCreatingCollection(false);
                          setNewCollectionName('');
                        } catch (err) {
                          setError('Failed to create collection folder');
                        }
                      }}
                      className="h-10 px-4 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] text-[#002434] font-bold rounded-xl text-[13px] cursor-pointer active:scale-95 shadow-sm select-none"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setIsCreatingCollection(false)}
                      className="h-10 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] font-bold rounded-xl text-[13px] cursor-pointer hover:bg-[#f2f4f5] active:scale-95 shadow-sm select-none"
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
                    label="Destination Collection"
                  />
                )}
              </div>

              <div>
                <label className="block text-[11.5px] font-bold text-[#42474b] uppercase tracking-wider mb-2 select-none">Tags</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. imported, academic, technical (comma separated)..."
                  className="w-full h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[14px] text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: AI Sandbox Enrichment */}
        <div className="space-y-6 lg:sticky lg:top-24">
          {isGenerating ? (
            <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-12 text-center h-full flex flex-col justify-center items-center min-h-[400px] shadow-sm animate-pulse">
              <Loader2 className="w-10 h-10 text-[#002434] mx-auto mb-4 animate-spin" strokeWidth={1.5} />
              <div className="text-[15px] font-extrabold text-[#002434] mb-1">AI Enrichment In Progress</div>
              <div className="text-[13px] text-[#42474b] max-w-xs leading-relaxed font-semibold">
                Voca AI is analyzing linguistic properties to generate Spaced Repetition definitions, IPAs, and examples...
              </div>
            </div>
          ) : aiData ? (
            <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm space-y-6">
              <div className="flex items-center gap-2 mb-2 pb-3.5 border-b border-[#c2c7cc]/40 select-none">
                <Sparkles className="w-4.5 h-4.5 text-teal-500 animate-pulse" strokeWidth={2.5} />
                <h3 className="font-extrabold text-[15px] text-[#002434] tracking-tight">AI-Generated Intelligence</h3>
              </div>

              <div className="space-y-5">
                {aiData.ipa && (
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-450 mb-1.5 select-none">IPA Phonetic Key</span>
                    <span className="inline-flex items-center font-mono font-bold text-[13.5px] text-[#002434] bg-[#002434]/5 border border-[#002434]/15 rounded-lg px-2.5 py-0.5 select-all">
                      /{aiData.ipa.replace(/^\/|\/$/g, '')}/
                    </span>
                  </div>
                )}

                {aiData.definition && (
                  <div className="select-all">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-450 mb-1.5 select-none">Definition</span>
                    <p className="text-[14px] font-bold leading-relaxed text-[#191c1d]">
                      {aiData.definition}
                    </p>
                  </div>
                )}

                {aiData.examples && aiData.examples.length > 0 && (
                  <div className="space-y-2 select-all">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-450 mb-2 select-none">Context Examples</span>
                    <div className="space-y-3.5">
                      {aiData.examples.map((example, i) => (
                        <div key={i} className="pl-3.5 border-l-2 border-[#002434]/30 space-y-1">
                          <div className="text-[14px] font-bold leading-relaxed text-[#191c1d]">{typeof example === 'string' ? example : example.sentence}</div>
                          {example.translation && (
                            <div className="text-[12.5px] text-[#42474b] font-semibold">{example.translation}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {aiData.collocations && aiData.collocations.length > 0 && (
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-450 mb-2 select-none">Common Collocations</span>
                    <div className="flex flex-wrap gap-1.5">
                      {aiData.collocations.map((item, i) => (
                        <span 
                          key={i} 
                          className="px-2.5 py-1 bg-[#002434]/5 border border-[#002434]/10 rounded-xl text-[12px] font-bold text-[#002434]"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {aiData.synonyms && aiData.synonyms.length > 0 && (
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-450 mb-2 select-none">Synonyms</span>
                    <div className="flex flex-wrap gap-1.5">
                      {aiData.synonyms.map((item, i) => (
                        <span 
                          key={i} 
                          className="px-2.5 py-1 bg-[#002434]/5 border border-[#002434]/10 rounded-xl text-[12px] font-bold text-[#002434]"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-[#c2c7cc]/60 border-dashed rounded-3xl p-12 text-center h-full flex flex-col justify-center items-center min-h-[350px] shadow-sm select-none">
              <Sparkles className="w-9 h-9 text-slate-400 mx-auto mb-3.5" strokeWidth={1.5} />
              <div className="text-[15px] font-extrabold text-[#002434] mb-1">AI Enrichment Ready</div>
              <div className="text-[13px] text-[#42474b] max-w-xs leading-relaxed font-semibold">
                Provide a word in the manual panel and trigger "Enrich word with AI" to instantly generate dictionary definitions and collocations.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save Action Footer */}
      <div className="mt-8 flex justify-end gap-3.5 border-t border-[#c2c7cc]/50 pt-5">
        <button
          onClick={() => navigate('/vocabulary')}
          className="h-10 px-5 bg-white border border-[#c2c7cc]/70 text-[#42474b] hover:bg-[#f2f4f5] rounded-xl font-bold text-[13.5px] transition-all cursor-pointer select-none active:scale-95 shadow-sm"
          disabled={isSaving}
        >
          Cancel
        </button>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="h-10 px-6 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 font-bold rounded-xl transition-all text-[13.5px] flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4.5 h-4.5 animate-spin text-[#002434]" strokeWidth={2.5} /> : <Save className="w-4.5 h-4.5 text-[#002434]" strokeWidth={2.5} />}
          <span>{isSaving ? 'Saving vocabulary entry...' : 'Save Word'}</span>
        </button>
      </div>
    </div>
  );
}
