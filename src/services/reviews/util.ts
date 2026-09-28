const EXCLUDED_CURRENT_ASSIGNED_REVIEWER_COMMENT_STATES = new Set([-1, -2]);

export const isCurrentAssignedReviewerCommentState = (stateCode: number) =>
  !EXCLUDED_CURRENT_ASSIGNED_REVIEWER_COMMENT_STATES.has(stateCode);

export const areAllCurrentReviewerOpinionsRejected = (
  reviewerCount: number | null | undefined,
  completedReviewerCount: number | null | undefined,
  rejectOpinionCount: number | null | undefined,
) =>
  reviewerCount !== null &&
  reviewerCount !== undefined &&
  reviewerCount > 0 &&
  completedReviewerCount === reviewerCount &&
  rejectOpinionCount === reviewerCount;
