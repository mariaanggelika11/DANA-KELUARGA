import { createContext, useContext } from "react";
export type ConfirmationOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
};
export type AskConfirmation = (
  options: ConfirmationOptions,
) => Promise<boolean>;
export const ConfirmationContext = createContext<AskConfirmation | null>(null);
export function useConfirmation() {
  const ask = useContext(ConfirmationContext);
  if (!ask) throw new Error("ConfirmationProvider is required");
  return ask;
}
