# GDB Script Runner

Runs the active `.gdb` script through the selected VS Code debug configuration.

## Andes ICEman

The extension can start Andes ICEman before launching GDB.

Example workspace settings:

```json
{
  "gdbScriptRunner.iceman.enabled": true,
  "gdbScriptRunner.iceman.executable": "C:\\Andes\\ICEman\\iceman.exe",
  "gdbScriptRunner.iceman.args": [],
  "gdbScriptRunner.iceman.cwd": "C:\\Andes\\ICEman",
  "gdbScriptRunner.iceman.andesRoot": "C:\\Andes",
  "gdbScriptRunner.iceman.useAndesEnvironment": true,
  "gdbScriptRunner.iceman.startupDelayMs": 1000
}
```

When `gdbScriptRunner.iceman.useAndesEnvironment` is enabled, the extension prepares the same environment as the Andes launcher batch file:

- `HOME` is set to `<andesRoot>\ice\`.
- `<andesRoot>\cygwin\bin` and `<andesRoot>\ice\` are prepended to `PATH`.
- `SHELL` is set to `/bin/bash` when `bash.exe` exists in the Andes Cygwin directory.
- `CYGPATH` is set to `cygpath`.

Commands:

- `Start Andes ICEman`
- `Stop Andes ICEman`
- `Run GDB Script (F5)`

Use your `.gdb` script or `launch.json` setup commands to connect GDB to the ICEman server, for example with the target command used by your ICEman configuration.
