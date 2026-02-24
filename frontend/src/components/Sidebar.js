import React from 'react';

const navItems = [
  { id: 'home',          label: 'Home',    icon: '⊞' },
  { id: 'offers',        label: 'Offers',  icon: '📋' },
  { id: 'freight-rates', label: 'Freight Rates', icon: '🚢' },
  { id: 'mih-so',        label: 'Mih/So',  icon: '⚓' },
  { id: 'bid',           label: 'Bid',     icon: '🏷️' },
];

export default function Sidebar({ open, activePage }) {
  return (
    <aside className={`sidebar ${open ? '' : 'closed'}`}>
      <ul className="sidebar-nav">
        {navItems.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={activePage === item.id ? 'active' : ''}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
