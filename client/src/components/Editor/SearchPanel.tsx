import React, { useState } from 'react';
import './SearchPanel.css';

interface SearchPanelProps {
  projectId?: number;
  onFileSelect: (fileId: number) => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({ projectId, onFileSelect }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !projectId) return;
    
    // TODO: Implement actual search functionality
    // This would call an API endpoint to search file contents
    setIsSearching(true);
    
    // Placeholder - will need to implement search API
    setTimeout(() => {
      setSearchResults([]);
      setIsSearching(false);
    }, 500);
  };

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <span className="panel-title">Search</span>
      </div>
      
      <div className="search-panel-content">
        <div className="search-input-container">
          <input
            type="text"
            className="search-input"
            placeholder="Search in files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button 
            className="search-button"
            onClick={handleSearch}
            disabled={!searchQuery.trim() || isSearching}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M15.7 13.3l-3.81-3.83A5.93 5.93 0 0 0 13 6c0-3.31-2.69-6-6-6S1 2.69 1 6s2.69 6 6 6c1.3 0 2.48-.41 3.47-1.11l3.83 3.81c.19.2.45.3.7.3.25 0 .52-.09.7-.3a.996.996 0 0 0 0-1.41v.01zM7 10.7c-2.59 0-4.7-2.11-4.7-4.7 0-2.59 2.11-4.7 4.7-4.7 2.59 0 4.7 2.11 4.7 4.7 0 2.59-2.11 4.7-4.7 4.7z"/>
            </svg>
          </button>
        </div>

        {!projectId && (
          <div className="search-empty">
            <p>Open a project to search files</p>
          </div>
        )}

        {isSearching && (
          <div className="search-loading">
            <p>Searching...</p>
          </div>
        )}

        {searchResults.length === 0 && searchQuery && !isSearching && (
          <div className="search-no-results">
            <p>No results found for "{searchQuery}"</p>
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="search-results">
            {/* Results will be displayed here */}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPanel;
