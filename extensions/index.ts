import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { registerTools } from "./tools.ts";
import { readConfig, toPublicStatus } from "./oauth.ts";

export default function googleDriveExtension(pi: ExtensionAPI) {
  registerCommands(pi);
  registerTools(pi);

  pi.on("session_start", async (_event, ctx) => {
    const status = toPublicStatus(await readConfig());
    if (status.configured && status.email) {
      ctx.ui.setStatus("gdrive", `Drive: ${status.email}`);
    } else if (status.configured) {
      ctx.ui.setStatus("gdrive", "Drive: connected");
    } else {
      ctx.ui.setStatus("gdrive", "Drive: run /gdrive-setup");
    }
  });
}
