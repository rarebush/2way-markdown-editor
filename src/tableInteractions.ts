import type { NodeViewConstructor } from "@milkdown/kit/prose/view";

export function withDirectCellEditing(
  createNodeView: NodeViewConstructor,
): NodeViewConstructor {
  return (node, view, getPos, decorations, innerDecorations) => {
    const nodeView = createNodeView(
      node,
      view,
      getPos,
      decorations,
      innerDecorations,
    );
    const originalStopEvent = nodeView.stopEvent?.bind(nodeView);

    nodeView.stopEvent = (event) => {
      if (
        view.editable &&
        (event.type === "mousedown" || event.type === "pointerdown") &&
        event instanceof MouseEvent &&
        event.button === 0 &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.target instanceof Element &&
        !event.target.closest("button") &&
        event.target.closest("td, th") &&
        nodeView.contentDOM?.contains(event.target)
      ) {
        return false;
      }

      return originalStopEvent?.(event) ?? false;
    };

    return nodeView;
  };
}
