import { BrowserRouter, Routes, Route } from 'react-router';
import { MainLayout } from './MainLayout';
import { Dashboard } from './screens/Dashboard';
import { VocabularyList } from './screens/VocabularyList';
import { AddWord } from './screens/AddWord';
import { WordDetail } from './screens/WordDetail';
import { ImportHub } from './screens/ImportHub';
import { ExerciseLibrary } from './screens/ExerciseLibrary';
import { ExercisePractice } from './screens/ExercisePractice';
import { FileImport } from './screens/FileImport';
import { TypingPractice } from './screens/TypingPractice';
import { ImportStep1 } from './screens/ImportStep1';
import { ImportStep2 } from './screens/ImportStep2';
import { ImportStep3 } from './screens/ImportStep3';
import { ReviewHub } from './screens/ReviewHub';
import { ReviewSession } from './screens/ReviewSession';
import { ReviewResult } from './screens/ReviewResult';
import { CollectionsHub } from './screens/CollectionsHub';
import { CollectionDetail } from './screens/CollectionDetail';
import { Statistics } from './screens/Statistics';
import { Settings } from './screens/Settings';
import { AuthProvider } from './contexts/AuthContext';
import { Login } from './screens/Login';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/vocabulary" element={<VocabularyList />} />
          <Route path="/vocabulary/new" element={<AddWord />} />
          <Route path="/vocabulary/:id" element={<WordDetail />} />
          <Route path="/import" element={<ImportHub />} />
          <Route path="/import/files" element={<FileImport />} />
          <Route path="/exercises" element={<ExerciseLibrary />} />
          <Route path="/exercises/:setId" element={<ExerciseLibrary />} />
          <Route path="/exercises/session/:sessionId" element={<ExercisePractice />} />
          <Route path="/practice" element={<TypingPractice />} />
          <Route path="/practice/:articleId" element={<TypingPractice />} />
          <Route path="/import/step1" element={<ImportStep1 />} />
          <Route path="/import/step2" element={<ImportStep2 />} />
          <Route path="/import/step3" element={<ImportStep3 />} />
          <Route path="/review" element={<ReviewHub />} />
          <Route path="/review/session" element={<ReviewSession />} />
          <Route path="/review/result" element={<ReviewResult />} />
          <Route path="/collections" element={<CollectionsHub />} />
          <Route path="/collections/:id" element={<CollectionDetail />} />
          <Route path="/statistics" element={<Statistics />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
    <Analytics />
    <SpeedInsights />
  </AuthProvider>
  );
}
