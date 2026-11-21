import React from 'react';
import { User } from '../types/batch';
import { UserCheck } from 'lucide-react';

interface UserSwitcherProps {
  currentUser: User | null;
  onSelectUser: (user: User) => void;
  demoUsers: User[];
  loading: boolean;
}

export const UserSwitcher: React.FC<UserSwitcherProps> = ({
  currentUser,
  onSelectUser,
  demoUsers,
  loading
}) => {
  return (
    <div className="user-switcher-bar">
      <div className="user-switcher-label">
        <UserCheck size={18} color="#60a5fa" />
        <span>Simulate Role:</span>
      </div>
      <div className="user-buttons">
        {demoUsers.map((u) => {
          const isSelected = currentUser?.id === u.id;
          return (
            <button
              key={u.id}
              className={`user-btn ${isSelected ? 'active' : ''}`}
              onClick={() => onSelectUser(u)}
              disabled={loading}
              title={`${u.name} - ${u.role}`}
            >
              <span className="user-name">{u.name}</span>
              <span className={`role-badge role-${u.role}`}>
                {u.role === 'TRAINING_CENTRE'
                  ? 'TC'
                  : u.role === 'DISTRICT_OFFICER'
                  ? 'DO'
                  : u.role === 'QUALITY_OFFICER'
                  ? 'QO'
                  : 'SO'}
              </span>
            </button>
          );
        })}
      </div>
      {currentUser && (
        <div className="current-user-info">
          <span>Active: <strong>{currentUser.name}</strong> ({currentUser.role})</span>
          {currentUser.trainingCentreId && <span className="entity-tag">TC: {currentUser.trainingCentreId}</span>}
          {currentUser.districtId && <span className="entity-tag">District: {currentUser.districtId}</span>}
        </div>
      )}
    </div>
  );
};
