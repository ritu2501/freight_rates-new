import React from 'react';

export default function Header({ onToggleSidebar }) {
  return (
    <header className="header">
      <div className="header-left">
        <button className="hamburger" onClick={onToggleSidebar} title="Toggle sidebar">
          ☰
        </button>
        <div className="logo">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2z" fill="#0ea5e9"/>
            <path d="M10 12c0-2.21 1.79-4 4-4h4c2.21 0 4 1.79 4 4v8c0 2.21-1.79 4-4 4h-4c-2.21 0-4-1.79-4-4v-8z" fill="#0c4a6e" opacity="0.7"/>
            <path d="M12 16l4-4 4 4-4 4-4-4z" fill="#fff"/>
          </svg>
          ERIS
        </div>
      </div>
      <div className="header-right">
        <button className="btn btn-demand">+ DEMAND</button>
        <button className="btn btn-supply">+ SUPPLY</button>
        <div className="avatar" title="Profile"></div>
      </div>
    </header>
  );
}
