import React from 'react';
import { LucideIcon, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

interface MetricItem {
  label: string;
  value: string | number;
}

interface StatusCardProps {
  title: string;
  icon: LucideIcon;
  status: string;
  metrics: MetricItem[];
}

export const StatusCard: React.FC<StatusCardProps> = ({ title, icon: Icon, status, metrics }) => {
  const getStatusClass = () => {
    const s = status.toLowerCase();
    if (s === 'healthy' || s === 'connected' || s === 'up') return 'healthy';
    if (s === 'degraded' || s.includes('warn')) return 'degraded';
    return 'unhealthy';
  };

  const renderStatusIcon = () => {
    const statusClass = getStatusClass();
    if (statusClass === 'healthy') return <CheckCircle2 size={14} />;
    if (statusClass === 'degraded') return <AlertTriangle size={14} />;
    return <XCircle size={14} />;
  };

  return (
    <div className="status-card">
      <div className="card-header">
        <div className="card-title">
          <Icon size={22} color="#60a5fa" />
          <span>{title}</span>
        </div>
        <div className={`status-pill ${getStatusClass()}`}>
          {renderStatusIcon()}
          <span>{status}</span>
        </div>
      </div>
      <div className="card-metrics">
        {metrics.map((metric, idx) => (
          <div key={idx} className="metric-row">
            <span className="metric-label">{metric.label}</span>
            <span className="metric-value">{metric.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
