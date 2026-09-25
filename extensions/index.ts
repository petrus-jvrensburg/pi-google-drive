import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setActiveCwd } from "./config-path.ts";
import { registerCommands } from "./commands.ts";
import { registerTools } from "./tools.ts";
import { publicStatusFor, statusLabel } from "./oauth.ts";

export default function googleDriveExtension(pi: ExtensionAPI) {
  registerCommands(pi);
  registerTools(pi);

  pi.on("session_start", async (_event, ctx) => {
    try {
      setActiveCwd(ctx.cwd);
      const status = await publicStatusFor(ctx.cwd);
      ctx.ui.setStatus("gdrive", statusLabel(status));
    } catch {
      ctx.ui.setStatus("gdrive", "Drive: run /gdrive-setup");
    }
  });
}
