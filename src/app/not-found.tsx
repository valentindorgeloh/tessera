import { VStack } from "@astryxdesign/core/Stack";
import { NotFoundScreen } from "@/components/shell/NotFoundScreen";

/**
 * Root not-found boundary: unmatched URLs outside the route groups, rendered in
 * the app theme. The frame paints the page itself: before hydration <html> and
 * <body> still carry Astryx's default tokens (the root Theme syncs the theme
 * onto <html> in an effect), while this frame sits inside the Theme wrapper.
 */
export default function RootNotFound() {
  return (
    <VStack className="tessera-root-frame" height="100%">
      <NotFoundScreen />
    </VStack>
  );
}
