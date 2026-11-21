import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { updateBatch } from '../services/api';
import { Batch } from '../types/batch';

interface EditBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  batch: Batch;
  onUpdated: (updatedBatch: Batch) => void;
}

export const EditBatchModal: React.FC<EditBatchModalProps> = ({
  isOpen,
  onClose,
  batch,
  onUpdated
}) => {
  const [batchName, setBatchName] = useState(batch.batchName);
  const [courseName, setCourseName] = useState(batch.courseName);
  const [districtId, setDistrictId] = useState(batch.districtId);
  const [trainingStartDate, setTrainingStartDate] = useState(
    new Date(batch.trainingStartDate).toISOString().split('T')[0]
  );
  const [trainingEndDate, setTrainingEndDate] = useState(
    new Date(batch.trainingEndDate).toISOString().split('T')[0]
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);

      const updated = await updateBatch(batch.id, {
        batchName: batchName.trim(),
        courseName: courseName.trim(),
        districtId: districtId.trim(),
        trainingStartDate,
        trainingEndDate,
        expectedVersion: batch.version
      });

      onUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update batch');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <h2>Edit Draft Batch ({batch.batchNumber})</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error && <div className="notice-box error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Batch Code</label>
            <input type="text" disabled value={batch.batchNumber} style={{ opacity: 0.7 }} />
          </div>

          <div className="form-group">
            <label>Batch Name *</label>
            <input
              type="text"
              required
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Course Name *</label>
            <input
              type="text"
              required
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>District ID *</label>
            <select value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
              <option value="DIST-NORTH-01">DIST-NORTH-01 (Delhi North)</option>
              <option value="DIST-SOUTH-02">DIST-SOUTH-02 (Delhi South)</option>
              <option value="DIST-EAST-03">DIST-EAST-03 (Delhi East)</option>
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Training Start Date *</label>
              <input
                type="date"
                required
                value={trainingStartDate}
                onChange={(e) => setTrainingStartDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Training End Date *</label>
              <input
                type="date"
                required
                value={trainingEndDate}
                onChange={(e) => setTrainingEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <Save size={16} />
              {submitting ? 'Saving Changes...' : `Save Changes (v${batch.version})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
