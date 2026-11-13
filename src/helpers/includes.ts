import { Element, Node, ParsingOptions } from "../types.js";

import {
  isMicroformatV2Root,
  isElement,
  isMicroformatRoot,
} from "./nodeMatchers.js";
import { getV1IncludeNames } from "../backcompat/index.js";

interface IncludeContext {
  /**
   * IDs already expanded within the current root. Each target is expanded
   * at most once per root, so shared fragments are not duplicated and
   * reference cycles terminate.
   */
  expanded: Set<string>;
  /**
   * Referenced document nodes on the current expansion path. A reference
   * to one of these is a self-loop or an ancestor back-reference: only
   * that edge is skipped, the rest of the expansion continues.
   */
  ancestors: Set<Element>;
}

/**
 * Deep-clone a referenced fragment so that every root receives its own
 * copy. The shared document nodes are never mutated and no state
 * (attributes, previously included children, language) leaks between roots.
 */
const cloneNode = <T extends Node>(node: T): T =>
  (isElement(node)
    ? {
        ...node,
        attrs: node.attrs.map((attr) => ({ ...attr })),
        childNodes: node.childNodes.map(cloneNode),
      }
    : { ...node }) as T;

const expandIncludes = (
  node: Element,
  options: ParsingOptions,
  context: IncludeContext,
): void => {
  const { expanded, ancestors } = context;

  // snapshot the node's own children before any referenced clones are appended
  const ownChildren = [...node.childNodes];

  // expand this node's own references in the order they appear
  getV1IncludeNames(node).forEach((name) => {
    if (expanded.has(name)) {
      return;
    }

    expanded.add(name);

    const include = options.idRefs[name];

    // a missing target or a cyclic edge skips only this reference,
    // leaving every other field untouched
    if (!include || ancestors.has(include)) {
      return;
    }

    const clone = cloneNode(include);
    node.childNodes.push(clone);

    // nested microformat roots are a boundary: their own references are
    // expanded when they are parsed as roots themselves
    if (!isMicroformatRoot(clone)) {
      ancestors.add(include);
      expandIncludes(clone, options, context);
      ancestors.delete(include);
    }
  });

  // recurse into the node's own children, stopping at nested root boundaries
  ownChildren.forEach(
    (child) =>
      isElement(child) &&
      !isMicroformatRoot(child) &&
      expandIncludes(child, options, context),
  );
};

export const applyIncludesToRoot = (
  node: Element,
  options: ParsingOptions,
): void => {
  if (isMicroformatV2Root(node)) {
    return;
  }

  expandIncludes(node, options, {
    expanded: new Set(),
    ancestors: new Set([node]),
  });
};
