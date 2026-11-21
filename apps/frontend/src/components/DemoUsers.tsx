import React from 'react';
import { Users, ShieldCheck, KeyRound } from 'lucide-react';
import { DemoUser } from '../services/api';

interface DemoUsersProps {
  users: DemoUser[];
  loading: boolean;
}

export const DemoUsers: React.FC<DemoUsersProps> = ({ users, loading }) => {
  return (
    <div className="section">
      <div className="section-header">
        <div className="section-title">
          <Users size={22} color="#a855f7" />
          <span>Provisioned Demo Accounts ({users.length})</span>
        </div>
        <span className="status-pill healthy">
          <ShieldCheck size={14} />
          <span>Idempotent Seed Active</span>
        </span>
      </div>

      {loading && users.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>Loading demo accounts from database...</p>
      ) : (
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Assigned Entity ID</th>
                <th>Provisioned At</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td style={{ fontWeight: 600 }}>{user.name}</td>
                  <td>
                    <code style={{ color: '#93c5fd' }}>{user.email}</code>
                  </td>
                  <td>
                    <span className={`role-badge role-${user.role}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>
                    {user.trainingCentreId ? (
                      <code>TC: {user.trainingCentreId}</code>
                    ) : user.districtId ? (
                      <code>District: {user.districtId}</code>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>State-wide</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {user.createdAt ? new Date(user.createdAt).toLocaleString() : 'Active'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="notice-box">
        <KeyRound size={18} />
        <div>
          <strong>Security Verification:</strong> Passwords are encrypted in PostgreSQL using <code>bcryptjs</code> (10 salt rounds). No plain-text passwords or secret keys are exposed or stored. Default demo login password is <code>CertiFlow@2026</code>.
        </div>
      </div>
    </div>
  );
};
