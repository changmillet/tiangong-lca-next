import { areAllCurrentReviewerOpinionsRejected } from '@/services/reviews/util';

describe('areAllCurrentReviewerOpinionsRejected', () => {
  it.each([
    [0, 0, 0, false],
    [2, 1, 1, false],
    [2, 2, 1, false],
    [2, 2, 2, true],
    [2, 2, undefined, false],
  ])(
    'checks reviewer count %s, completed count %s, and rejection count %s',
    (reviewerCount, completedReviewerCount, rejectOpinionCount, expected) => {
      expect(
        areAllCurrentReviewerOpinionsRejected(
          reviewerCount,
          completedReviewerCount,
          rejectOpinionCount,
        ),
      ).toBe(expected);
    },
  );
});
