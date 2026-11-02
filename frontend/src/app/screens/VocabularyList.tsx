import { useVocabularyVersion } from '../hooks/useVocabularyVersion';
import { VocabularyManagement } from '../components/VocabularyManagement';
import { announceVocabularyChange } from '../../lib/vocabularyManagement';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from "react-router";
import { Plus, Filter, SlidersHorizontal, MoreVertical, Clock, Tag, Volume2, Edit2, Trash2, Loader2, Search } from 'lucide-react';
import { checkBackendConnection, fetchWords, deleteWord, type VocabularyWord } from '../../lib/api';
import { speakWord } from '../../lib/speech';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '../components/ui/alert-dialog';

export function VocabularyList() {
  const vocabularyVersion = useVocabularyVersion();
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionNotice, setSelectionNotice] = useState('');
  const pageCheckbox = useRef<HTMLInputElement>(null);
  
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [connectionMessage, setConnectionMessage] = useState('Connecting to Flask vocabulary service...');
  const [words, setWords] = useState<VocabularyWord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Active filter & search states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('All');
  const [selectedTag, setSelectedTag] = useState('All');
  const [selectedMastery, setSelectedMastery] = useState('All');

  // Client-side pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Reset pagination to page 1 on filter/search adjustments
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
    setSelectionNotice('Selection resets when filters change.');
  }, [searchQuery, selectedLanguage, selectedTag, selectedMastery]);

  // Compile unique lists for select dropdowns
  const availableLanguages = Array.from(new Set(words.map(w => w.language).filter(Boolean))).sort();
  const availableTags = Array.from(new Set(words.flatMap(w => w.tags || []).filter(Boolean))).sort();

  const languageOptions: SelectOption[] = [
    { value: 'All', label: 'All' },
    ...availableLanguages.map(l => ({ value: l, label: l }))
  ];

  const tagOptions: SelectOption[] = [
    { value: 'All', label: 'All' },
    ...availableTags.map(t => ({ value: t, label: t }))
  ];

  const masteryOptions: SelectOption[] = [
    { value: 'All', label: 'All' },
    { value: 'New', label: 'New' },
    { value: 'Learning', label: 'Learning' },
    { value: 'Familiar', label: 'Familiar' },
    { value: 'Mastered', label: 'Mastered' }
  ];

  // Perform client-side filtering (including search query)
  const filteredWords = words.filter(item => {
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      const wordMatch = item.word?.toLowerCase().includes(q);
      const transMatch = item.translation?.toLowerCase().includes(q);
      const ipaMatch = item.ipa?.toLowerCase().includes(q);
      const posMatch = item.pos?.toLowerCase().includes(q);
      if (!wordMatch && !transMatch && !ipaMatch && !posMatch) {
        return false;
      }
    }
    if (selectedLanguage !== 'All' && item.language !== selectedLanguage) {
      return false;
    }
    if (selectedTag !== 'All' && !(item.tags || []).includes(selectedTag)) {
      return false;
    }
    if (selectedMastery !== 'All') {
      const itemMastery = item.mastery || 'New';
      if (selectedMastery === 'New' && itemMastery !== 'New') {
        return false;
      }
      if (selectedMastery !== 'New' && itemMastery !== selectedMastery) {
        return false;
      }
    }
    return true;
  });

  // Pagination Calculations
  const totalItems = filteredWords.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedWords = filteredWords.slice(startIndex, endIndex);

  const pageSelected = paginatedWords.filter(word => selectedIds.has(String(word.id))).length;
  useEffect(() => { if (pageCheckbox.current) pageCheckbox.current.indeterminate = pageSelected > 0 && pageSelected < paginatedWords.length; }, [pageSelected, paginatedWords.length]);
  function togglePage(checked: boolean) {
    setSelectionNotice('');
    setSelectedIds(previous => { const next = new Set(previous); paginatedWords.forEach(word => checked ? next.add(String(word.id)) : next.delete(String(word.id))); return next; });
  }

  // States for three-dot menu and delete confirmation
  const [wordToDelete, setWordToDelete] = useState<VocabularyWord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadWordsList = async () => {
    try {
      const items = await fetchWords();
      setWords(items);
      setSelectedIds(previous => new Set([...previous].filter(id => items.some(word => String(word.id) === id))));
      setLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load words from backend';
      setLoadError(message);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!wordToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteWord(wordToDelete.id);
      announceVocabularyChange();
      await loadWordsList();
      setWordToDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete word');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadWords = async () => {
      const connectionResult = await checkBackendConnection();

      if (!isMounted) return;

      setConnectionStatus(connectionResult.ok ? 'connected' : 'error');
      setConnectionMessage(connectionResult.message);

      if (!connectionResult.ok) {
        setLoadError(connectionResult.message);
        return;
      }

      try {
        const items = await fetchWords();
        if (!isMounted) return;
        setWords(items);
        setLoadError(null);
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : 'Failed to load words from backend';
        setConnectionStatus('error');
        setConnectionMessage(message);
        setLoadError(message);
      }
    };

    loadWords();

    return () => {
      isMounted = false;
    };
  }, [vocabularyVersion]);

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-7xl mx-auto bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-24 min-h-screen">
      {/* Header Panel */}
      <div className="shrink-0 border-b border-[#c2c7cc]/50 pb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none">
            Vocabulary Workspace
          </div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#191c1d] leading-none mt-1">Vocabulary Library</h1>
          <p className="text-[13.5px] text-[#42474b] font-semibold mt-2">Browse, search, and manage your custom learning list.</p>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                  : connectionStatus === 'error'
                  ? 'bg-rose-50 text-rose-700 border border-rose-200/50'
                  : 'bg-amber-50 text-amber-700 border border-amber-200/50'
              }`}
            >
              {connectionStatus === 'connected'
                ? 'Backend Connected'
                : connectionStatus === 'error'
                ? 'Backend Error'
                : 'Checking Backend'}
            </span>
            <span className="text-[12px] text-[#42474b] font-semibold">{connectionMessage}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/import')}
            className="h-10 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] rounded-xl hover:bg-[#f2f4f5] transition-all font-bold text-[13px] flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none"
          >
            <span>Import Text</span>
          </button>
          <button
            onClick={() => navigate('/vocabulary/new')}
            className="h-10 px-4 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] hover:border-[#002434]/60 text-[#002434] rounded-xl transition-all font-bold text-[13px] flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none"
          >
            <Plus className="w-4.5 h-4.5 text-[#002434]" strokeWidth={2.5} />
            <span>Add Word</span>
          </button>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-[#c2c7cc]/60 p-4 rounded-2xl shadow-sm">
        <div className="flex-1 flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative w-full lg:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#42474b]" strokeWidth={2} />
            <input
              type="text"
              placeholder="Search words, meanings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-4 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[13px] text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
            />
          </div>

          {/* Language Filter */}
          <div className="flex items-center gap-2 bg-[#f2f4f5] hover:bg-[#eceeef] border border-[#c2c7cc]/50 rounded-xl px-3 py-1.5 text-[13px] font-semibold transition-colors">
            <Filter className="w-3.5 h-3.5 text-[#42474b]" strokeWidth={2} />
            <span className="text-[#42474b] font-bold">Language:</span>
            <SelectField
              value={selectedLanguage}
              onChange={setSelectedLanguage}
              options={languageOptions}
              variant="inline-filter"
            />
          </div>

          {/* Tags Filter */}
          <div className="flex items-center gap-2 bg-[#f2f4f5] hover:bg-[#eceeef] border border-[#c2c7cc]/50 rounded-xl px-3 py-1.5 text-[13px] font-semibold transition-colors">
            <Tag className="w-3.5 h-3.5 text-[#42474b]" strokeWidth={2} />
            <span className="text-[#42474b] font-bold">Tag:</span>
            <SelectField
              value={selectedTag}
              onChange={setSelectedTag}
              options={tagOptions}
              variant="inline-filter"
            />
          </div>

          {/* Mastery Filter */}
          <div className="flex items-center gap-2 bg-[#f2f4f5] hover:bg-[#eceeef] border border-[#c2c7cc]/50 rounded-xl px-3 py-1.5 text-[13px] font-semibold transition-colors">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#42474b]" strokeWidth={2} />
            <span className="text-[#42474b] font-bold">Mastery:</span>
            <SelectField
              value={selectedMastery}
              onChange={setSelectedMastery}
              options={masteryOptions}
              variant="inline-filter"
            />
          </div>

          {/* Reset Button */}
          {(selectedLanguage !== 'All' || selectedTag !== 'All' || selectedMastery !== 'All' || searchQuery !== '') && (
            <button
              onClick={() => {
                setSelectedLanguage('All');
                setSelectedTag('All');
                setSelectedMastery('All');
                setSearchQuery('');
              }}
              className="h-8 px-3 rounded-xl bg-[#002434]/5 border border-[#002434]/15 hover:bg-[#002434]/10 text-[12.5px] font-bold text-[#002434] transition-all cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
        <div className="text-[13px] text-[#42474b] font-semibold shrink-0">
          {totalItems > 0 ? (
            <>
              Showing <span className="font-bold text-[#002434] font-mono">{startIndex + 1}–{endIndex}</span> of <span className="font-bold text-[#002434] font-mono">{totalItems}</span> words
            </>
          ) : (
            "No words found"
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-[13.5px] text-rose-800 space-y-2">
          <div className="font-extrabold text-[15px]">Unable to load vocabulary data</div>
          <div className="text-[13px] text-rose-700 font-semibold leading-relaxed">
            Please make sure the Flask backend API server is running correctly, then refresh this page. ({loadError})
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#c2c7cc]/60 bg-white p-3 text-sm">
        {!!selectedIds.size && <><strong>{selectedIds.size} words selected</strong><span>{pageSelected} selected on this page · {selectedIds.size === filteredWords.length ? 'Selected across all filtered results' : 'Selection persists across pages'}</span><button className="underline" onClick={() => setSelectedIds(new Set(filteredWords.map(word => String(word.id))))}>Select all {filteredWords.length} matching filters</button><button className="underline" onClick={() => setSelectedIds(new Set())}>Clear selection</button></>}
        <VocabularyManagement selectedIds={[...selectedIds]} onRefresh={loadWordsList} onClearSelection={() => setSelectedIds(new Set())} />
        {selectionNotice && <p role="status" className="w-full text-muted-foreground">{selectionNotice}</p>}
      </div>

      {/* Table Card */}
      <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl shadow-sm overflow-visible relative z-10">
        <div className="overflow-x-auto rounded-t-3xl">
          <table className="w-full border-collapse">
            <thead className="bg-[#f8fafb] border-b border-[#c2c7cc]/40">
              <tr>
                <th className="w-10 p-3"><input ref={pageCheckbox} type="checkbox" aria-label="Select all words on this page" checked={!!paginatedWords.length && pageSelected === paginatedWords.length} disabled={!paginatedWords.length} onChange={event => togglePage(event.target.checked)} /></th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Word
                </th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Translation
                </th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Language
                </th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Tags
                </th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Next Review
                </th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Mastery
                </th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#c2c7cc]/40">
              {paginatedWords.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => navigate('/vocabulary/' + item.id, { state: item })}
                  className="hover:bg-[#f2f4f5]/30 cursor-pointer transition-all group duration-150"
                >
                  <td className="p-3" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`Select word ${item.word}`} checked={selectedIds.has(String(item.id))} onChange={event => { const checked = event.target.checked; setSelectionNotice(''); setSelectedIds(previous => { const next = new Set(previous); if (checked) next.add(String(item.id)); else next.delete(String(item.id)); return next; }); }} /></td>
                  <td className="px-6 py-4.5">
                    <div className="flex items-center gap-2.5">
                      <span className="font-extrabold text-[15px] text-[#191c1d] group-hover:text-[#002434] transition-colors">{item.word}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          speakWord(item.word, item.language);
                        }}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-xl bg-[#002434]/5 border border-[#002434]/10 hover:bg-[#002434]/10 text-[#002434] transition-all"
                        title="Pronounce"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-[#002434]" strokeWidth={2} />
                      </button>
                    </div>
                    <div className="text-[12.5px] text-[#42474b] mt-1 font-semibold flex items-center gap-2 flex-wrap">
                      <span className="italic font-bold text-[#42474b]/75">{item.pos || 'Unknown'}</span>
                      {item.ipa && (
                        <span className="text-[11.5px] font-mono text-[#002434]/70 bg-[#002434]/5 border border-[#002434]/10 px-1.5 py-0.5 rounded font-bold">
                          /{item.ipa.replace(/^\/|\/$/g, '')}/
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4.5 text-[14px] text-[#191c1d] font-semibold">{item.translation}</td>
                  <td className="px-6 py-4.5">
                    <span className="inline-flex items-center rounded-lg bg-[#eceeef] px-2.5 py-0.5 text-[10px] font-bold text-[#42474b] uppercase border border-[#c2c7cc]/50 select-none">
                      {item.language}
                    </span>
                  </td>
                  <td className="px-6 py-4.5">
                    <div className="flex flex-wrap gap-1">
                      {(item.tags || []).map((tag, j) => (
                        <span
                          key={j}
                          className="px-2 py-0.5 bg-[#002434]/5 text-[#002434] rounded text-[11px] font-bold border border-[#002434]/10"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4.5">
                    <div className="flex items-center gap-1.5 text-[13px] text-[#42474b] font-semibold">
                      <Clock className="w-3.5 h-3.5 text-[#42474b]" strokeWidth={2} />
                      <span>{item.nextReview}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider border ${
                        item.mastery === 'Mastered'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                          : item.mastery === 'Familiar'
                          ? 'bg-blue-50 text-blue-700 border-blue-200/50'
                          : 'bg-orange-50 text-orange-700 border-orange-200/50'
                      }`}
                    >
                      {item.mastery || 'New'}
                    </span>
                  </td>
                  <td className="px-4 py-4.5" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#f2f4f5] border border-transparent hover:border-[#c2c7cc]/50 cursor-pointer"
                        >
                          <MoreVertical className="w-4 h-4 text-[#42474b]" strokeWidth={2} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className="bg-white border border-[#c2c7cc]/60 shadow-lg rounded-xl">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/vocabulary/' + item.id, { state: { ...item, isDirectEditing: true } });
                          }}
                          className="cursor-pointer flex items-center gap-2 text-[13px] font-bold text-[#191c1d] focus:bg-[#f2f4f5] rounded-lg p-2"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-[#42474b]" strokeWidth={2} />
                          <span>Edit</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteError(null);
                            setWordToDelete(item);
                          }}
                          className="cursor-pointer flex items-center gap-2 text-[13px] font-bold text-rose-600 focus:text-rose-600 focus:bg-rose-50 rounded-lg p-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>Delete</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {!loadError && filteredWords.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    {words.length === 0 ? (
                      <div className="space-y-4 max-w-md mx-auto">
                        <p className="text-[#42474b] text-[13.5px] font-semibold leading-relaxed">
                          Your vocabulary library is currently empty. Start building your custom spaced repetition list!
                        </p>
                        <div className="flex justify-center gap-3">
                          <button
                            onClick={() => navigate('/vocabulary/new')}
                            className="h-9 px-4 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] rounded-xl hover:bg-[#eceeef] hover:border-[#002434]/60 transition-all font-bold text-[12.5px] cursor-pointer active:scale-95 shadow-sm"
                          >
                            Add Your First Word
                          </button>
                          <button
                            onClick={() => navigate('/import')}
                            className="h-9 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] rounded-xl hover:bg-[#f2f4f5] transition-all font-bold text-[12.5px] cursor-pointer active:scale-95 shadow-sm"
                          >
                            Import Text
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[#42474b] text-[13.5px] font-semibold">
                        No words match your filters or search query.
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalItems > 0 && (
          <div className="px-6 py-4 border-t border-[#c2c7cc]/40 bg-[#f8fafb]/50 flex flex-col sm:flex-row items-center justify-between gap-4 select-none rounded-b-3xl overflow-visible relative z-20">
            {/* Page Size Selector */}
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#42474b]">
              <span>Words per page:</span>
              <SelectField
                value={String(pageSize)}
                onChange={(val) => {
                  setPageSize(Number(val));
                  setCurrentPage(1);
                }}
                options={[
                  { value: '10', label: '10' },
                  { value: '20', label: '20' },
                  { value: '30', label: '30' }
                ]}
                variant="compact"
                className="w-16"
              />
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={activePage === 1}
                className="h-9 px-3 bg-white border border-[#c2c7cc]/70 text-[#42474b] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-[12.5px] cursor-pointer hover:bg-[#f2f4f5] transition-all active:scale-95 shadow-sm"
              >
                Previous
              </button>
              <div className="text-[13px] font-bold text-[#42474b] px-2">
                Page <span className="text-[#002434]">{activePage}</span> of {totalPages}
              </div>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={activePage === totalPages}
                className="h-9 px-3 bg-white border border-[#c2c7cc]/70 text-[#42474b] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-[12.5px] cursor-pointer hover:bg-[#f2f4f5] transition-all active:scale-95 shadow-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={wordToDelete !== null} onOpenChange={(open) => !open && setWordToDelete(null)}>
        <AlertDialogContent className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-extrabold text-[#191c1d] tracking-tight">Delete Word</AlertDialogTitle>
            <AlertDialogDescription className="text-[13.5px] text-[#42474b] font-semibold leading-relaxed">
              Are you sure you want to delete the word <strong className="font-bold text-[#002434]">"{wordToDelete?.word}"</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {deleteError && (
            <div className="rounded-xl border border-rose-200/50 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 animate-in fade-in-50 duration-200 font-bold">
              {deleteError}
            </div>
          )}

          <AlertDialogFooter className="gap-3 mt-4">
            <AlertDialogCancel 
              disabled={isDeleting} 
              onClick={() => setWordToDelete(null)} 
              className="h-10 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] hover:bg-[#f2f4f5] rounded-xl font-bold text-[13px] cursor-pointer select-none active:scale-95 shadow-sm"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirm();
              }}
              className="h-10 px-5 bg-rose-50 border border-rose-200 hover:bg-rose-100/70 text-rose-700 rounded-xl font-bold text-[13px] cursor-pointer flex items-center justify-center gap-2 select-none active:scale-95 shadow-sm"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin text-rose-700" strokeWidth={2.5} /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
