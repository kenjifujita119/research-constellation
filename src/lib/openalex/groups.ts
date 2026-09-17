/** Splits direct co-authors into clusters who also write with each other. Makes no API calls.
 *  Ported from the original Python implementation (groups.py, not included here).
 *
 *  The user is left out and only the links between direct co-authors are used. The user is
 *  connected to everyone, so keeping them would collapse everything into one cluster.
 *
 *  **Never name a cluster after a person.** A cluster only shows that its members "also write
 *  with each other on your papers"; it is neither an affiliation nor a lab. The name comes from
 *  the topics of the papers the cluster shares with you.
 *
 *  Uses a random generator that produces the same sequence as Python's (pyrandom.ts). A
 *  different generator would give different groups from the Python server version. */

import type { NetGraph, NetNode } from "./network.ts";
import { PyRandom } from "./pyrandom.ts";

/** Label propagation. Unless the same input gives the same result every time, the groups
 *  cannot feel like "my groups". */
export function labelPropagation(adj: Map<string, Set<string>>, seed = 0): Map<string, number> {
  const nodes = [...adj.keys()].sort();
  const rng = new PyRandom(seed);
  const label = new Map(nodes.map((n, i) => [n, i]));
  for (let round = 0; round < 50; round++) {
    rng.shuffle(nodes);
    let changed = 0;
    for (const n of nodes) {
      const counts = new Map<number, number>();
      for (const m of adj.get(n)!) {
        const l = label.get(m);
        if (l !== undefined) counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      if (!counts.size) continue;
      // Break ties with the seeded random generator. Always leaning towards the lower number
      // makes labels snowball into each other (measured: 8 groups became 4).
      const top = Math.max(...counts.values());
      const tied = [...counts].filter(([, v]) => v === top).map(([k]) => k).sort((a, b) => a - b);
      const best = rng.choice(tied);
      if (label.get(n) !== best) {
        label.set(n, best);
        changed += 1;
      }
    }
    if (!changed) break;
  }
  return label;
}

/** The name of the most common topic among the papers the cluster shares with the user.
 *  Left unnamed unless it covers more than half — putting one topic on the label would be false. */
function topicLabel(
  members: string[],
  byId: Map<string, NetNode>,
  topicNames: Record<string, string>,
): string | null {
  const counts = new Map<string, number>();
  for (const id of members) {
    for (const topic of byId.get(id)!.shared_topics ?? []) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  if (!counts.size) return null;
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (n * 2 <= members.length) return null;
  return topicNames[top] ?? null;
}

/** Writes group and group_name onto the hop1 nodes. Returns the number of clusters.
 *  Giving clusters of fewer than 3 people their own colour makes the legend unreadable, so
 *  they are all left out. */
export function assignGroups(graph: NetGraph, minSize = 3): number {
  const ego = graph.ego;
  const topicNames = graph.meta.topic_names ?? {};
  const hop1 = new Set(graph.nodes.filter((n) => n.hop === 1).map((n) => n.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  const adj = new Map<string, Set<string>>();
  for (const n of hop1) adj.set(n, new Set());
  for (const l of graph.links) {
    if (l.source === ego || l.target === ego) continue; // links through the user are not used
    if (hop1.has(l.source) && hop1.has(l.target)) {
      adj.get(l.source)!.add(l.target);
      adj.get(l.target)!.add(l.source);
    }
  }

  const label = labelPropagation(adj);
  const members = new Map<number, string[]>();
  for (const [id, lab] of label) {
    if (!members.has(lab)) members.set(lab, []);
    members.get(lab)!.push(id);
  }

  // Renumber 0, 1, 2… from the largest down. Keeps the colour assignment stable.
  const first = (v: string[]) => [...v].sort()[0];
  const ranked = [...members.values()].sort(
    (a, b) => b.length - a.length || (first(a) < first(b) ? -1 : first(a) > first(b) ? 1 : 0),
  );
  let nGroups = 0;
  for (const group of ranked) {
    if (group.length < minSize) {
      for (const id of group) {
        byId.get(id)!.group = null;
        byId.get(id)!.group_name = null;
      }
      continue;
    }
    // If the topic is unclear, use a number only. Never use the name of anyone in the cluster.
    const name = topicLabel(group, byId, topicNames) || `Cluster ${nGroups + 1}`;
    for (const id of group) {
      byId.get(id)!.group = nGroups;
      byId.get(id)!.group_name = name;
    }
    nGroups += 1;
  }
  graph.meta.n_groups = nGroups;
  return nGroups;
}
