import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import FreightRatesPage from './pages/FreightRatesPage';
import './App.css';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="app">
      <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
      <div className="app-body">
        <Sidebar open={sidebarOpen} activePage="freight-rates" />
        <main className={`main-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
          <FreightRatesPage />
        </main>
      </div>
    </div>
  );
}

export default App;
