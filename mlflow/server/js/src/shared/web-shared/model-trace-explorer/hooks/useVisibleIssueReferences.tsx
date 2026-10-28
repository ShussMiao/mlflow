import { useMemo } from 'react';

import { useSelectedIssueId } from '@mlflow/mlflow/src/experiment-tracking/components/run-page/hooks/useSelectedIssueId';

import { useQueries } from '../../query-client/queryClient';

import { useArrayMemo } from './useArrayMemo';
import {
  getUniqueIssueReferenceAssessments,
  getUniqueIssueReferences,
  type TraceIssueReference,
} from '../IssueAssessmentUtils';
import type { Assessment, IssueReferenceAssessment } from '../ModelTrace.types';
import { fetchIssue, type FetchIssueResponse } from '../api';

export const GET_ISSUE_BY_ID = 'GET_ISSUE_BY_ID';

/**
 * The status meaning someone looked at the issue and said it is not one -- the Issues tab labels it
 * "Not an issue". Detection filed it anyway, so the trace's reference to it is a false positive
 * that a reader has already ruled on.
 *
 * `resolved` deliberately stays visible: a resolved issue did happen in this trace, and the trace is
 * the record of that. Only an explicit "this was never a problem" is worth suppressing.
 */
const DISMISSED_ISSUE_STATUS = 'rejected';

/**
 * Status is changed by hand and rarely, and paging the drawer through a list of traces re-reads the
 * same few issues at every step.
 */
const ISSUE_STATUS_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * The selected issue, or `undefined` outside a Router -- tests and the OSS notebook renderer mount
 * the explorer without one.
 */
const useSafeSelectedIssueId = (): string | undefined => {
  try {
    const [selectedIssueId] = useSelectedIssueId();
    return selectedIssueId;
  } catch {
    return undefined;
  }
};

/**
 * Which of a span's referenced issues are still worth showing, by issue ID.
 *
 * A trace keeps its issue references forever -- marking an issue "Not an issue" does not retract the
 * reference detection wrote -- so every surface that read the references alone kept presenting
 * findings a reader had already dismissed. The status lives on the issue rather than on the
 * reference, so it has to be read separately.
 *
 * Keyed per issue ID, so the span tree's indicators, the detail pane's banner and the assessments
 * pane share one request per distinct issue, however many spans it touches and however many are on
 * screen. A trace referencing no issue -- the overwhelming majority -- asks for nothing.
 *
 * An issue named in the URL is always kept, and never read: arriving from that issue's own page is
 * how a reader reviews the evidence behind it, so hiding the card they followed would leave the
 * trace explaining nothing. A status that cannot be read also keeps its issue, because failing to
 * reach the issues API is not evidence that anyone dismissed anything.
 *
 * An issue is shown until its status is known to be dismissed, rather than withheld until every
 * status has arrived. Withholding would delay the cards on every trace that has an issue -- almost
 * all of which are open -- to avoid briefly showing the few that are dismissed, and it would make
 * the common case slower to serve the rare one. The status is cached per issue, so the brief
 * appearance happens at most once per issue.
 */
const useVisibleIssueIds = (issueIds: string[]): Set<string> => {
  const selectedIssueId = useSafeSelectedIssueId();
  const queries = useQueries({
    queries: issueIds.map((issueId) => ({
      queryKey: [GET_ISSUE_BY_ID, issueId],
      queryFn: () => fetchIssue({ issueId }) as Promise<FetchIssueResponse>,
      enabled: Boolean(issueId) && issueId !== selectedIssueId,
      refetchOnWindowFocus: false,
      staleTime: ISSUE_STATUS_STALE_TIME_MS,
      retry: false,
    })),
  });

  const statuses = queries.map((query) => query.data?.issue?.status);
  const statusKey = statuses.join('\u0000');

  const visibleIssueIds = useMemo(
    () =>
      new Set(
        issueIds.filter((issueId, index) => issueId === selectedIssueId || statuses[index] !== DISMISSED_ISSUE_STATUS),
      ),
    // `statuses` is a fresh array every render; `statusKey` changes only when a status really does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issueIds, statusKey, selectedIssueId],
  );

  return visibleIssueIds;
};

/** The issues a span is flagged for that nobody has dismissed, as the cards need them. */
export const useVisibleIssueReferences = (assessments: Assessment[] | undefined): TraceIssueReference[] => {
  const references = useArrayMemo(getUniqueIssueReferences(assessments ?? []));
  const visibleIssueIds = useVisibleIssueIds(useArrayMemo(references.map(({ id }) => id)));
  return useArrayMemo(references.filter(({ id }) => visibleIssueIds.has(id)));
};

/** The same selection, as the assessments they came from. */
export const useVisibleIssueReferenceAssessments = (
  assessments: IssueReferenceAssessment[],
): IssueReferenceAssessment[] => {
  const references = useArrayMemo(getUniqueIssueReferenceAssessments(assessments));
  const visibleIssueIds = useVisibleIssueIds(useArrayMemo(references.map(({ assessment_name }) => assessment_name)));
  return useArrayMemo(references.filter(({ assessment_name }) => visibleIssueIds.has(assessment_name)));
};
