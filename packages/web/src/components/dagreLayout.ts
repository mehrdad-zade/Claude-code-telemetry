import dagre from "dagre";
import type { Edge, Node } from "reactflow";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 150;

/** Computes a simple top-down layout for the (mostly-tree-shaped) agent
 * graph. Re-run on every render with the current node/edge set — cheap at
 * the node counts this tool deals with (a handful to a few dozen agents). */
export function layoutWithDagre(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 100 });

  for (const node of nodes) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) g.setEdge(edge.source, edge.target);

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: pos ? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } : node.position,
    };
  });
}
