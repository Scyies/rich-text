import { createContext, useContext, type ReactNode } from "react";
import { en, type EditorMessages } from "./messages";

/**
 * React binding for the message dictionaries. DocumentEditor/BlockEditor
 * wrap their subtree in <MessagesProvider>; leaf components read the strings
 * with `useMessages()`. The default value is the English dictionary, so
 * components rendered standalone (without a provider) still work.
 */

const MessagesContext = createContext<EditorMessages>(en);

export function MessagesProvider({
  messages,
  children,
}: {
  messages: EditorMessages;
  children: ReactNode;
}) {
  return <MessagesContext.Provider value={messages}>{children}</MessagesContext.Provider>;
}

export function useMessages(): EditorMessages {
  return useContext(MessagesContext);
}
