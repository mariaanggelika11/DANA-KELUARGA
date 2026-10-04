import { useRef, useState, useEffect, type ReactNode } from "react";
import { Modal } from "./Modal";

import {
  ConfirmationContext,
  type AskConfirmation,
  type ConfirmationOptions,
} from "../hooks/useConfirmation";
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      resolve.current?.(false);
    },
    [],
  );
  function finish(value: boolean) {
    resolve.current?.(value);
    resolve.current = null;
    setOptions(null);
  }
  const ask: AskConfirmation = (value) => {
    if (resolve.current) return Promise.resolve(false);
    setOptions(value);
    return new Promise<boolean>((done) => {
      resolve.current = done;
    });
  };
  return (
    <ConfirmationContext.Provider value={ask}>
      {children}
      {options && (
        <Modal
          title={options.title}
          onClose={() => finish(false)}
          className="confirmation-dialog"
        >
          <p>{options.message}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              autoFocus
              onClick={() => finish(false)}
            >
              Batal
            </button>
            <button
              type="button"
              className={options.destructive ? "danger-button" : "primary"}
              onClick={() => finish(true)}
            >
              {options.confirmLabel ?? "Lanjutkan"}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmationContext.Provider>
  );
}
