import { describe, expect, it } from 'vitest';
import { getWorkflowStepStatuses } from '@/components/entry/WorkflowSteps';

describe('entry workflow progress', () => {
  it('starts at upload and advances to extraction after documents are added', () => {
    expect(getWorkflowStepStatuses({
      hasDocuments: false, processing: false, generating: false, hasEntry: false, reviewCurrent: false, xmlCurrent: false,
    })).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(getWorkflowStepStatuses({
      hasDocuments: true, processing: false, generating: false, hasEntry: false, reviewCurrent: false, xmlCurrent: false,
    })).toEqual(['complete', 'current', 'upcoming', 'upcoming']);
    expect(getWorkflowStepStatuses({
      hasDocuments: true, processing: true, generating: false, hasEntry: false, reviewCurrent: false, xmlCurrent: false,
    })).toEqual(['complete', 'current', 'upcoming', 'upcoming']);
  });

  it('shows the generated draft while keeping review active until the user continues', () => {
    expect(getWorkflowStepStatuses({
      hasDocuments: true, processing: false, generating: false, hasEntry: true, reviewCurrent: true, xmlCurrent: false,
    })).toEqual(['complete', 'complete', 'current', 'upcoming']);
    expect(getWorkflowStepStatuses({
      hasDocuments: true, processing: false, generating: false, hasEntry: true, reviewCurrent: true, xmlCurrent: true,
    })).toEqual(['complete', 'complete', 'current', 'complete']);
    expect(getWorkflowStepStatuses({
      hasDocuments: true, processing: false, generating: false, hasEntry: true, reviewCurrent: false, xmlCurrent: false,
    })).toEqual(['complete', 'complete', 'complete', 'current']);
    expect(getWorkflowStepStatuses({
      hasDocuments: true, processing: false, generating: false, hasEntry: true, reviewCurrent: false, xmlCurrent: true,
    })).toEqual(['complete', 'complete', 'complete', 'complete']);
    expect(getWorkflowStepStatuses({
      hasDocuments: true, processing: false, generating: true, hasEntry: true, reviewCurrent: false, xmlCurrent: false,
    })).toEqual(['complete', 'complete', 'complete', 'current']);
  });
});
