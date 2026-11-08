"use client";

import { useUi } from "@/components/providers/UiProvider";

import { PositionEditor } from "./PositionEditor";

/**
 * The global position editor bound to UiProvider.positionEditor, mounted once in the shell. Open it from anywhere with
 * openPositionEditor(symbol), or openPositionEditor("") for a new position with a symbol picker.
 */
export function PositionEditorHost() {
  const { positionEditor, closePositionEditor } = useUi();
  return <PositionEditor symbol={positionEditor} onClose={closePositionEditor} />;
}
