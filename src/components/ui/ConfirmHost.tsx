"use client";

import { create } from "zustand";
import { Alert, AlertButton } from "./Modal";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
}

interface ConfirmState {
  current: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
}

const useConfirmStore = create<ConfirmState>(() => ({ current: null }));

/** Imperative confirmation dialog: `if (await confirmAction({...})) …` */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  useConfirmStore.getState().current?.resolve(false);
  return new Promise((resolve) => useConfirmStore.setState({ current: { ...options, resolve } }));
}

export function ConfirmHost() {
  const current = useConfirmStore((s) => s.current);
  const finish = (ok: boolean) => {
    current?.resolve(ok);
    useConfirmStore.setState({ current: null });
  };
  return (
    <Alert
      open={!!current}
      onClose={() => finish(false)}
      title={current?.title ?? ""}
      message={current?.message}
      actions={
        <>
          <AlertButton onClick={() => finish(false)} autoFocus>
            Cancel
          </AlertButton>
          <AlertButton onClick={() => finish(true)} destructive={current?.destructive} primary>
            {current?.confirmLabel}
          </AlertButton>
        </>
      }
    />
  );
}
