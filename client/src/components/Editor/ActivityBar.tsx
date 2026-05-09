import React from 'react';
import {
  Files,
  Search,
  Users,
  Puzzle,
  Container,
  Settings,
  UserCircle,
} from 'lucide-react';
import './ActivityBar.css';

export type ActivityBarView =
  | 'files'
  | 'search'
  | 'users'
  | 'extensions'
  | 'containers'
  | null;

interface ActivityBarProps {
  activeView: ActivityBarView;
  onViewChange: (view: ActivityBarView) => void;
}

interface NavItem {
  id: ActivityBarView;
  icon: React.ReactNode;
  label: string;
  hasPanel: boolean;
}

const topItems: NavItem[] = [
  { id: 'files',      icon: <Files size={22} />,     label: 'Explorer',       hasPanel: true  },
  { id: 'search',     icon: <Search size={22} />,    label: 'Search',         hasPanel: true  },
  { id: 'users',      icon: <Users size={22} />,     label: 'Collaboration',  hasPanel: true  },
  { id: 'extensions', icon: <Puzzle size={22} />,    label: 'Extensions',     hasPanel: false },
  { id: 'containers', icon: <Container size={22} />, label: 'Containers',     hasPanel: false },
];

const bottomItems: { icon: React.ReactNode; label: string }[] = [
  { icon: <Settings size={22} />,    label: 'Settings' },
  { icon: <UserCircle size={22} />,  label: 'Profiles' },
];

const ActivityBar: React.FC<ActivityBarProps> = ({ activeView, onViewChange }) => {
  const handleClick = (item: NavItem) => {
    if (!item.hasPanel) return;
    onViewChange(activeView === item.id ? null : item.id);
  };

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {topItems.map((item) => (
          <button
            key={item.id}
            className={`activity-bar-item ${activeView === item.id ? 'active' : ''} ${!item.hasPanel ? 'no-panel' : ''}`}
            onClick={() => handleClick(item)}
            title={item.label}
            aria-label={item.label}
          >
            {item.icon}
            {activeView === item.id && <span className="active-indicator" />}
          </button>
        ))}
      </div>

      <div className="activity-bar-bottom">
        {bottomItems.map((item) => (
          <button
            key={item.label}
            className="activity-bar-item no-panel"
            title={item.label}
            aria-label={item.label}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ActivityBar;
