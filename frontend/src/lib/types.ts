export interface VocabularyWord {
  id: string | number;
  created_at?: string;
  updated_at?: string;
  word: string;
  ipa?: string;
  translation: string;
  pos: string;
  language: string;
  tags: string[];
  nextReview: string;
  mastery: 'New' | 'Learning' | 'Familiar' | 'Mastered';
  definition: string;
  examples: { sentence: string; translation: string }[];
  collocations: string[];
  synonyms: string[];
  relatedWords: string[];
  collection: string;
  source: string;
  addedAt: string;
  reviewCount: number;
  studied?: boolean;
}
