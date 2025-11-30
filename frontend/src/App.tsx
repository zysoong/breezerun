import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ProjectList from './components/ProjectList/ProjectList';
import ProjectLandingPage from './components/ProjectSession/ProjectLandingPage';
import SettingsPage from './pages/SettingsPage';
import './App.css';

// Lazy load the assistant-ui chat page for code splitting
const AssistantUIChatPage = lazy(
  () => import('./components/assistant-ui/AssistantUIChatPage')
);

// Wrapper component that checks feature flag at render time
function ChatPageWrapper() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
        <AssistantUIChatPage/>
    </Suspense>
  );
}

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/projects/:projectId" element={<ProjectLandingPage />} />
        <Route
          path="/projects/:projectId/chat/:sessionId"
          element={<ChatPageWrapper />}
        />
      </Routes>
    </div>
  );
}

export default App;
