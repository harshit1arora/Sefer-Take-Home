import { Check } from 'lucide-react';

export type WorkflowStepStatus = 'upcoming' | 'current' | 'complete';

export function getWorkflowStepStatuses({
  hasDocuments,
  processing,
  generating,
  hasEntry,
  reviewCurrent,
  xmlCurrent,
}: {
  hasDocuments: boolean;
  processing: boolean;
  generating: boolean;
  hasEntry: boolean;
  reviewCurrent: boolean;
  xmlCurrent: boolean;
}): WorkflowStepStatus[] {
  if (!hasDocuments) return ['current', 'upcoming', 'upcoming', 'upcoming'];
  if (processing) return ['complete', 'current', 'upcoming', 'upcoming'];
  if (generating) return ['complete', 'complete', 'complete', 'current'];
  if (!hasEntry) return ['complete', 'current', 'upcoming', 'upcoming'];
  return [
    'complete',
    'complete',
    reviewCurrent ? 'current' : 'complete',
    xmlCurrent ? 'complete' : reviewCurrent ? 'upcoming' : 'current',
  ];
}

export function WorkflowSteps(props: Parameters<typeof getWorkflowStepStatuses>[0]) {
  const statuses = getWorkflowStepStatuses(props);
  const labels = ['Upload documents', 'Extract shipment data', 'Review discrepancies', 'Generate entry XML'];

  return (
    <ol className="workflow-steps" aria-label="Entry workflow progress">
      {labels.map((label, index) => {
        const status = statuses[index];
        return (
          <li className={`workflow-step ${status}`} key={label} aria-current={status === 'current' ? 'step' : undefined}>
            <span className="workflow-step-number">
              {status === 'complete' ? <Check size={13} aria-hidden="true" /> : index + 1}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
