import { useMemo, useState } from 'react';

import type { LayoutAxis } from '../geometry';
import type { MixSettings } from '../types';
import { getOutputSize } from '../types';
import type { MixPlan } from '../planner/types';
import { getPlanAxis } from '../planner/types';
import { getFitAxes, getFitLayout } from '../fitFractions';

/**
 * F1 (T45): the output layout the fit chips and the magnet work on. Landscape outputs use columns and portrait ones
 * rows; a square output uses the axis of the current plan (user decision, 01-requisitos §12): the last one computed
 * (the plan is only computed while the Mix view is shown), or columns if there's none yet.
 */
export default function useFitLayout({ settings, plan }: {
  settings: Pick<MixSettings, 'output' | 'gap'>,
  plan: Pick<MixPlan, 'axis'> | undefined,
}) {
  const [planAxis, setPlanAxis] = useState<LayoutAxis>();
  // remember the axis of the last plan (adjusting state while rendering, not in an effect)
  const currentPlanAxis = plan != null ? getPlanAxis(plan) : undefined;
  if (currentPlanAxis != null && currentPlanAxis !== planAxis) setPlanAxis(currentPlanAxis);

  const { output, gap } = settings;
  const axes = useMemo(() => getFitAxes(getOutputSize(output)), [output]);
  const axis = axes.length === 1 ? axes[0] : (currentPlanAxis ?? planAxis ?? 'columns');
  return useMemo(() => getFitLayout({ output, gap }, axis), [axis, gap, output]);
}
