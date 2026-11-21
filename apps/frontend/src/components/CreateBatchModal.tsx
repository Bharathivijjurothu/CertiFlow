import React, { useState } from 'react';
import { X, PlusCircle } from 'lucide-react';
import { createBatch, CreateBatchInput } from '../services/api';
import { Batch } from '../types/batch';

interface CreateBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (batch: Batch) => void;
  defaultDistrictId?: string;
}

export const CreateBatchModal: React.FC<CreateBatchModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  defaultDistrictId = 'DIST-NORTH-01'
}) => {
  const [batchNumber, setBatchNumber] = useState(`BATCH-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
  const [batchName, setBatchName] = useState('Solar Technician Training 2026');
  const [courseName, setCourseName] = useState('Renewable Energy & Solar PV Installation');
  const [districtId, setDistrictId] = useState(defaultDistrictId);
  const [trainingStartDate, setTrainingStartDate] = useState('2026-01-15');
  const [trainingEndDate, setTrainingEndDate] = useState('2026-03-30');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);

      const input: CreateBatchInput = {
        batchNumber: batchNumber.trim().toUpperCase(),
        batchName: batchName.trim(),
        courseName: courseName.trim(),
        districtId: districtId.trim(),
        trainingStartDate,
        trainingEndDate
      };

      const newBatch = await createBatch(input);
      onCreated(newBatch);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create batch');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <h2>Create New Training Batch</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error && <div className="notice-box error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Batch Code / Number *</label>
            <input
              type="text"
              required
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value.toUpperCase())}
              placeholder="e.g. BATCH-2026-001"
            />
          </div>

          <div className="form-group">
            <label>Batch Name *</label>
            <input
              type="text"
              required
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="e.g. Solar Technician Training Batch 1"
            />
          </div>

          <div className="form-group">
            <label>Course Name *</label>
            <input
              type="text"
              required
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="e.g. Renewable Energy - Solar PV Installation"
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
              <PlusCircle size={16} />
              {submitting ? 'Creating Batch...' : 'Create Batch (DRAFT)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
