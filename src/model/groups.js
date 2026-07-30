(function () {
  'use strict';

// Sample-group assignment: the comma-separated group text box, the
// "Exclude" sentinel every per-sample dropdown carries, and the pure
// bookkeeping around them. This is a display/analysis-layer concern only —
// it never touches parsed sample data, so re-typing the group list or
// reassigning a sample recalculates instantly with no re-parse (brief:
// "Group assignment is a display/analysis-layer setting, not a re-parse").

const EXCLUDE = 'Exclude';

/**
 * Parses the comma-separated group text box into a clean, ordered,
 * de-duplicated list of group names.
 */
function parseGroupNames(text) {
  const seen = new Set();
  const names = [];
  (text || '').split(',').forEach((raw) => {
    const name = raw.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  });
  return names;
}

/**
 * A sample's stored group assignment can go stale when the group list is
 * retyped (e.g. a group it was assigned to gets removed). Resolves what a
 * sample's *effective* assignment is given the current group list: the
 * assignment itself if still valid, "Exclude" is always valid, otherwise
 * unassigned (null).
 */
function resolveSampleGroup(currentGroup, availableGroupNames) {
  if (currentGroup === EXCLUDE) return EXCLUDE;
  if (currentGroup && availableGroupNames.includes(currentGroup)) return currentGroup;
  return null;
}

/**
 * Buckets a run's samples by their effective group assignment.
 *
 * @param {Map<string, {id: string, group: string|null}>} samples
 * @param {string[]} groupNames
 * @returns {{
 *   byGroup: Map<string, string[]>,   // groupName -> sampleIds, insertion order, only non-empty groups
 *   excluded: string[],               // sampleIds
 *   unassigned: string[],             // sampleIds
 *   included: string[],               // sampleIds with a real (non-excluded, non-null) group
 *   singleGroup: boolean,             // true when every included sample shares one group
 * }}
 */
function summarizeGroups(samples, groupNames) {
  const byGroup = new Map(groupNames.map((g) => [g, []]));
  const excluded = [];
  const unassigned = [];

  for (const sample of samples.values()) {
    const effective = resolveSampleGroup(sample.group, groupNames);
    if (effective === EXCLUDE) excluded.push(sample.id);
    else if (effective === null) unassigned.push(sample.id);
    else byGroup.get(effective).push(sample.id);
  }

  const included = [...byGroup.values()].flat();
  const groupsWithSamples = [...byGroup.entries()].filter(([, ids]) => ids.length > 0);

  return {
    byGroup,
    excluded,
    unassigned,
    included,
    singleGroup: groupsWithSamples.length <= 1,
  };
}

const groupsExports = { EXCLUDE, parseGroupNames, resolveSampleGroup, summarizeGroups };
if (typeof module !== 'undefined' && module.exports) module.exports = groupsExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.groups = groupsExports;
}
})();
