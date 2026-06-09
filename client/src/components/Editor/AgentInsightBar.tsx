import React from 'react';
import './AgentInsightBar.css';

export interface GuardianInsight {
  type: 'stuck' | 'velocity_drop';
  message: string;
  actionLabel?: string;
  actionType?: string;
  versionNumber?: number;
}

interface AgentInsightBarProps {
  insight: GuardianInsight;
  onDismiss: () => void;
  onSeekToVersion?: (vn: number) => void;
}

const AgentInsightBar: React.FC<AgentInsightBarProps> = ({ insight, onDismiss, onSeekToVersion }) => {

  const icon = insight.type === 'stuck' ? '⚠' : '📍';

  return (
    <div className="agent-insight-bar">
      <span className="agent-insight-icon">{icon}</span>
      <span className="agent-insight-message">{insight.message}</span>
      <div className="agent-insight-actions">
        {insight.actionLabel && (
          <button
            className="agent-insight-action-btn"
            onClick={() => {
              if (insight.versionNumber != null && onSeekToVersion) {
                onSeekToVersion(insight.versionNumber);
              }
              onDismiss();
            }}
          >
            {insight.actionLabel}
          </button>
        )}
        <button className="agent-insight-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
};

export default AgentInsightBar;