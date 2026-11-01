import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { articleSpans, type TextSpan } from '../../lib/typingEngine';

interface Props {
  source: string;
  typed: string;
  paused: boolean;
  onInput: (value: string) => void;
  onPause: () => void;
  onLookup: (text: string, start: number, end: number) => void;
}

const RenderSpan = memo(function RenderSpan({ span, entered, current, selected, onSelect }: {
  span: TextSpan; entered: string; current: boolean; selected: boolean;
  onSelect: (span: TextSpan, extend: boolean) => void;
}) {
  const characters = Array.from(span.text);
  const typed = Array.from(entered);
  const done = typed.length === characters.length;
  const correct = done && entered === span.text;
  const interactive = span.kind === 'word';
  return (
    <span
      data-span-start={span.start}
      data-span-end={span.end}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Look up ${span.text}` : undefined}
      onMouseDown={interactive ? event => event.preventDefault() : undefined}
      onClick={interactive ? event => { event.stopPropagation(); onSelect(span, event.shiftKey); } : undefined}
      onKeyDown={interactive ? event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); onSelect(span, event.shiftKey);
        }
      } : undefined}
      className={`${interactive ? 'cursor-pointer rounded-sm hover:bg-teal-100/60 focus-visible:outline-2 focus-visible:outline-teal-600' : ''} ${current ? 'bg-teal-50' : ''} ${selected ? 'bg-amber-100' : ''} ${correct ? 'text-teal-700' : done ? 'text-rose-700' : 'text-slate-400'}`}
    >
      {current || (done && !correct) ? characters.map((char, index) => (
        <span
          key={index}
          data-caret={current && index === typed.length ? 'true' : undefined}
          className={`${index < typed.length ? typed[index] === char ? 'text-teal-700' : 'text-rose-700 bg-rose-100 underline decoration-rose-500' : 'text-slate-600'} ${current && index === typed.length ? 'border-l-2 border-teal-600 -ml-[2px]' : ''}`}
        >{char === '\n' && current && index === typed.length ? '↵\n' : char}</span>
      )) : span.text}
    </span>
  );
});

/** Native text input captures IME/mobile input; the article renders every visible character. */
export function ArticleTypingSurface({ source, typed, paused, onInput, onPause, onLookup }: Props) {
  const spans = useMemo(() => articleSpans(source), [source]);
  const typedChars = useMemo(() => Array.from(typed), [typed]);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const selectionRef = useRef(selection);
  const [composition, setComposition] = useState<string | null>(null);
  const composing = useRef(false);
  const sourceChars = useMemo(() => Array.from(source), [source]);
  const position = typedChars.length;

  const focusInput = useCallback(() => {
    if (paused) return;
    input.current?.focus({ preventScroll: true });
    const end = input.current?.value.length || 0;
    input.current?.setSelectionRange(end, end);
  }, [paused]);

  useEffect(() => {
    if (!paused) focusInput();
  }, [focusInput, source]);

  useEffect(() => {
    const parent = scroller.current;
    const caret = parent?.querySelector<HTMLElement>('[data-caret="true"]');
    if (!parent || !caret) return;
    const box = parent.getBoundingClientRect();
    const point = caret.getBoundingClientRect();
    if (point.top < box.top + 32 || point.bottom > box.bottom - 48) {
      parent.scrollTo({ top: parent.scrollTop + point.top - box.top - parent.clientHeight * .35, behavior: 'auto' });
    }
  }, [position]);

  const selectSpan = useCallback((span: TextSpan, extend: boolean) => {
    const currentSelection = selectionRef.current;
    const start = extend && currentSelection ? Math.min(currentSelection.start, span.start) : span.start;
    const end = extend && currentSelection ? Math.max(currentSelection.end, span.end) : span.end;
    const text = sourceChars.slice(start, end).join('');
    if (Array.from(text).length > 150) return;
    selectionRef.current = { start, end };
    setSelection(selectionRef.current);
    onLookup(text, start, end);
    focusInput();
  }, [sourceChars, onLookup, focusInput]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{paused ? 'Paused' : focused ? 'Keyboard ready · type the article below' : 'Click Resume typing to focus'}</span>
        <button type="button" disabled={paused} onClick={focusInput} className="font-semibold text-teal-800 underline underline-offset-4 disabled:opacity-40">Resume typing</button>
      </div>
      <div
        ref={scroller}
        className={`relative max-h-[62vh] min-h-72 overflow-y-auto rounded-2xl border p-5 sm:p-8 transition-colors ${focused && !paused ? 'border-teal-400 ring-2 ring-teal-50' : 'border-border'} bg-white`}
        onClick={focusInput}
      >
        <textarea
          ref={input}
          aria-label="Type the article"
          aria-describedby="typing-help"
          value={composition ?? typed}
          readOnly={paused}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          style={{ position: 'fixed', top: '50%', left: '50%', width: 1, height: 1, opacity: 0, padding: 0, pointerEvents: 'none' }}
          onFocus={() => { setFocused(true); input.current?.setSelectionRange(typed.length, typed.length); }}
          onBlur={() => { setFocused(false); onPause(); }}
          onPaste={event => event.preventDefault()}
          onDrop={event => event.preventDefault()}
          onCompositionStart={() => { composing.current = true; setComposition(typed); }}
          onCompositionEnd={event => { composing.current = false; setComposition(null); onInput(event.currentTarget.value); }}
          onChange={event => {
            if (composing.current || (event.nativeEvent as InputEvent).isComposing) setComposition(event.target.value);
            else onInput(event.target.value);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); onPause(); }
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              input.current?.setSelectionRange(typed.length, typed.length);
            }
          }}
        />
        <div className="font-mono text-lg leading-[2.2] sm:text-xl whitespace-pre-wrap break-words select-none" aria-label="Article typing surface">
          {spans.map(span => (
            <RenderSpan
              key={span.start}
              span={span}
              entered={typedChars.slice(span.start, span.end).join('')}
              current={position >= span.start && position < span.end}
              selected={!!selection && span.start >= selection.start && span.end <= selection.end}
              onSelect={selectSpan}
            />
          ))}
          {position === sourceChars.length && <span data-caret="true" className="border-l-2 border-teal-600" aria-label="End of article"> </span>}
        </div>
      </div>
      <p id="typing-help" className="text-xs leading-relaxed text-muted-foreground">Type in the article. Backspace corrects mistakes; Enter or Space advances paragraph breaks. Click a word to look it up, or Shift+click another word to select a phrase. Escape pauses. Pasting is disabled during copy practice.</p>
    </div>
  );
}
