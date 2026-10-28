import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';
import { AppProvider, useApp } from './lib/app.jsx';
import { LangContext } from './lib/i18n.js';
import { ToastProvider, Loading } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import HomePage from './pages/Home.jsx';
import Recipes from './pages/Recipes.jsx';
import RecipeDetail from './pages/RecipeDetail.jsx';
import ShoppingLists, { ShoppingList } from './pages/Shopping.jsx';
import Plan from './pages/Plan.jsx';

const RecipeEditor = lazy(() => import('./pages/RecipeEditor.jsx'));
const ImportPage = lazy(() => import('./pages/Import.jsx'));
const CookMode = lazy(() => import('./pages/CookMode.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Trash = lazy(() => import('./pages/Trash.jsx'));
const Cookbooks = lazy(() => import('./pages/Cookbooks.jsx'));
const CookbookDetail = lazy(() => import('./pages/Cookbooks.jsx').then((m) => ({ default: m.CookbookDetail })));
const Pantry = lazy(() => import('./pages/Pantry.jsx'));
const Groups = lazy(() => import('./pages/Groups.jsx'));
const GroupDetail = lazy(() => import('./pages/Groups.jsx').then((m) => ({ default: m.GroupDetail })));
const Invite = lazy(() => import('./pages/Groups.jsx').then((m) => ({ default: m.Invite })));
const SettingsPage = lazy(() => import('./pages/Settings.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const PublicList = lazy(() => import('./pages/Public.jsx'));
const PublicRecipe = lazy(() => import('./pages/Public.jsx').then((m) => ({ default: m.PublicRecipe })));

registerSW({ immediate: true });

function Protected({ children }) {
  const { user } = useApp();
  const loc = useLocation();
  if (user === undefined) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

function Shell() {
  const { lang } = useApp();
  return (
    <LangContext.Provider value={lang}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/p" element={<PublicList />} />
          <Route path="/p/:slug" element={<PublicRecipe />} />
          <Route path="/s/:token" element={<PublicRecipe shared />} />
          <Route path="/recipes/:id/cook" element={<Protected><CookMode /></Protected>} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<HomePage />} />
            <Route path="recipes" element={<Recipes />} />
            <Route path="recipes/new" element={<RecipeEditor />} />
            <Route path="recipes/:id" element={<RecipeDetail />} />
            <Route path="recipes/:id/edit" element={<RecipeEditor />} />
            <Route path="recipes/:id/thermomix" element={<RecipeEditor thermomix />} />
            <Route path="recipes/:id/variant" element={<RecipeEditor variant />} />
            <Route path="recipes/:id/history" element={<History />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="import/jobs/:jobId" element={<ImportPage />} />
            <Route path="trash" element={<Trash />} />
            <Route path="cookbooks" element={<Cookbooks />} />
            <Route path="cookbooks/:id" element={<CookbookDetail />} />
            <Route path="plan" element={<Plan />} />
            <Route path="shopping" element={<ShoppingLists />} />
            <Route path="shopping/:id" element={<ShoppingList />} />
            <Route path="pantry" element={<Pantry />} />
            <Route path="groups" element={<Groups />} />
            <Route path="groups/:id" element={<GroupDetail />} />
            <Route path="invite/:token" element={<Invite />} />
            <Route path="discover" element={<PublicList embedded />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </LangContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
