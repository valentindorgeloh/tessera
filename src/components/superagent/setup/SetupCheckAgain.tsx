"use client";

/**
 * The setup guide's "Check again" button (decision 155): the guide's one client island. It asks Next to reload the
 * server-rendered status; the guide's text stays on the server and out of the browser bundle.
 */
import { useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { superagentRefreshAction } from "@/app/actions/superagent";
import { RetryIcon } from "@/themes/catppuccin/icons";

export function SetupCheckAgain() {
  const [isChecking, startCheck] = useTransition();
  const check = () => {
    startCheck(async () => {
      // Tessera's server may be restarting; a throw here would replace the screen with the error boundary.
      await superagentRefreshAction().catch(() => undefined);
    });
  };
  return <Button variant="secondary" size="sm" label="Check again" icon={<RetryIcon />} isLoading={isChecking} onClick={check} />;
}
