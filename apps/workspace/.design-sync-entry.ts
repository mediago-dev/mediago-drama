// Curated entry for design-sync (claude.ai/design).
// Re-exports the shared UI design-system components so the converter bundles
// exactly this set into window.<globalName>. Not used by the app itself.
export * from "@/shared/components/ui/button";
export * from "@/shared/components/ui/badge";
export * from "@/shared/components/ui/card";
export * from "@/shared/components/ui/alert";
export * from "@/shared/components/ui/alert-dialog";
export * from "@/shared/components/ui/input";
export * from "@/shared/components/ui/label";
export * from "@/shared/components/ui/textarea";
export * from "@/shared/components/ui/select";
export * from "@/shared/components/ui/popover";
export * from "@/shared/components/ui/tabs";
export * from "@/shared/components/ui/tooltip";
export * from "@/shared/components/ui/sheet";
export * from "@/shared/components/ui/context-menu";
export * from "@/shared/components/ui/sonner";
// Expose sonner's imperative `toast` on the bundle so a preview can drive the
// bundled Toaster (same sonner instance). Not a component — no card emitted.
export { toast } from "sonner";
