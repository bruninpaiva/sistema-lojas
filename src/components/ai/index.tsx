import { AIProvider } from "@/services/ai/AIProvider";
import { FloatingAIButton } from "./FloatingAIButton";
import { AIChatDrawer } from "./AIChatDrawer";
import type { ReactNode } from "react";

export function AIAssistant({ children }: { children: ReactNode }) {
  return (
    <AIProvider>
      {children}
      <FloatingAIButton />
      <AIChatDrawer />
    </AIProvider>
  );
}
